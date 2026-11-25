// ============================================================
// ai-check.js · For Claire —— AI 风格指数 + 相似度检测引擎
// 版本：1.0.0
// 依赖：0（浏览器 / Cloudflare Worker / Node 18+ 均可直接跑）
//
// 用法：
//   import { detectAI, compareTexts, check } from './ai-check.js';
//   const ai  = detectAI(text);                     // AI 风格指数
//   const sim = compareTexts(text, [refA, refB]);   // 相似度（参考文数组）
//   const all = check(text, refs);                  // { ai, sim }
//
// 三条设计原则：
//   1. 确定性 —— 同一段文本两次检测结果完全一致，才能做「改前 → 改后」趋势
//   2. 可解释 —— 每个命中都带 start/end 偏移，前端能直接高亮到字
//   3. 可校准 —— 所有权重阈值集中在 RULES 里，日后用标注样本整体重拟合
//
// 注意：本文件会被 build.js 用 String.raw 内联进 worker.js，
//       因此全文禁止出现反引号，以及美元大括号插值语法。
// ============================================================

export const ENGINE_VERSION = 'ai-check/1.0.0';

// —— 所有可调参数集中在此，校准只改这里 ——
export const RULES = {
  // 八个信号的基础权重，合计 100
  weights: { S1: 22, S2: 18, S3: 12, S4: 14, S5: 10, S6: 10, S7: 8, S8: 6 },

  // 人类痕迹减分
  humanPenaltyCap: 15,
  humanPenaltyPer: 2.5,

  // 文档级与句级分布混合：0 = 只看整体，1 = 只看高分句
  sentenceMix: 0.35,

  // 长度分档
  minCharsForScore: 120,
  shortTextChars: 300,
  midTextChars: 800,

  // 词汇多样性滑动窗口（词）
  mattrWin: 100,

  // 分档
  bands: [
    { max: 34, key: 'low', label: '低' },
    { max: 59, key: 'mid', label: '中' },
    { max: 79, key: 'elevated', label: '偏高' },
    { max: 100, key: 'high', label: '高' }
  ],

  dup: {
    zhK: 13,          // 中文连续 13 字
    enK: 40,          // 英文连续 40 字符（约 7 个词）
    zhMinSpan: 13,
    enMinSpan: 40,
    genericWeight: 0.25,   // 通用短语的降权系数（近似 IDF）
    paraJaccard: 0.5,      // 疑似改写：二元组相似度阈值
    paraMinLen: 15,
    maxRefSentences: 400,
    maxDocSentences: 200
  }
};

export const SIGNALS = [
  { id: 'S1', name: '套话模板密度', hint: 'AI 最爱用的固定搭配，每千字出现几次' },
  { id: 'S2', name: '句长节奏', hint: '句子长度是否过于整齐；人写的文章起伏更大' },
  { id: 'S3', name: '段首连接词', hint: '每句都用「首先/其次/然而」开头' },
  { id: 'S4', name: '具体性', hint: '数字、年份、专名越少，抽象名词越多，越像模型写的' },
  { id: 'S5', name: '词汇多样性', hint: '用词重复程度（MATTR）' },
  { id: 'S6', name: '结构平行', hint: '首先…其次…最后 这类排比结构' },
  { id: 'S7', name: '自我重复', hint: '两句在说同一件事，换个说法重复一遍' },
  { id: 'S8', name: '排版痕迹', hint: '段落长度过于一致、中英标点混用等' }
];

// ============================================================
// 一、基础工具
// ============================================================

function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

// 越高越可疑
function ramp(x, lo, hi) {
  if (hi === lo) return x >= hi ? 1 : 0;
  return clamp((x - lo) / (hi - lo), 0, 1);
}

// 越低越可疑
function rampDown(x, lo, hi) { return 1 - ramp(x, lo, hi); }

function mean(a) {
  if (!a.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}

function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
  return Math.sqrt(s / (a.length - 1));
}

function round(x, d) {
  const p = Math.pow(10, d || 0);
  return Math.round(x * p) / p;
}

export function bandOf(score) {
  const bands = RULES.bands;
  for (let i = 0; i < bands.length; i++) {
    if (score <= bands[i].max) return bands[i];
  }
  return bands[bands.length - 1];
}

// 语言判定：中日韩字符占比 >= 30% 视为中文
export function detectLang(text) {
  const s = String(text || '');
  let cjk = 0, latin = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x4e00 && c <= 0x9fa5) cjk++;
    else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) latin++;
  }
  if (cjk + latin === 0) return 'zh';
  return cjk / (cjk + latin) >= 0.3 ? 'zh' : 'en';
}

// ============================================================
// 二、文本结构：分句 / 分段（偏移严格守恒）
// ============================================================

const END_CHARS = '。！？!?；;…';
const CLOSE_CHARS = '”’」』）)』」"\'';
const ABBREV = /^(mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|fig|no|vol|pp|al|e\.g|i\.e)$/;

// 英文句点：返回 true 表示「确实是句末」
function dotIsEnd(text, i) {
  const prev = text[i - 1] || '';
  const next = text[i + 1] || '';
  if (!next) return true;
  if (!/\s/.test(next)) return false;               // 3.5 / .com / e.g.
  if (/[0-9]/.test(prev) && /[0-9]/.test(next)) return false;

  let j = i + 1;
  while (j < text.length && /\s/.test(text[j])) j++;
  const nc = text[j] || '';
  if (nc && /[a-z0-9]/.test(nc)) return false;      // 句子没结束，小写继续

  let k = i - 1, word = '';
  while (k >= 0 && /[A-Za-z.]/.test(text[k])) { word = text[k] + word; k--; }
  const w = word.toLowerCase().replace(/^\.+/, '');
  if (!w) return true;
  if (w.length === 1) return false;                 // A. Smith
  if (ABBREV.test(w)) return false;
  return true;
}

