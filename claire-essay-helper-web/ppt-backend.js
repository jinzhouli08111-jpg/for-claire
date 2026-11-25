// ============================================================
// ppt-backend.js —— 「说想法 → 出 PPT」后端
//
// 职责：
//   · 多轮对话：模型先问关键问题，信息够了再出方案
//   · 输出结构化 deck（slides[]），前端负责渲染 + 导出
//
// 协议（前端 ↔ 后端）：
//   POST /api/ppt-chat
//   请求 { messages:[{role,content}], has_deck:bool, current_deck:{title,page_count} }
//   响应 { reply:string, deck:null | { title, slides:[...] } }
// ============================================================

const PPT_SYSTEM_PROMPT = `你是「PPT 设计师」，帮用户把想法变成一份版式讲究的演示文稿。

## 你的工作方式

1. **先问，再动手**。用户第一次描述想法时，通常缺关键信息。你要用**一两个紧凑的问题**问清楚：
   - 讲给谁听（受众）
   - 大概几页
   - 有没有风格偏好
   **不要**一次问五个问题，也不要问用户已经说过的。

2. **信息够了就出方案**，不要再问。判断标准：知道「讲什么」+「给谁」就能开工，页数可以自己给个合理建议。

3. **用户要改就改**。已经出过方案时，用户说"第 3 页改一下""换成深色""加一页"，你直接给新方案，不要重新问一遍。

## 出方案时的输出格式

当你要出方案（而不是提问）时，**只能输出一个 JSON 对象**，前后不要有任何其他文字、不要用 markdown 代码块包裹：

{
  "type": "plan",
  "reply": "一句简短的话，说明你的设计思路，30 字以内",
  "deck": {
    "title": "整个演示的标题",
    "slides": [
      { "layout": "cover", "kicker": "PART ONE", "title": "主标题", "subtitle": "副标题", "hook": "一句吸引人的话", "hookSub": "补充说明", "seal": "OM" },
      { "layout": "statement", "kicker": "01 · 定义", "title": "页面标题", "lines": ["第一行", "第二行"], "pull": "一句总结" },
      { "layout": "list", "kicker": "02 · 要点", "title": "页面标题", "items": [{ "h": "小标题", "d": "说明文字" }, { "h": "小标题2", "d": "说明2" }] },
      { "layout": "compare", "kicker": "03 · 对比", "title": "页面标题", "left": { "h": "左边标题", "lines": ["要点1", "要点2"] }, "right": { "h": "右边标题", "lines": ["要点1", "要点2"] }, "pull": "结论" },
      { "layout": "quote", "lines": ["引语第一行", "引语第二行"], "translation": "英文对照或解释", "attribution": "出处" },
      { "layout": "ending", "lines": ["结论第一行", "结论第二行"], "body": "补充正文", "pull": "金句", "seal": "完" }
    ]
  }
}

## 六种版式的用法

| layout | 用途 | 必需字段 |
|---|---|---|
| cover | 封面（**第一页必须用**） | title；可选 kicker/subtitle/hook/hookSub/seal |
| statement | 一个观点展开 | title + lines[]（3-5 行，每行不超过 22 字） |
| list | 编号要点（2-4 条） | title + items[]（每条 h + d） |
| compare | 左右对照 | title + left{h,lines[]} + right{h,lines[]} |
| quote | 满版深色引语 | lines[]（2-3 行，每行不超过 18 字） |
| ending | 收尾（**最后一页用**） | lines[] + 可选 body/pull/seal |

## 硬性要求

- **第一页必须 cover，最后一页必须 ending**（除非只有 1 页）
- 中间页在 statement / list / compare / quote 里选，**不要连续三页用同一种版式**
- 每页文字要**短**：这是演示稿不是文档。每行 22 字以内，每条要点 20 字以内
- 中文内容用中文标点，引号用「」或 ""
- 页数按用户要求；没说的话给 6-8 页
- **正文字数不够就少写几行，不要硬凑**

## 提问时的输出格式

当你要提问时，输出纯文本（不要 JSON），把问题写清楚。可以给建议让用户好回答，例如：
"给谁讲、大概几页？如果没有特别想法，我建议做 6 页，讲给大学生听。"

## 语气

像个有经验的设计师：简洁、有判断、不说废话。不要用"好的！""没问题！"这类客套开场。`;

