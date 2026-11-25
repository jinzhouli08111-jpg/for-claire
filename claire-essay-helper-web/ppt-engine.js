/* ============================================================
 * ppt-engine.js —— 「说想法 → 出 PPT」引擎
 *
 * 职责：
 *   1. 对话状态机（自由聊天，从自然语言里抽取幻灯片规格）
 *   2. 版式库（老钱风为主，含 6 种结构不同的页面版式）
 *   3. 把规格渲染成 block 数组（ai-template.html 的导出引擎吃这个）
 *
 * 设计约束：
 *   · CW/CH 与 ai-template.html 保持一致 = 520 × 735
 *   · 不依赖任何外部库，纯字符串 + DOM
 *   · 输出的 blocks 可直接喂给 makePptx / makeDocx / makePdf
 * ============================================================ */
(function (global) {
  'use strict';

  var CW = 960, CH = 540;

  /* ------------------------------------------------------------
   * 一、色彩系统：与 academic-poster/theme.js 同一套派生规则
   * ---------------------------------------------------------- */

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) h = '1E3527';
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  function rgbToHex(c) {
    var f = function (v) { return clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0'); };
    return '#' + f(c.r) + f(c.g) + f(c.b);
  }

  function rgbToHsl(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h * 360, s: s, l: l };
  }

  function hslToRgb(hsl) {
    var h = ((hsl.h % 360) + 360) % 360 / 360;
    var s = clamp(hsl.s, 0, 1), l = clamp(hsl.l, 0, 1);
    if (s === 0) { var v = Math.round(l * 255); return { r: v, g: v, b: v }; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    var hue = function (t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return {
      r: Math.round(hue(h + 1 / 3) * 255),
      g: Math.round(hue(h) * 255),
      b: Math.round(hue(h - 1 / 3) * 255)
    };
  }

  function mix(a, b, t) {
    var A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex({
      r: A.r + (B.r - A.r) * t,
      g: A.g + (B.g - A.g) * t,
      b: A.b + (B.b - A.b) * t
    });
  }

  function shift(hex, dl, ds) {
    var hsl = rgbToHsl(hexToRgb(hex));
    hsl.l = clamp(hsl.l + (dl || 0), 0.05, 0.97);
    hsl.s = clamp(hsl.s + (ds || 0), 0, 1);
    return rgbToHex(hslToRgb(hsl));
  }

  function relLum(rgb) {
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
  }

  function contrast(a, b) {
    var l1 = relLum(hexToRgb(a)), l2 = relLum(hexToRgb(b));
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  /* 预置主题：每个只有主色，其余自动派生 */
  var PRESETS = [
    { id: 'old-money',  name: '老钱风',   main: '#1E3527', accent: '#A98A57', bg: '#FAF7F1' },
    { id: 'navy',       name: '学院藏青', main: '#152A4A', accent: '#B08D57', bg: '#F7F6F2' },
    { id: 'wine',       name: '酒红',     main: '#5C1F26', accent: '#B08A3E', bg: '#FAF6F3' },
    { id: 'graphite',   name: '石墨',     main: '#26262A', accent: '#A5A29A', bg: '#F8F8F6' },
    { id: 'ochre',      name: '暖赭',     main: '#6E4526', accent: '#B1905E', bg: '#FBF7F0' },
    { id: 'slate',      name: '雾板岩',   main: '#3E4A52', accent: '#A8B0B4', bg: '#F6F7F7' }
  ];

  /* 由主色派生整套色板：只允许同色相 + 黑白灰 */
  function derivePalette(mainHex, accentHex, bgHex) {
    var main = mainHex || '#1E3527';
    var accent = accentHex || shift(main, 0.16, -0.18);
    var bg = bgHex || '#FAF7F1';
    return {
      main: main,
      mainDark: shift(main, -0.18, 0.02),
      mainLight: mix(main, bg, 0.82),
      accent: accent,
      bg: bg,
      ink: '#23201C',
      muted: '#7A7268',
      line: mix(main, bg, 0.80),
      white: '#FFFFFF',
      onMain: contrast(main, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#141414',
      onAccent: contrast(accent, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#141414'
    };
  }

  /* ------------------------------------------------------------
   * 二、block 构造器（字段与 ai-template.html 的 blk() 对齐）
   * ---------------------------------------------------------- */

  var seq = 0;

  function blk(o) {
    var b = {
      id: 'p' + (++seq) + Math.random().toString(36).slice(2, 6),
      type: 'text',
      x: 72, y: 60, w: CW - 144, h: 0,
      text: '',
      size: 13, font: 'sans', weight: 400,
      color: '#23201C', alpha: 1,
      align: 'left', letters: 0, italic: false,
      bg: '', radius: 0,
      role: '', roleKind: 'color',
      style: 'frame', thick: 1.4, anim: ''
    };
    for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) b[k] = o[k]; }
    return b;
  }

  function shape(x, y, w, h, fill, role, anim) {
    return blk({ type: 'shape', x: x, y: y, w: w, h: h, bg: fill, role: role || '', roleKind: 'bg', anim: anim || '' });
  }

  /* ------------------------------------------------------------
   * 三、版式库（横屏 16:9，画布 960×540，边距 72）
   *    每个版式接收 slide 数据 + 色板，返回 block 数组
   *    每个 block 可带 anim 字段，导出时写成 PowerPoint 动画
   * ---------------------------------------------------------- */

  var M = 72;                 /* 左右边距 */
  var W = CW;                 /* 960 */
  var H = CH;                 /* 540 */
  var CWID = W - M * 2;       /* 816 内容宽 */

  var LAYOUTS = {

    /* 1. 封面：左侧大字标题 + 右侧印章 */
    cover: function (s, p) {
      var b = [];
      b.push(shape(0, 0, W, H, p.bg, 'bg'));
      b.push(shape(M, 96, 56, 3, p.accent, 'accent', 'fade'));

      if (s.kicker) {
        b.push(blk({ x: M, y: 122, w: 520, text: String(s.kicker).toUpperCase(),
          size: 11, weight: 700, color: p.muted, letters: 5, anim: 'fade' }));
      }
      b.push(blk({ type: 'title', x: M, y: 176, w: 560, text: s.title || '未命名',
        size: 54, font: 'serif', weight: 800, color: p.main, anim: 'fadeUp' }));

      if (s.subtitle) {
        b.push(blk({ x: M + 2, y: 306, w: 540, text: s.subtitle,
          size: 18, font: 'serif', italic: true, color: p.muted, anim: 'fadeUp' }));
      }
      if (s.hook) {
        b.push(blk({ x: M, y: 368, w: 520, text: s.hook,
          size: 20, font: 'serif', color: p.ink, anim: 'fadeUp' }));
      }
      if (s.hookSub) {
        b.push(blk({ x: M, y: 412, w: 520, text: s.hookSub,
          size: 13, color: p.muted, anim: 'fadeUp' }));
      }

      /* 右侧印章 */
      b.push(shape(W - M - 150, 172, 150, 150, p.main, 'main', 'zoom'));
      b.push(blk({ x: W - M - 150, y: 226, w: 150, text: s.seal || 'OM',
        size: 44, font: 'serif', weight: 700, color: p.onMain,
        align: 'center', letters: 3, anim: 'zoom' }));

      b.push(shape(M, 452, CWID, 1, p.line, ''));
      if (s.footer) {
        b.push(blk({ type: 'footer', x: M, y: 470, w: CWID, text: s.footer,
          size: 10, color: p.accent, letters: 3, align: 'left' }));
      }
      return b;
    },

    /* 2. 单点论述：顶部小标 + 大标题 + 正文 */
    statement: function (s, p) {
      var b = [];
      b.push(shape(0, 0, W, H, p.bg, 'bg'));
      if (s.kicker) {
        b.push(blk({ x: M, y: 62, w: 620, text: String(s.kicker).toUpperCase(),
          size: 10, weight: 700, color: p.accent, letters: 5, anim: 'fade' }));
      }
      b.push(shape(M, 88, CWID, 1, p.line, '', 'fade'));
      b.push(blk({ type: 'title', x: M, y: 112, w: 700, text: s.title || '',
        size: 34, font: 'serif', weight: 700, color: p.main, anim: 'fadeUp' }));

      var y = 186;
      var lines = s.lines || (s.body ? String(s.body).split('\n') : []);
      for (var i = 0; i < lines.length; i++) {
        b.push(blk({ x: M, y: y, w: 690, text: lines[i],
          size: 15, color: p.ink, anim: 'fadeUp' }));
        y += 34;
      }

      if (s.pull) {
        b.push(shape(M, 404, CWID, 1, p.line, ''));
        b.push(blk({ x: M, y: 424, w: CWID, text: s.pull,
          size: 17, font: 'serif', italic: true, color: p.accent, anim: 'fadeUp' }));
      }
      if (s.footer) {
        b.push(blk({ type: 'footer', x: M, y: 486, w: CWID, text: s.footer,
          size: 9.5, color: p.muted, letters: 2, align: 'left' }));
      }
      return b;
    },

    /* 3. 要点列表：左侧编号条目 */
    list: function (s, p) {
      var b = [];
      b.push(shape(0, 0, W, H, p.bg, 'bg'));
      if (s.kicker) {
        b.push(blk({ x: M, y: 56, w: 620, text: String(s.kicker).toUpperCase(),
          size: 10, weight: 700, color: p.accent, letters: 5, anim: 'fade' }));
      }
      b.push(blk({ type: 'title', x: M, y: 82, w: 700, text: s.title || '',
        size: 30, font: 'serif', weight: 700, color: p.main, anim: 'fadeUp' }));
      b.push(shape(M, 140, CWID, 1, p.line, '', 'fade'));

      var items = s.items || [];
      var y = 168;
      var step = items.length > 4 ? 62 : 76;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var num = String(i + 1);
        if (num.length < 2) num = '0' + num;
        b.push(blk({ x: M, y: y, w: 52, text: num,
          size: 24, font: 'serif', weight: 700, color: p.accent, anim: 'fadeUp' }));
        b.push(blk({ x: M + 62, y: y, w: 700, text: it.h || '',
          size: 17, font: 'serif', weight: 700, color: p.ink, anim: 'fadeUp' }));
        if (it.d) {
          b.push(blk({ x: M + 62, y: y + 28, w: 700, text: it.d,
            size: 12.5, color: p.muted, anim: 'fadeUp' }));
        }
        y += it.d ? step : step - 18;
        if (i < items.length - 1) {
          b.push(shape(M, y - 26, CWID, 1, p.line, ''));
        }
      }

      if (s.footer) {
        b.push(blk({ type: 'footer', x: M, y: 486, w: CWID, text: s.footer,
          size: 9.5, color: p.muted, letters: 2, align: 'left' }));
      }
      return b;
    },

    /* 4. 对照：左右两栏对比 */
    compare: function (s, p) {
      var b = [];
      b.push(shape(0, 0, W, H, p.bg, 'bg'));
      if (s.kicker) {
        b.push(blk({ x: M, y: 52, w: 620, text: String(s.kicker).toUpperCase(),
          size: 10, weight: 700, color: p.accent, letters: 5, anim: 'fade' }));
      }
      b.push(blk({ type: 'title', x: M, y: 76, w: 700, text: s.title || '',
        size: 28, font: 'serif', weight: 700, color: p.main, anim: 'fadeUp' }));
      b.push(shape(M, 132, CWID, 1, p.line, '', 'fade'));

      var left = s.left || {}, right = s.right || {};
      var gap = 28;
      var colW = (CWID - gap) / 2;

      /* 左栏：浅底 */
      b.push(shape(M, 158, colW, 264, p.white, '', 'fadeUp'));
      b.push(blk({ x: M + 26, y: 180, w: colW - 52, text: left.h || '',
        size: 19, font: 'serif', weight: 700, color: p.main, anim: 'fadeUp' }));
      b.push(shape(M + 26, 214, 40, 2, p.accent, 'accent', 'fade'));
      var ly = 238;
      (left.lines || []).forEach(function (t) {
        b.push(blk({ x: M + 26, y: ly, w: colW - 52, text: t, size: 13, color: p.ink, anim: 'fadeUp' }));
        ly += 30;
      });

      /* 右栏：主色底 */
      var rx = M + colW + gap;
      b.push(shape(rx, 158, colW, 264, p.main, 'main', 'fadeUp'));
      b.push(blk({ x: rx + 26, y: 180, w: colW - 52, text: right.h || '',
        size: 19, font: 'serif', weight: 700, color: p.onMain, anim: 'fadeUp' }));
      b.push(shape(rx + 26, 214, 40, 2, p.accent, 'accent', 'fade'));
      var ry = 238;
      (right.lines || []).forEach(function (t) {
        b.push(blk({ x: rx + 26, y: ry, w: colW - 52, text: t,
          size: 13, color: p.onMain, alpha: 0.85, anim: 'fadeUp' }));
        ry += 30;
      });

      if (s.pull) {
        b.push(blk({ x: M, y: 442, w: CWID, text: s.pull,
          size: 15, font: 'serif', italic: true, color: p.accent, anim: 'fadeUp' }));
      }
      if (s.footer) {
        b.push(blk({ type: 'footer', x: M, y: 492, w: CWID, text: s.footer,
          size: 9.5, color: p.muted, letters: 2, align: 'left' }));
      }
      return b;
    },

    /* 5. 引语页：满版主色 + 大字 */
    quote: function (s, p) {
      var b = [];
      b.push(shape(0, 0, W, H, p.main, 'main'));
      b.push(shape(M, 108, 56, 3, p.accent, 'accent', 'fade'));

      var y = 150;
      var lines = s.lines || [];
      for (var i = 0; i < lines.length; i++) {
        b.push(blk({ x: M, y: y, w: 780, text: lines[i],
          size: 30, font: 'serif', color: p.onMain, anim: 'fadeUp' }));
        y += 52;
      }
      if (s.translation) {
        b.push(blk({ x: M, y: y + 24, w: 780, text: s.translation,
          size: 14, font: 'serif', italic: true, color: p.accent, anim: 'fadeUp' }));
      }

      b.push(shape(M, 424, 220, 1, p.accent, 'accent', 'fade'));
      if (s.attribution) {
        b.push(blk({ x: M, y: 442, w: CWID, text: s.attribution,
          size: 11, color: p.onMain, alpha: 0.75, letters: 1, anim: 'fadeUp' }));
      }
      return b;
    },

    /* 6. 收尾：大字结论 + 圆章 */
    ending: function (s, p) {
      var b = [];
      b.push(shape(0, 0, W, H, p.bg, 'bg'));
      b.push(shape(M, 96, 56, 3, p.accent, 'accent', 'fade'));

      var y = 140;
      var lines = s.lines || [];
      for (var i = 0; i < lines.length; i++) {
        b.push(blk({ type: 'title', x: M, y: y, w: 620, text: lines[i],
          size: 34, font: 'serif', weight: 700, color: p.main, anim: 'fadeUp' }));
        y += 58;
      }

      if (s.body) {
        var by = y + 26;
        String(s.body).split('\n').forEach(function (t) {
          b.push(blk({ x: M, y: by, w: 620, text: t, size: 14, color: p.muted, anim: 'fadeUp' }));
          by += 30;
        });
      }
      if (s.pull) {
        b.push(blk({ x: M, y: 396, w: 620, text: s.pull,
          size: 16, font: 'serif', italic: true, color: p.accent, anim: 'fadeUp' }));
      }

      /* 右侧圆章 */
      b.push(shape(W - M - 168, 178, 168, 168, p.main, 'main', 'zoom'));
      b.push(blk({ x: W - M - 168, y: 246, w: 168, text: s.seal || '完',
        size: 26, font: 'serif', color: p.onMain, align: 'center', letters: 2, anim: 'zoom' }));

      b.push(shape(M, 470, CWID, 1, p.line, ''));
      return b;
    }
  };

  var LAYOUT_NAMES = [
    { id: 'cover',     name: '封面',     hint: '标题 + 副标题 + 印章' },
    { id: 'statement', name: '论述',     hint: '一个观点 + 展开文字' },
    { id: 'list',      name: '要点',     hint: '编号条目列表' },
    { id: 'compare',   name: '对照',     hint: '左右两栏对比' },
    { id: 'quote',     name: '引语',     hint: '满版深色 + 大字' },
    { id: 'ending',    name: '收尾',     hint: '结论 + 圆章' }
  ];

  /* ------------------------------------------------------------
   * 四、渲染：slides[] → blocks[]（每页一组）
   * ---------------------------------------------------------- */

  function normalizeSlide(raw, index, total) {
    var s = raw || {};
    var layout = String(s.layout || '').toLowerCase();
    if (!LAYOUTS[layout]) {
      /* 没指定就按位置猜 */
      if (index === 0) layout = 'cover';
      else if (index === total - 1 && total > 1) layout = 'ending';
      else layout = 'statement';
    }
    return {
      layout: layout,
      kicker: s.kicker || '',
      title: s.title || '',
      subtitle: s.subtitle || '',
      hook: s.hook || '',
      hookSub: s.hookSub || '',
      seal: s.seal || '',
      lines: Array.isArray(s.lines) ? s.lines : (s.body ? String(s.body).split('\n') : []),
      body: s.body || '',
      pull: s.pull || '',
      attribution: s.attribution || '',
      translation: s.translation || '',
      items: Array.isArray(s.items) ? s.items : [],
      left: s.left || null,
      right: s.right || null,
      footer: s.footer || ''
    };
  }

  /* 把一份 deck 规格渲染成「每页 block 数组」 */
  function renderDeck(deck) {
    var slides = (deck && deck.slides) || [];
    var total = slides.length;
    var theme = deck.theme || PRESETS[0];
    var p = derivePalette(theme.main, theme.accent, theme.bg);
    var out = [];
    for (var i = 0; i < total; i++) {
      var s = normalizeSlide(slides[i], i, total);
      var fn = LAYOUTS[s.layout] || LAYOUTS.statement;
      /* 页脚兜底：没写就用 deck 标题 + 页码 */
      if (!s.footer) {
        s.footer = (deck.title || '') + (total > 1 ? '  ·  ' + (i + 1) + '/' + total : '');
      }
      out.push({
        index: i,
        layout: s.layout,
        slide: s,
        blocks: fn(s, p),
        palette: p
      });
    }
    return { pages: out, palette: p, w: CW, h: CH };
  }

  /* ------------------------------------------------------------
   * 五、对话协议
   *    后端让模型输出 JSON；这里负责：解析、容错、兜底
   * ---------------------------------------------------------- */

  /* 从模型回复里抠出 JSON（支持 ```json 包裹 / 前后有闲聊） */
  function extractJSON(text) {
    if (!text) return null;
    var s = String(text).trim();

    /* 去掉 ```json ... ``` */
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence && fence[1]) s = fence[1].trim();

    /* 直接试 */
    try { return JSON.parse(s); } catch (e) {}

    /* 找最外层 {...} */
    var start = s.indexOf('{');
    var end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      var body = s.slice(start, end + 1);
      try { return JSON.parse(body); } catch (e) {}
      /* 尾逗号 */
      try { return JSON.parse(body.replace(/,\s*([}\]])/g, '$1')); } catch (e) {}
    }
    return null;
  }

  /* 判断模型这一轮是「提问」还是「给出方案」 */
  function classifyReply(parsed, rawText) {
    if (parsed && parsed.type === 'plan' && parsed.deck) return 'plan';
    if (parsed && parsed.deck) return 'plan';
    if (parsed && parsed.type === 'question') return 'question';
    if (parsed && (parsed.questions || parsed.ask)) return 'question';
    if (!parsed) {
      /* 没 JSON：纯文本当作提问/说明 */
      return 'text';
    }
    return 'unknown';
  }

  /* 校验并修补 deck */
  function sanitizeDeck(deck) {
    if (!deck || typeof deck !== 'object') return null;
    var out = {
      title: String(deck.title || '未命名演示').slice(0, 80),
      theme: deck.theme && deck.theme.main ? deck.theme : PRESETS[0],
      slides: []
    };
    var arr = Array.isArray(deck.slides) ? deck.slides : [];
    arr.slice(0, 20).forEach(function (s) {
      if (!s || typeof s !== 'object') return;
      out.slides.push(s);
    });
    if (!out.slides.length) return null;
    return out;
  }

  /* ------------------------------------------------------------
   * 六、对外接口
   * ---------------------------------------------------------- */

  global.PPTEngine = {
    CW: CW,
    CH: CH,
    PRESETS: PRESETS,
    LAYOUTS: LAYOUTS,
    LAYOUT_NAMES: LAYOUT_NAMES,

    derivePalette: derivePalette,
    contrast: contrast,
    mix: mix,
    shift: shift,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,

    blk: blk,
    shape: shape,

    renderDeck: renderDeck,
    normalizeSlide: normalizeSlide,

    extractJSON: extractJSON,
    classifyReply: classifyReply,
    sanitizeDeck: sanitizeDeck
  };
})(typeof window !== 'undefined' ? window : globalThis);