export function splitSentences(text) {
  const out = [];
  const n = text.length;
  let start = 0;

  for (let i = 0; i < n; i++) {
    const ch = text[i];
    let isEnd = false;

    if (ch === '\n') isEnd = true;
    else if (END_CHARS.indexOf(ch) >= 0) isEnd = true;
    else if (ch === '.') isEnd = dotIsEnd(text, i);

    if (!isEnd) continue;

    let j = i;
    while (j + 1 < n && END_CHARS.indexOf(text[j + 1]) >= 0) j++;                     // …… / ？！
    while (j + 1 < n && CLOSE_CHARS.indexOf(text[j + 1]) >= 0) j++;                   // 右引号括号

    const raw = text.slice(start, j + 1);
    if (raw.trim()) out.push({ start: start, end: j + 1, text: raw });

    start = j + 1;
    while (start < n && (text[start] === '\r' || text[start] === '\n' || text[start] === ' ' || text[start] === '\t')) start++;
    i = start - 1;
  }

  if (start < n) {
    const raw = text.slice(start);
    if (raw.trim()) out.push({ start: start, end: n, text: raw });
  }
  return out;
}

function blocks(text, re) {
  const out = [];
  let last = 0;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ start: last, end: m.index });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) out.push({ start: last, end: text.length });
  return out
    .map(function (b) {
      return { start: b.start, end: b.end, text: text.slice(b.start, b.end) };
    })
    .filter(function (b) { return b.text.trim().length > 0; });
}

export function splitParagraphs(text) {
  let ps = blocks(text, /\n[ \t]*\n+/g);
  if (ps.length <= 1) ps = blocks(text, /\n+/g);
  return ps;
}

// 句子归属段落
function attachParagraphs(sentences, paragraphs) {
  let pi = 0;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    while (pi < paragraphs.length - 1 && s.start >= paragraphs[pi].end) pi++;
    s.para = pi;
  }
}

// ============================================================
// 三、分词与多样性
// ============================================================

const SEG_CACHE = {};
function segmenterOf(lang) {
  if (SEG_CACHE[lang]) return SEG_CACHE[lang];
  if (typeof Intl === 'undefined' || !Intl.Segmenter) { SEG_CACHE[lang] = null; return null; }
  SEG_CACHE[lang] = new Intl.Segmenter(lang === 'zh' ? 'zh' : 'en', { granularity: 'word' });
  return SEG_CACHE[lang];
}

export function words(text, lang) {
  const seg = segmenterOf(lang);
  if (seg) {
    const out = [];
    const it = seg.segment(text);
    for (const part of it) if (part.isWordLike) out.push(part.segment.toLowerCase());
    return out;
  }
  const m = text.toLowerCase().match(lang === 'zh' ? /[\u4e00-\u9fa5]|[a-z0-9]+/g : /[a-z0-9]+/g);
  return m || [];
}

// 滑动窗口 TTR（MATTR）
export function mattr(tokens, win) {
  if (!tokens.length) return 0;
  if (tokens.length <= win) {
    const s = new Set(tokens);
    return s.size / tokens.length;
  }
  const W = Math.min(win, tokens.length);
  const counts = new Map();
  let kinds = 0, sum = 0, cnt = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const c = counts.get(t) || 0;
    if (c === 0) kinds++;
    counts.set(t, c + 1);
    if (i >= W) {
      const old = tokens[i - W];
      const oc = counts.get(old) - 1;
      if (oc <= 0) { counts.delete(old); kinds--; } else counts.set(old, oc);
    }
    if (i >= W - 1) { sum += kinds / W; cnt++; }
  }
  return cnt ? sum / cnt : 0;
}