// 把对话历史转成 DeepSeek messages
function pptBuildMessages(body) {
  const list = Array.isArray(body.messages) ? body.messages : [];
  const msgs = [{ role: 'system', content: PPT_SYSTEM_PROMPT }];

  // 有当前方案时，把方案摘要塞进上下文，方便「改第 3 页」
  if (body.has_deck && body.current_deck) {
    msgs.push({
      role: 'system',
      content: '【当前已有方案】标题：' + (body.current_deck.title || '') +
        '，共 ' + (body.current_deck.page_count || 0) + ' 页。用户接下来的话可能是修改要求，直接在原方案上改并输出完整新方案。'
    });
  }

  list.slice(-12).forEach((m) => {
    const role = m && m.role === 'assistant' ? 'assistant' : 'user';
    const content = String((m && m.content) || '').slice(0, 6000);
    if (content.trim()) msgs.push({ role, content });
  });

  return msgs;
}

// 从模型回复里抠 JSON
function pptExtractJSON(text) {
  if (!text) return null;
  let s = String(text).trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();

  try { return JSON.parse(s); } catch (e) {}

  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const body = s.slice(start, end + 1);
    try { return JSON.parse(body); } catch (e) {}
    try { return JSON.parse(body.replace(/,\s*([}\]])/g, '$1')); } catch (e) {}
  }
  return null;
}

// 校验并规范化 deck
const PPT_LAYOUTS = ['cover', 'statement', 'list', 'compare', 'quote', 'ending'];

function pptSanitizeDeck(deck) {
  if (!deck || typeof deck !== 'object') return null;

  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  if (!slides.length) return null;

  const clean = [];
  slides.slice(0, 20).forEach((s, i) => {
    if (!s || typeof s !== 'object') return;

    let layout = String(s.layout || '').toLowerCase();
    if (PPT_LAYOUTS.indexOf(layout) < 0) {
      layout = i === 0 ? 'cover' : (i === slides.length - 1 ? 'ending' : 'statement');
    }

    const out = { layout };
    ['kicker', 'title', 'subtitle', 'hook', 'hookSub', 'seal', 'body', 'pull', 'attribution', 'translation', 'footer'].forEach((k) => {
      if (s[k] != null && String(s[k]).trim()) out[k] = String(s[k]).slice(0, 300);
    });

    if (Array.isArray(s.lines)) {
      out.lines = s.lines.map((t) => String(t).slice(0, 200)).filter(Boolean).slice(0, 8);
    }
    if (Array.isArray(s.items)) {
      out.items = s.items.slice(0, 6).map((it) => ({
        h: String((it && it.h) || '').slice(0, 60),
        d: String((it && it.d) || '').slice(0, 160)
      })).filter((it) => it.h);
    }
    ['left', 'right'].forEach((side) => {
      const v = s[side];
      if (v && typeof v === 'object') {
        out[side] = {
          h: String(v.h || '').slice(0, 60),
          lines: Array.isArray(v.lines) ? v.lines.map((t) => String(t).slice(0, 120)).filter(Boolean).slice(0, 6) : []
        };
      }
    });

    clean.push(out);
  });

  if (!clean.length) return null;

  return {
    title: String(deck.title || '演示文稿').slice(0, 80),
    slides: clean
  };
}

// —— 转发后端：PPT 对话 ——
async function handlePptChat(request, env) {
  try {
    const body = await request.json();
    const messages = pptBuildMessages(body);

    if (messages.length < 2) {
      return json({ error: '没有收到内容' }, 400);
    }
    if (!env.DEEPSEEK_API_KEY) {
      return json({ error: '后端未配置 DEEPSEEK_API_KEY，请参考 README 设置 Secret。' }, 500);
    }

    const upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + env.DEEPSEEK_API_KEY
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        stream: false,
        temperature: 0.8,
        max_tokens: 8000
      })
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return json({ error: 'DeepSeek 接口返回错误（' + upstream.status + '）：' + text.slice(0, 300) }, 502);
    }

    const data = await upstream.json();
    const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';

    const parsed = pptExtractJSON(content);

    // 是方案
    if (parsed && parsed.deck) {
      const deck = pptSanitizeDeck(parsed.deck);
      if (deck) {
        return json({
          reply: String(parsed.reply || '方案已生成').slice(0, 300),
          deck: deck
        });
      }
    }
    if (parsed && parsed.type === 'plan' && parsed.deck) {
      const deck = pptSanitizeDeck(parsed.deck);
      if (deck) return json({ reply: String(parsed.reply || '方案已生成').slice(0, 300), deck: deck });
    }

    // 是提问 / 纯文本
    return json({
      reply: content.replace(/```[\s\S]*?```/g, '').trim().slice(0, 2000) || '能再说详细一点吗？',
      deck: null
    });

  } catch (e) {
    return json({ error: '服务异常：' + (e && e.message ? e.message : String(e)) }, 500);
  }
}
