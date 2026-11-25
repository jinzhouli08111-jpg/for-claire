// ============================================================
// Claire Essay 助手 · 本地测试版（绕过 Cloudflare，直接在你电脑上跑）
//
// 用法：
//   1) 在本目录新建一个 key.txt，把你 DeepSeek 的 Key（sk- 开头）粘进去；
//   2) 命令行执行：  node server.js
//   3) 浏览器打开：  http://localhost:8787
//
// 说明：提示词和 /api/* 逻辑已经不再写在本文件里，
//       而是直接从 worker.js 抽出同一段后端代码来跑，
//       所以本地看到的效果和线上完全一致，改 worker.js 之后不用再改这边。
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const ROOT = __dirname;

// —— 读取 DeepSeek Key：优先环境变量，其次 key.txt ——
let KEY = process.env.DEEPSEEK_API_KEY || '';
if (!KEY) {
  try { KEY = fs.readFileSync(path.join(ROOT, 'key.txt'), 'utf8').trim(); } catch (e) {}
}

// —— 从 worker.js 抽出后端代码段（锚点与 build.js 完全一致）——
const workerSrc = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const sPos = workerSrc.indexOf('const SYSTEM_PROMPT');
const ePos = workerSrc.indexOf('// —— 入口');
if (sPos < 0 || ePos <= sPos) {
  console.error('worker.js 里找不到 SYSTEM_PROMPT / 入口 标记，无法抽取后端代码。');
  process.exit(1);
}
const backend = workerSrc.slice(sPos, ePos);

let api;
try {
  api = new Function(
    backend + '\nreturn {' +
    ' handleChat: handleChat,' +
    ' handlePptChat: handlePptChat,' +
    ' buildUserPrompt: buildUserPrompt,' +
    ' countWords: countWords' +
    ' };'
  )();
} catch (e) {
  console.error('从 worker.js 抽取后端代码失败：' + (e && e.message ? e.message : String(e)));
  process.exit(1);
}

// —— 前端页面 ——
const FRONTEND = fs.readFileSync(path.join(ROOT, 'preview.html'), 'utf8');

const STATIC = {
  '/ds.css': 'ds.css',
  '/fonts/manrope-latin.woff2': 'fonts/manrope-latin.woff2',
  '/ai-check.html': 'ai-check.html',
  '/ai-check': 'ai-check.html',
  '/ai-check.js': 'ai-check.js',
  '/home.html': 'home.html',
  '/home-a.html': 'home-a.html',
  '/home-b.html': 'home-b.html',
  '/home-c.html': 'home-c.html',
  '/home-d.html': 'home-d.html',
  '/home-e.html': 'home-e.html',
  '/cats/cat-hero-v3.webp': 'cats/cat-hero-v3.webp',
  '/cats/cat-hero.webp': 'cats/cat-hero-v3.webp',
  '/styles.html': 'styles.html',
  '/styles': 'styles.html',
  '/draft.html': 'draft.html',
  '/draft': 'draft.html',
  '/ppt.html': 'ppt.html',
  '/ppt': 'ppt.html',
  '/ppt-engine.js': 'ppt-engine.js',
  '/ppt-export.js': 'ppt-export.js',
  '/ai-template.html': 'ai-template.html',
  '/ai-template': 'ai-template.html',
  '/mindmap.html': 'mindmap.html',
  '/mindmap': 'mindmap.html'
};

// —— 把 Node 的 Request 转成 Fetch 风格，复用 worker 里的处理器 ——
async function runHandler(handler, req, res) {
  let raw = '';
  for await (const chunk of req) raw += chunk;

  const webReq = new Request('http://localhost' + req.url, {
    method: req.method,
    headers: { 'Content-Type': 'application/json' },
    body: raw
  });

  const webRes = await handler(webReq, { DEEPSEEK_API_KEY: KEY });

  const headers = {};
  webRes.headers.forEach(function (v, k) { headers[k] = v; });
  res.writeHead(webRes.status, headers);

  // 流式接口要边收边发，不能等全部结束再写，否则本地看不到逐字输出
  const ctype = String(webRes.headers.get('content-type') || '');
  if (ctype.indexOf('text/event-stream') >= 0 && webRes.body) {
    Readable.fromWeb(webRes.body).pipe(res);
    return;
  }
  res.end(await webRes.text());
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  try {
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      return await runHandler(api.handleChat, req, res);
    }
    if (url.pathname === '/api/ppt-chat' && req.method === 'POST') {
      return await runHandler(api.handlePptChat, req, res);
    }
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '服务异常：' + (e && e.message ? e.message : String(e)) }));
    return;
  }

  if (STATIC[url.pathname]) {
    const file = path.join(ROOT, STATIC[url.pathname]);
    try {
      const type = /\.js$/.test(file) ? 'application/javascript; charset=utf-8'
        : /\.css$/.test(file) ? 'text/css; charset=utf-8'
        : /\.woff2$/.test(file) ? 'font/woff2'
        : /\.webp$/.test(file) ? 'image/webp'
        : /\.png$/.test(file) ? 'image/png'
        : 'text/html; charset=utf-8';
      const bin = /\.(woff2|webp|png)$/.test(file);
      const body = bin ? fs.readFileSync(file) : fs.readFileSync(file, 'utf8');
      res.writeHead(200, { 'Content-Type': type });
      res.end(body);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('找不到文件：' + STATIC[url.pathname]);
    }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(FRONTEND);
});

const PORT = Number(process.env.PORT) || 8787;
server.listen(PORT, () => {
  console.log('Claire Essay 助手本地版已启动： http://localhost:' + PORT);
  console.log('  草稿箱详情： http://localhost:' + PORT + '/draft.html');
  console.log('  智能 PPT： http://localhost:' + PORT + '/ppt.html');
  console.log(KEY ? '✓ 已读取到 DeepSeek Key' : '⚠ 未设置 Key：请在本目录新建 key.txt 并粘贴 Key 后重启');
});