// 句子单元长度：中文按有效字数，英文按词数
function unitLen(s, lang) {
  if (lang === 'zh') {
    let c = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      if (ch >= 0x4e00 && ch <= 0x9fa5) c++;
      else if ((ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122)) c++;
    }
    return c;
  }
  const m = s.match(/[A-Za-z0-9']+/g);
  return m ? m.length : 0;
}

// ============================================================
// 四、词表（S1 套话 / S3 连接词 / S9 人类痕迹）
// ============================================================

const CLICHE_ZH_STR = [
  '综上所述', '总而言之', '总的来说', '值得注意的是', '不难发现', '显而易见', '毋庸置疑',
  '众所周知', '在当今社会', '在当今时代', '在当前时代', '随着社会的发展', '随着科技的发展',
  '随着时代的发展', '起到了重要作用', '具有重要的意义', '具有重大意义', '具有深远的影响',
  '发挥着不可替代的作用', '发挥着重要作用', '日益凸显', '至关重要', '不可或缺', '相辅相成',
  '密不可分', '有目共睹', '不容忽视', '不可忽视', '换言之', '换句话说', '从某种程度上',
  '在一定程度上', '从某种意义上', '进一步来说', '更重要的是', '与此同时', '不仅如此',
  '持续优化', '全面提升', '有效促进', '有力推动', '积极探索', '深入贯彻', '不断加强',
  '多维度', '多层面', '多角度', '系统性地', '全方位', '深层次', '根本性', '关键性',
  '本文旨在', '本文将探讨', '本文主要', '新的视角', '新的思路', '面临的挑战', '发展趋势',
  '多元化发展', '产生了深远影响', '奠定了坚实基础', '提供了有力支撑', '具有重要意义'
];

const CLICHE_ZH_RE = [
  /随着[^，。；]{2,12}(的发展|的进步|的普及|的兴起)/g,
  /为[^，。；]{2,12}(提供|奠定|创造)了[^。；]{2,12}/g,
  /具有[^，。；]{2,10}的(意义|作用|价值)/g,
  /起到了[^，。；]{2,10}的(作用|效果)/g,
  /在[^，。；]{2,10}(背景|视角|层面|框架)下/g,
  /(不仅|不但)[^。；\n]{0,40}(而且|还|更)/g,
  /一方面[^。；\n]{0,60}另一方面/g,
  /首先[^。；\n]{0,90}(其次|再次|最后)/g,
  /从[^，。；]{2,8}角度来看/g,
  /(有效|积极|全面|深入|持续|进一步)[^，。；]{0,4}(促进|推动|提升|优化|加强|贯彻|落实|完善)/g,
  /(起到|发挥)(了)?[^，。；]{2,10}(作用|价值)/g
];

const CLICHE_EN = [
  'delve', "in today's fast-paced world", 'in the realm of', 'it is important to note',
  'plays a pivotal role', 'plays a crucial role', 'plays a vital role', 'a testament to',
  'underscores', 'underscoring', 'multifaceted', 'nuanced', 'robust', 'leverage',
  'tapestry', 'shed light on', 'pave the way', 'at the forefront of', 'intricate',
  'holistic', 'paramount', 'meticulous', 'foster', 'facilitate', 'encompass',
  'overarching', 'seamless', 'ever-evolving', 'cutting-edge', 'synergy',
  'paradigm shift', 'in conclusion', 'furthermore', 'moreover', 'additionally',
  'not only', 'game-changer', 'landscape of', 'navigate the', 'crucial', 'vital',
  'comprehensive understanding', 'in summary', 'ultimately'
];

const CONNECTORS_ZH = [
  '首先', '其次', '再次', '最后', '此外', '另外', '然而', '因此', '所以', '总之', '综上',
  '与此同时', '不仅如此', '另一方面', '更重要的是', '值得注意的是', '由此可见',
  '除此之外', '换言之', '换句话说', '总之'
];

const CONNECTORS_EN = [
  'first', 'firstly', 'second', 'secondly', 'third', 'thirdly', 'lastly', 'finally',
  'however', 'moreover', 'furthermore', 'additionally', 'therefore', 'thus', 'hence',
  'consequently', 'overall', 'in conclusion', 'in addition', 'on the other hand',
  'meanwhile', 'nevertheless', 'nonetheless', 'more importantly'
];

const HUMAN_ZH = [
  '说实话', '老实说', '其实', '我觉得', '我认为', '我查过', '我记得', '我试过', '说白了',
  '反正', '大概', '差不多', '有点', '不太', '没想到', '结果发现', '感觉', '挺', '蛮'
];

const HUMAN_EN = [
  'i think', 'i guess', 'honestly', 'to be honest', 'kind of', 'sort of', 'a bit',
  'i remember', 'in my experience', 'frankly', 'basically', 'pretty much'
];

// ============================================================
// 五、命中扫描（带偏移，重叠自动去重）
// ============================================================

function dedupe(hits) {
  hits.sort(function (a, b) {
    if (a.start !== b.start) return a.start - b.start;
    return (b.end - b.start) - (a.end - a.start);
  });
  const out = [];
  let lastEnd = -1;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (h.start >= lastEnd) { out.push(h); lastEnd = h.end; }
  }
  return out;
}

function scanStrings(text, list, cased) {
  const hits = [];
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (!v) continue;
    let from = 0;
    while (true) {
      const idx = text.indexOf(v, from);
      if (idx < 0) break;
      hits.push({ start: idx, end: idx + v.length, text: text.slice(idx, idx + v.length) });
      from = idx + v.length;
    }
  }
  return cased ? hits : dedupe(hits);
}

function scanRes(text, list) {
  const hits = [];
  for (let i = 0; i < list.length; i++) {
    const re = new RegExp(list[i].source, 'g');
    let m;
    let guard = 0;
    while ((m = re.exec(text)) && guard++ < 500) {
      if (!m[0].length) { re.lastIndex++; continue; }
      hits.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }
  return hits;
}

// ============================================================
// 六、排除区：参考文献 / 引用块 / 引注标记
// ============================================================

function exclusionRanges(text) {
  const ranges = [];

  // 1) 参考文献整段（通常在文末）
  const refHead = /(^|\n)[ \t]*(参考文献|参考资料|引用文献|references|works cited|bibliography)[ \t]*[:：]?[ \t]*\n/i;
  const m = refHead.exec(text);
  if (m && m.index > text.length * 0.35) {
    ranges.push({ start: m.index, end: text.length, kind: 'refs' });
  }

  // 2) 引号内的直接引用
  const quoteRes = [/[“"]([^”"]{2,300})[”"]/g, /"([^"]{2,300})"/g];
  for (let i = 0; i < quoteRes.length; i++) {
    const re = new RegExp(quoteRes[i].source, 'g');
    let q;
    let guard = 0;
    while ((q = re.exec(text)) && guard++ < 200) {
      ranges.push({ start: q.index, end: q.index + q[0].length, kind: 'quote' });
    }
  }

  // 3) 引注标记：[1] [1-3] (Smith, 2020) （张三，2020）
  const citeRes = [
    /\[\d{1,3}(?:[-,–]\d{1,3})*\]/g,
    /[（(][A-Za-z\u4e00-\u9fa5.&\s]{1,30},?\s*\d{4}[a-z]?[)）]/g
  ];
  for (let i = 0; i < citeRes.length; i++) {
    const re = new RegExp(citeRes[i].source, 'g');
    let c;
    let guard = 0;
    while ((c = re.exec(text)) && guard++ < 300) {
      ranges.push({ start: c.index, end: c.index + c[0].length, kind: 'cite' });
    }
  }

  ranges.sort(function (a, b) { return a.start - b.start; });
  const merged = [];
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
      if (last.kind !== r.kind) last.kind = 'mixed';
    } else {
      merged.push({ start: r.start, end: r.end, kind: r.kind });
    }
  }
  return merged;
}

function inRanges(pos, ranges) {
  for (let i = 0; i < ranges.length; i++) {
    if (pos >= ranges[i].start && pos < ranges[i].end) return true;
  }
  return false;
}

// ============================================================
// 七、AI 风格指数
// ============================================================

export function detectAI(text, opts) {
  const cfg = Object.assign({}, RULES, opts || {});
  const src = String(text || '');
  const lang = detectLang(src);
  const W = cfg.weights;

  if (!src.trim()) return emptyAI(lang);

  const exclusions = exclusionRanges(src);
  let excludedChars = 0;
  for (let i = 0; i < exclusions.length; i++) excludedChars += exclusions[i].end - exclusions[i].start;

  const paragraphs = splitParagraphs(src);
  const sentences = splitSentences(src);
  attachParagraphs(sentences, paragraphs);

  const chars = src.replace(/\s/g, '').length;
  const effectiveChars = Math.max(0, chars - excludedChars);

  // —— 句子长度序列 ——
  const lens = sentences.map(function (s) { return unitLen(s.text, lang); });
  const mu = mean(lens);
  const sd = std(lens);
  const cv = mu > 0 ? sd / mu : 0;
  const diffs = [];
  for (let i = 1; i < lens.length; i++) diffs.push(Math.abs(lens[i] - lens[i - 1]));
  const jitter = mu > 0 ? mean(diffs) / mu : 0;

  const lower = src.toLowerCase();
  const used = {};
  function use(hits) {
    return hits.filter(function (h) { return !inRanges(h.start, exclusions); });
  }

  // ---------- S1 套话密度 ----------
  const s1Hits = use(dedupe(scanStrings(src, CLICHE_ZH_STR, true)
    .concat(scanRes(src, CLICHE_ZH_RE))
    .concat(scanStrings(lower, CLICHE_EN, true))));
  const s1Density = effectiveChars > 0 ? s1Hits.length / (effectiveChars / 1000) : 0;
  const s1 = ramp(s1Density, 3, 8);

  // ---------- S2 句长节奏 ----------
  const th = lang === 'zh'
    ? { cvLo: 0.30, cvHi: 0.45, jLo: 0.35, jHi: 0.60 }
    : { cvLo: 0.32, cvHi: 0.50, jLo: 0.40, jHi: 0.65 };
  const s2 = clamp(0.65 * rampDown(cv, th.cvLo, th.cvHi) + 0.35 * rampDown(jitter, th.jLo, th.jHi), 0, 1);

  // ---------- S3 段首连接词 ----------
  const connList = lang === 'zh' ? CONNECTORS_ZH : CONNECTORS_EN;
  const startFlags = sentences.map(function (s) {
    const t = s.text.trim().toLowerCase().replace(/^[“"'（(]+/, '');
    for (let i = 0; i < connList.length; i++) {
      if (t.indexOf(connList[i]) === 0) return true;
    }
    return false;
  });
  const startRatio = sentences.length ? startFlags.filter(Boolean).length / sentences.length : 0;
  let run3 = 0, cur = 0;
  for (let i = 0; i < startFlags.length; i++) {
    cur = startFlags[i] ? cur + 1 : 0;
    if (cur === 3) run3++;
  }
  const s3 = clamp(ramp(startRatio, 0.30, 0.65) + Math.min(0.3, run3 * 0.1), 0, 1);

  // ---------- S4 具体性 ----------
  const numHits = (src.match(/\d+(?:[.,]\d+)?%?/g) || []).length;
  const yearHits = (src.match(/(?:19|20)\d{2}\s*年?/g) || []).length;
  const cnHits = (src.match(/[一二三四五六七八九十百千万两][个篇次名位天年月日周节课岁元块钱份组]/g) || []).length;
  const bookHits = (src.match(/《[^》]{1,40}》/g) || []).length;
  const abbrHits = (src.match(/\b[A-Z]{2,}\b/g) || []).length;
  const placeHits = (src.match(/[\u4e00-\u9fa5]{2,6}(?:省|市|区|县|镇|村|大学|学院|公司|医院)/g) || []).length;
  const entityCount = numHits + cnHits + bookHits + abbrHits + placeHits + Math.min(yearHits, numHits);
  const entityPer100 = effectiveChars > 0 ? entityCount / (effectiveChars / 100) : 0;
  const abstractHits = (src.match(/[\u4e00-\u9fa5](?:性|化|度|感|力|主义|机制|体系|维度|层面|格局|闭环|路径|生态)/g) || []).length;
  const abstractRatio = effectiveChars > 0 ? (abstractHits * 2) / effectiveChars : 0;
  const s4 = clamp(0.6 * rampDown(entityPer100, 1.5, 4.0) + 0.4 * ramp(abstractRatio, 0.03, 0.07), 0, 1);

  // ---------- S5 词汇多样性 ----------
  const toks = words(src, lang);
  const mt = mattr(toks, cfg.mattrWin);
  const mtTh = lang === 'zh' ? 0.74 : 0.68;
  const s5 = rampDown(mt, mtTh - 0.12, mtTh + 0.06);

  // ---------- S6 结构平行 ----------
  const S6_RE = lang === 'zh'
    ? [/首先[^。；\n]{0,90}(其次|再次|最后)/g, /第一[，、,][^。；\n]{0,60}第二/g,
       /一方面[^。；\n]{0,60}另一方面/g, /不仅[^。；\n]{0,40}(而且|还)/g,
       /(总之|综上)[^。；\n]{0,30}$/g]
    : [/not only[\s\S]{0,90}but also/i, /on the one hand[\s\S]{0,90}on the other hand/i,
       /in the first place[\s\S]{0,90}(second|finally)/i, /first[\s\S]{0,60}second[\s\S]{0,60}third/i];
  const s6Pattern = scanRes(src, S6_RE).length;

  let runLen = 1, bestRun = 1;
  const inRun = new Array(sentences.length).fill(false);
  for (let i = 1; i < lens.length; i++) {
    const a = lens[i - 1], b = lens[i];
    const same = a > 0 && b > 0 && Math.abs(a - b) <= 0.15 * Math.max(a, b);
    if (same) {
      runLen++;
      if (runLen >= 3) { inRun[i] = true; inRun[i - 1] = true; if (runLen === 3) inRun[i - 2] = true; }
    } else {
      runLen = 1;
    }
    if (runLen > bestRun) bestRun = runLen;
  }
  const parallelCoverage = sentences.length ? inRun.filter(Boolean).length / sentences.length : 0;
  const s6 = clamp(0.6 * ramp(s6Pattern, 0, 2) + 0.4 * ramp(parallelCoverage, 0.15, 0.5), 0, 1);

  // ---------- S7 自我重复 ----------
  const gramSets = sentences.map(function (s) { return trigrams(s.text, lang); });
  let repeatPairs = 0;
  const repeatFlag = new Array(sentences.length).fill(false);
  const cap = Math.min(sentences.length, 300);
  for (let i = 0; i < cap; i++) {
    if (unitLen(sentences[i].text, lang) < 10) continue;
    for (let j = i + 1; j < cap; j++) {
      if (unitLen(sentences[j].text, lang) < 10) continue;
      if (jaccard(gramSets[i], gramSets[j]) > 0.5) {
        repeatPairs++;
        repeatFlag[i] = true;
        repeatFlag[j] = true;
        break;
      }
    }
  }
  const s7 = ramp(repeatPairs, 0, 3);

  // ---------- S8 排版痕迹 ----------
  const s8parts = [];
  if (paragraphs.length >= 3) {
    const per = paragraphs.map(function (p) { return splitSentences(p.text).length; });
    const pcv = mean(per) > 0 ? std(per) / mean(per) : 0;
    s8parts.push({ key: '段落长度均一', v: rampDown(pcv, 0.18, 0.45) });
  }
  if (lang === 'zh') {
    const mixed = (src.match(/[\u4e00-\u9fa5][,.;:!?][\u4e00-\u9fa5]/g) || []).length;
    s8parts.push({ key: '中英标点混用', v: ramp(mixed, 0, 3) });
  }
  const dash = (src.match(/—{2}|--/g) || []).length;
  s8parts.push({ key: '破折号密度', v: ramp(effectiveChars > 0 ? dash / (effectiveChars / 1000) : 0, 0, 4) });
  const conclRe = /^(总之|综上|因此|所以|可见|总而言之|in conclusion|overall|therefore)/i;
  let tails = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const ps = splitSentences(paragraphs[i].text);
    if (ps.length && conclRe.test(ps[ps.length - 1].text.trim())) tails++;
  }
  if (paragraphs.length) s8parts.push({ key: '段末总结句', v: ramp(tails / paragraphs.length, 0.3, 0.8) });
  const s8 = s8parts.length ? mean(s8parts.map(function (p) { return p.v; })) : 0;

  // ---------- S9 人类痕迹（减分） ----------
  const humanList = lang === 'zh' ? HUMAN_ZH : HUMAN_EN;
  let humanCount = 0;
  const humanHits = [];
  for (let i = 0; i < humanList.length; i++) {
    const v = humanList[i];
    let from = 0;
    while (true) {
      const idx = lower.indexOf(v, from);
      if (idx < 0) break;
      humanCount++;
      humanHits.push({ start: idx, end: idx + v.length, text: src.slice(idx, idx + v.length) });
      from = idx + v.length;
    }
  }
  const particles = (src.match(/(?:吧|嘛|啊|呢|呗)[。！？!?\s，,]/g) || []).length;
  humanCount += particles * 0.6;
  const humanBonus = Math.min(cfg.humanPenaltyCap, humanCount * cfg.humanPenaltyPer);

  // ---------- 汇总 ----------
  const values = { S1: s1, S2: s2, S3: s3, S4: s4, S5: s5, S6: s6, S7: s7, S8: s8 };
  let base = 0;
  for (const id in W) base += W[id] * values[id];
  base = clamp(base, 0, 100);

  // ---------- 句级分布 ----------
  const localW = { S1: W.S1, S2: W.S2, S3: W.S3, S4: W.S4, S6: W.S6, S7: W.S7 };
  let localSum = 0;
  for (const id in localW) localSum += localW[id];

  const sentScores = [];
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const len = lens[i] || 0;
    if (len < 4) { sentScores.push({ index: i, score: 0, chars: len }); continue; }

    const inHits = s1Hits.filter(function (h) { return h.start >= s.start && h.start < s.end; }).length;
    const l1 = ramp(len > 0 ? inHits / (len / 1000) : 0, 3, 8);
    const dev = mu > 0 ? Math.abs(len - mu) / mu : 0;
    const l2 = rampDown(dev, 0.20, 0.60);
    const l3 = startFlags[i] ? 1 : 0;
    const seg = src.slice(s.start, s.end);
    const eCount = (seg.match(/\d+(?:[.,]\d+)?%?|\b[A-Z]{2,}\b|《[^》]{1,40}》|[一二三四五六七八九十百千万两][个篇次名位天年月日周节课岁元块钱份组]/g) || []).length;
    const aCount = (seg.match(/[\u4e00-\u9fa5](?:性|化|度|感|力|维度|层面)/g) || []).length;
    const l4 = clamp(0.6 * rampDown(len > 0 ? eCount / (len / 100) : 0, 1.5, 4) + 0.4 * ramp(len > 0 ? (aCount * 2) / len : 0, 0.03, 0.07), 0, 1);
    const l6 = inRun[i] ? 1 : 0;
    const l7 = repeatFlag[i] ? 1 : 0;

    const sc = (localW.S1 * l1 + localW.S2 * l2 + localW.S3 * l3 + localW.S4 * l4 + localW.S6 * l6 + localW.S7 * l7) / localSum * 100;
    sentScores.push({ index: i, score: round(clamp(sc, 0, 100), 1), chars: len });
  }

  // 前 30% 高分句（按字数加权）
  const sorted = sentScores.slice().sort(function (a, b) { return b.score - a.score; });
  const topN = Math.min(sorted.length, Math.max(1, Math.round(sorted.length * 0.3)));
  let topW = 0, topSum = 0;
  for (let i = 0; i < topN; i++) { topW += Math.max(1, sorted[i].chars); topSum += sorted[i].score * Math.max(1, sorted[i].chars); }
  const topAgg = topW > 0 ? topSum / topW : 0;

  const mix = cfg.sentenceMix;
  const raw = (1 - mix) * base + mix * topAgg;
  const score = round(clamp(raw - humanBonus, 0, 100), 0);

  // ---------- 置信度 ----------
  let conf = chars < cfg.shortTextChars ? 0.30 : (chars < cfg.midTextChars ? 0.60 : 0.85);
  conf -= 0.10 * (chars > 0 ? excludedChars / chars : 0);
  if (paragraphs.length < 2) conf -= 0.05;
  if (sentences.length < 6) conf -= 0.10;
  conf = round(clamp(conf, 0.05, 0.95), 2);

  // ---------- 段落热力 ----------
  const paraScores = paragraphs.map(function (p, i) {
    const list = sentScores.filter(function (s) { return sentences[s.index].para === i; });
    let w = 0, sum = 0;
    for (let k = 0; k < list.length; k++) {
      const wt = Math.max(1, list[k].chars);
      w += wt; sum += list[k].score * wt;
    }
    const ps = w > 0 ? sum / w : 0;
    return { index: i, score: round(ps, 0), band: bandOf(ps).key, sentences: splitSentences(p.text).length };
  });

  // ---------- 信号明细 ----------
  const signalOut = [
    { id: 'S1', value: round(s1Density, 1), unit: '次/千字', norm: round(s1, 2), hits: s1Hits.slice(0, 40) },
    { id: 'S2', value: round(cv, 2), unit: '句长变异系数', norm: round(s2, 2), hits: [] },
    { id: 'S3', value: round(startRatio * 100, 0), unit: '%句子以连接词开头', norm: round(s3, 2), hits: [] },
    { id: 'S4', value: round(entityPer100, 1), unit: '专名/百字', norm: round(s4, 2), hits: [] },
    { id: 'S5', value: round(mt, 3), unit: 'MATTR', norm: round(s5, 2), hits: [] },
    { id: 'S6', value: s6Pattern + (parallelCoverage > 0 ? '/' + Math.round(parallelCoverage * 100) + '%' : ''), unit: '结构命中/平行占比', norm: round(s6, 2), hits: [] },
    { id: 'S7', value: repeatPairs, unit: '重复句对', norm: round(s7, 2), hits: [] },
    { id: 'S8', value: s8parts.length, unit: '排版项', norm: round(s8, 2), hits: [] }
  ].map(function (o) {
    const meta = SIGNALS.filter(function (s) { return s.id === o.id; })[0] || { name: o.id, hint: '' };
    return {
      id: o.id, name: meta.name, hint: meta.hint,
      value: o.value, unit: o.unit,
      norm: o.norm, weight: W[o.id], contribution: round(W[o.id] * o.norm, 1),
      hits: o.hits
    };
  }).sort(function (a, b) { return b.contribution - a.contribution; });

  // ---------- 建议 ----------
  const advice = buildAdvice(signalOut, s1Hits, humanBonus, humanCount, lang, score);

  return {
    version: ENGINE_VERSION,
    lang: lang,
    stats: {
      chars: chars,
      effectiveChars: effectiveChars,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      words: toks.length
    },
    score: score,
    band: bandOf(score).key,
    bandLabel: bandOf(score).label,
    confidence: conf,
    humanBonus: round(humanBonus, 1),
    signals: signalOut,
    paragraphs: paraScores,
    sentenceScores: sentScores,
    advice: advice,
    excluded: {
      chars: excludedChars,
      ranges: exclusions.length
    }
  };
}

function emptyAI(lang) {
  return {
    version: ENGINE_VERSION,
    lang: lang,
    stats: { chars: 0, effectiveChars: 0, sentences: 0, paragraphs: 0, words: 0 },
    score: 0,
    band: 'low',
    bandLabel: '低',
    confidence: 0,
    humanBonus: 0,
    signals: SIGNALS.map(function (s) {
      return {
        id: s.id, name: s.name, hint: s.hint, value: 0, unit: '',
        norm: 0, weight: RULES.weights[s.id], contribution: 0, hits: []
      };
    }),
    paragraphs: [],
    sentenceScores: [],
    advice: [{ signal: '-', text: '还没有文本可以分析。' }],
    excluded: { chars: 0, ranges: 0 }
  };
}

function trigrams(s, lang) {
  const out = new Set();
  if (lang === 'zh') {
    const t = s.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
    for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  } else {
    const w = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3).join(' '));
  }
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function buildAdvice(signals, s1Hits, humanBonus, humanCount, lang, score) {
  const out = [];
  // 低档文本不要硬凑建议：只有非常突出的信号才提
  const minNorm = score <= 34 ? 0.75 : 0.6;
  const top = signals.filter(function (s) {
    return s.norm >= minNorm && s.contribution >= 5;
  }).slice(0, 3);

  for (let i = 0; i < top.length; i++) {
    const s = top[i];
    let text = '';
    if (s.id === 'S1') {
      const samples = s1Hits.slice(0, 3).map(function (h) { return '「' + h.text + '」'; }).join('、');
      text = '套话密度偏高（' + s.value + ' 次/千字）。删掉这些固定搭配，直接给结论更自然：' + samples;
    } else if (s.id === 'S2') {
      text = '句子长度太整齐（变异系数 ' + s.value + '）。把长句拆短、短句并长，让节奏起伏——这是「像人写的」最有效的改动。';
    } else if (s.id === 'S3') {
      text = '有 ' + s.value + '% 的句子用连接词开头。删掉一半「首先/其次/然而」，靠内容本身推进逻辑。';
    } else if (s.id === 'S4') {
      text = '具体信息偏少（' + s.value + ' 个专名或数字/百字）。补一个真实数字、一个案例、一句引用，抽象论述立刻落地。';
    } else if (s.id === 'S5') {
      text = '用词重复较多（MATTR ' + s.value + '）。同一概念换不同的词表达，别反复用同一批术语。';
    } else if (s.id === 'S6') {
      text = '存在明显的排比结构（首先…其次…最后）。打散顺序，或只保留其中两段。';
    } else if (s.id === 'S7') {
      text = '有 ' + s.value + ' 组句子在重复表达同一件事。删掉重复的那句，或改成递进而非换词重复。';
    } else if (s.id === 'S8') {
      text = '段落长度过于一致。让长段和短段交替，读起来才不像模板。';
    }
    if (text) out.push({ signal: s.id, text: text });
  }

  if (humanBonus > 0) {
    out.push({
      signal: 'S9',
      text: '已识别到 ' + round(humanCount, 0) + ' 处口语化痕迹（减了 ' + round(humanBonus, 0) + ' 分）。保持住——这些是真人写作的指纹。'
    });
  }
  if (!out.length) {
    out.push({
      signal: '-',
      text: score <= 34
        ? '这段文本的各项指标都在正常范围，没有明显需要改的地方。'
        : '没有单项特别突出，但整体风格偏规整；建议先把长句拆短、补几处具体细节。'
    });
  }
  return out;
}

// ============================================================
// 八、相似度（查重）
// ============================================================

// 等长归一并保留偏移映射
function normalizeForMatch(text, lang) {
  const chars = [];
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    let keep = false;
    if (lang === 'zh') {
      const code = c.charCodeAt(0);
      keep = (code >= 0x4e00 && code <= 0x9fa5) ||
             (code >= 48 && code <= 57) ||
             (code >= 65 && code <= 90) ||
             (code >= 97 && code <= 122);
    } else {
      keep = /[A-Za-z0-9]/.test(c);
    }
    if (keep) { chars.push(c.toLowerCase()); map.push(i); }
  }
  return { norm: chars.join(''), map: map };
}

// 通用短语降权（近似 IDF，无需语料库）
const GENERIC_PHRASES = [
  '随着社会的发展', '随着时代的发展', '随着科技的进步', '在当今社会', '综上所述',
  '值得注意的是', '众所周知', '不难发现', '具有重要意义', '起到了重要作用',
  '在一定程度上', '从某种程度上', '是不可忽视的', '发挥着重要作用'
];

function buildIndex(text, lang, k) {
  const nm = normalizeForMatch(text, lang);
  const norm = nm.norm;
  const map = nm.map;
  const index = new Map();
  const weight = new Float32Array(Math.max(0, norm.length - k + 1));

  const covered = new Uint8Array(norm.length);
  for (let p = 0; p < GENERIC_PHRASES.length; p++) {
    const ph = GENERIC_PHRASES[p];
    let idx = norm.indexOf(ph);
    while (idx >= 0) {
      for (let s = Math.max(0, idx - k + 1); s <= idx && s < covered.length; s++) covered[s] = 1;
      idx = norm.indexOf(ph, idx + 1);
    }
  }

  let total = 0;
  for (let s = 0; s + k <= norm.length; s++) {
    const key = norm.slice(s, s + k);
    weight[s] = covered[s] ? RULES.dup.genericWeight : 1;
    total += weight[s];
    let arr = index.get(key);
    if (!arr) { arr = []; index.set(key, arr); }
    arr.push(s);
  }
  return { norm: norm, map: map, index: index, weight: weight, totalWeight: total, k: k };
}

export function compareTexts(text, refs, opts) {
  const cfg = Object.assign({}, RULES.dup, opts || {});
  const src = String(text || '');
  const lang = detectLang(src);
  const k = lang === 'zh' ? cfg.zhK : cfg.enK;
  const minSpan = lang === 'zh' ? cfg.zhMinSpan : cfg.enMinSpan;

  const list = (refs || [])
    .map(function (r, i) {
      if (typeof r === 'string') return { id: 'ref-' + (i + 1), title: '参考文 ' + (i + 1), text: r };
      return { id: r.id || 'ref-' + (i + 1), title: r.title || '参考文 ' + (i + 1), text: String(r.text || '') };
    })
    .filter(function (r) { return r.text.trim().length >= minSpan; });

  const exclusions = exclusionRanges(src);
  const excluded = new Uint8Array(src.length);
  for (let i = 0; i < exclusions.length; i++) {
    for (let p = exclusions[i].start; p < exclusions[i].end && p < excluded.length; p++) excluded[p] = 1;
  }

  const doc = buildIndex(src, lang, k);
  const starts = Math.max(0, doc.norm.length - k + 1);
  const mask = new Uint8Array(src.length);
  const matchedByRef = {};

  const sources = [];
  if (list.length) {
    for (let r = 0; r < list.length; r++) {
      const ref = list[r];
      const idx = buildIndex(ref.text, lang, k);
      let matched = 0, wMatched = 0;
      const hitStarts = [];
      for (let s = 0; s < starts; s++) {
        const key = doc.norm.slice(s, s + k);
        if (!idx.index.has(key)) continue;
        matched++;
        wMatched += doc.weight[s];
        hitStarts.push(s);
      }
      const containment = starts ? matched / starts : 0;
      const weighted = doc.totalWeight ? wMatched / doc.totalWeight : 0;

      // 用一个来源覆盖同一处片段时以最长匹配为准
      for (let h = 0; h < hitStarts.length; h++) {
        const s = hitStarts[h];
        const a = doc.map[s];
        const b = doc.map[s + k - 1] + 1;
        for (let p = a; p < b && p < mask.length; p++) mask[p] = 1;
      }

      matchedByRef[ref.id] = { containment: containment, weighted: weighted, hitStarts: hitStarts };
      sources.push({
        id: ref.id,
        title: ref.title,
        chars: ref.text.replace(/\s/g, '').length,
        shingles: Math.max(0, idx.norm.length - k + 1),
        containment: round(containment, 3),
        weightedContainment: round(weighted, 3),
        matchedShingles: matched
      });
    }
  }

  // 片段提取
  const spans = [];
  let p = 0;
  while (p < mask.length) {
    if (!mask[p]) { p++; continue; }
    const start = p;
    while (p < mask.length && mask[p]) p++;
    const end = p;
    if (end - start < minSpan) continue;
    if (excluded[start] && excluded[end - 1]) continue;
    spans.push({ start: start, end: end, len: end - start });
  }

  let matchedChars = 0;
  for (let i = 0; i < spans.length; i++) matchedChars += spans[i].len;

  let excludedChars = 0;
  for (let i = 0; i < exclusions.length; i++) excludedChars += exclusions[i].end - exclusions[i].start;
  const totalChars = src.replace(/\s/g, '').length;
  const effectiveChars = Math.max(1, totalChars - excludedChars);

  // 片段归属来源
  for (let i = 0; i < spans.length; i++) {
    const sp = spans[i];
    let bestId = '', bestCount = -1;
    for (let r = 0; r < sources.length; r++) {
      const hs = matchedByRef[sources[r].id].hitStarts;
      let c = 0;
      for (let h = 0; h < hs.length; h++) {
        const cs = doc.map[hs[h]];
        if (cs >= sp.start && cs + k <= sp.end) c++;
      }
      if (c > bestCount) { bestCount = c; bestId = sources[r].id; }
    }
    sp.source = bestId;
    sp.quote = src.slice(sp.start, Math.min(sp.end, sp.start + 60));
  }

  // 每个来源挂上自己的片段
  for (let r = 0; r < sources.length; r++) {
    sources[r].spans = spans.filter(function (s) { return s.source === sources[r].id; });
    sources[r].matchedChars = sources[r].spans.reduce(function (a, s) { return a + s.len; }, 0);
  }
  const refCount = sources.length;
  const hitSources = sources.filter(function (s) { return s.matchedShingles > 0; });
  hitSources.sort(function (a, b) { return b.weightedContainment - a.weightedContainment; });

  const rate = matchedChars / effectiveChars;

  // 疑似改写（无向量模型的启发式：字面不重合但二元组高度相似）
  const paraphrase = findParaphrase(src, list, spans, lang, cfg);

  return {
    version: ENGINE_VERSION,
    lang: lang,
    rate: round(Math.min(1, rate), 4),
    matchedChars: matchedChars,
    effectiveChars: effectiveChars,
    totalChars: totalChars,
    k: k,
    sources: hitSources,
    refCount: refCount,
    spans: spans,
    paraphrase: paraphrase,
    excluded: { chars: excludedChars, ranges: exclusions.length },
    note: '自建库相似度，与知网/维普/Turnitin 的结果不可直接比较'
  };
}

function findParaphrase(src, list, spans, lang, cfg) {
  const pairs = [];
  if (!list.length) return { count: 0, pairs: [] };

  const docSents = splitSentences(src).filter(function (s) {
    return unitLen(s.text, lang) >= cfg.paraMinLen;
  }).slice(0, cfg.maxDocSentences);

  function bigrams(s) {
    const out = new Set();
    if (lang === 'zh') {
      const t = s.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
      for (let i = 0; i + 2 <= t.length; i++) out.add(t.slice(i, i + 2));
    } else {
      const w = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
      for (let i = 0; i + 2 <= w.length; i++) out.add(w.slice(i, i + 2).join(' '));
    }
    return out;
  }

  for (let r = 0; r < list.length; r++) {
    const refSents = splitSentences(list[r].text).slice(0, cfg.maxRefSentences);
    const refGrams = refSents.map(function (s) { return bigrams(s.text); });
    for (let i = 0; i < docSents.length; i++) {
      const s = docSents[i];
      let covered = false;
      for (let q = 0; q < spans.length; q++) {
        const ov = Math.min(s.end, spans[q].end) - Math.max(s.start, spans[q].start);
        if (ov > (s.end - s.start) * 0.4) { covered = true; break; }
      }
      if (covered) continue;

      const g = bigrams(s.text);
      if (g.size < 8) continue;
      let best = 0, bestJ = -1;
      for (let j = 0; j < refGrams.length; j++) {
        const jj = jaccard(g, refGrams[j]);
        if (jj > best) { best = jj; bestJ = j; }
      }
      if (best >= cfg.paraJaccard) {
        pairs.push({
          ref: list[r].id,
          sim: round(best, 2),
          myText: s.text.trim().slice(0, 80),
          theirText: refSents[bestJ].text.trim().slice(0, 80),
          start: s.start,
          end: s.end
        });
      }
    }
  }
  pairs.sort(function (a, b) { return b.sim - a.sim; });
  return { count: pairs.length, pairs: pairs.slice(0, 20) };
}

// ============================================================
// 九、合并入口
// ============================================================

export function check(text, refs, opts) {
  return {
    ai: detectAI(text, opts && opts.ai),
    sim: compareTexts(text, refs || [], opts && opts.sim)
  };
}

export default { check: check, detectAI: detectAI, compareTexts: compareTexts, RULES: RULES, ENGINE_VERSION: ENGINE_VERSION };
