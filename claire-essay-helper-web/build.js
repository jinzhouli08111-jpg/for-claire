// ============================================================
// build.js —— 把页面文件打包进 worker.js
// 用法：node build.js
// 之后：wrangler deploy
// ============================================================
const fs = require('fs');
const path = require('path');
const dir = __dirname + path.sep;

// —— 本项目页面 ——
const home = fs.readFileSync(dir + 'home.html', 'utf8');
const homeA = fs.readFileSync(dir + 'home-a.html', 'utf8');
const homeB = fs.readFileSync(dir + 'home-b.html', 'utf8');
const homeC = fs.readFileSync(dir + 'home-c.html', 'utf8');
const homeD = fs.readFileSync(dir + 'home-d.html', 'utf8');
const homeE = fs.readFileSync(dir + 'home-e.html', 'utf8');
const stylesPage = fs.readFileSync(dir + 'styles.html', 'utf8');
const essay = fs.readFileSync(dir + 'preview.html', 'utf8');
const draft = fs.readFileSync(dir + 'draft.html', 'utf8');
const aicheck = fs.readFileSync(dir + 'ai-check.html', 'utf8');
const aiTemplate = fs.readFileSync(dir + 'ai-template.html', 'utf8');
const engine = fs.readFileSync(dir + 'ai-check.js', 'utf8');

// —— 智能 PPT ——
const pptPage = fs.readFileSync(dir + 'ppt.html', 'utf8');
const pptEngine = fs.readFileSync(dir + 'ppt-engine.js', 'utf8');
const pptExport = fs.readFileSync(dir + 'ppt-export.js', 'utf8');

// —— 思维导图：先由 pack-mindmap.js 从 ..\mindmap 打成单文件 ——
if (!fs.existsSync(dir + 'mindmap.html')) {
  console.log('未找到 mindmap.html，先执行 node pack-mindmap.js 生成…');
  require('child_process').execFileSync(process.execPath, [dir + 'pack-mindmap.js'], { stdio: 'inherit' });
}
const mindmap = fs.readFileSync(dir + 'mindmap.html', 'utf8');

// —— 从 worker.js 提取现有后端（SYSTEM_PROMPT 到 入口）——
// 注意：worker.js 是上一次构建的产物，可能已含 ppt 后端，
// 所以要在 PPT_SYSTEM_PROMPT 处截断，避免重复拼接。
const old = fs.readFileSync(dir + 'worker.js', 'utf8');
const s = old.indexOf('const SYSTEM_PROMPT');
let e = old.indexOf('// —— 入口');
if (s < 0 || e < 0 || e <= s) {
  console.error('worker.js 里找不到 SYSTEM_PROMPT / 入口 标记，无法提取后端代码');
  process.exit(1);
}
// 截掉上次已拼入的 ppt 后端
const pptMarker = old.indexOf('const PPT_SYSTEM_PROMPT');
if (pptMarker > s && pptMarker < e) {
  e = pptMarker;
}
const backend = old.slice(s, e).replace(/\s+$/, '');

// —— 智能 PPT 后端 ——
const pptBackend = fs.readFileSync(dir + 'ppt-backend.js', 'utf8');
const pptProxy = fs.readFileSync(dir + 'ppt-proxy.js', 'utf8');

// —— 设计系统：共享样式 + 拉丁子集字体（内嵌 base64）——
const dsCss = fs.readFileSync(dir + 'ds.css', 'utf8');
const fontB64 = fs.readFileSync(dir + 'fonts' + path.sep + 'manrope-latin.woff2').toString('base64');
const catWebp = fs.readFileSync(dir + 'cats' + path.sep + 'cat-hero-v3.webp').toString('base64');

const header = [
  '// ============================================================',
  '// For Claire · Cloudflare Worker（多页面版）',
  '// 页面：首页 / 论文打磨 / AI 查重 / 作图模板 / 智能 PPT',
  '// 部署后需要配置 Secret：DEEPSEEK_API_KEY',
  '// ============================================================',
  '',
  ''
].join('\n');

function wrap(name, content) {
  // 用 JSON.stringify 生成普通字符串字面量：
  // 反引号、${、反斜杠、换行都由它正确转义，不会破坏打包结果
  return 'const ' + name + ' = ' + JSON.stringify(content) + ';\n\n';
}

const routing = [
  '// —— base64 → 二进制（字体用）——',
  'function b64ToBytes(b64) {',
  "  const bin = atob(b64);",
  '  const out = new Uint8Array(bin.length);',
  '  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);',
  '  return out;',
  '}',
  '',
  '// —— 入口：按路径返回页面，/api/chat 转发 DeepSeek ——',
  'export default {',
  '  async fetch(request, env) {',
  '    const url = new URL(request.url);',
  '    const path = url.pathname;',
  '    // http → https（Cloudflare 后台的 Always Use HTTPS 需要 zone 级权限，这里自己兜底）',
  "    if (url.protocol === 'http:') {",
  "      return Response.redirect('https://' + url.host + path + url.search, 301);",
  '    }',
  "    if (request.method === 'OPTIONS') {",
  '      return new Response(null, { status: 204, headers: corsHeaders() });',
  '    }',
  "    if (path === '/ds.css') {",
  "      return new Response(DS_CSS, { headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });",
  '    }',
  "    if (path === '/fonts/manrope-latin.woff2') {",
  "      return new Response(b64ToBytes(FONT_B64), { headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' } });",
  '    }',
  "    if (path === '/cats/cat-hero-v3.webp') {",
  "      return new Response(b64ToBytes(CAT_WEBP), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' } });",
  '    }',
  "    if (path === '/cats/cat-hero.webp') {",
  "      return new Response(b64ToBytes(CAT_WEBP), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store' } });",
  '    }',
  "    if (path === '/api/chat' && request.method === 'POST') {",
  '      return handleChat(request, env);',
  '    }',
  "    if (path === '/api/ppt-chat' && request.method === 'POST') {",
  '      return handlePptChat(request, env);',
  '    }',
  "    if (path === '/api/ppt-build' && request.method === 'POST') {",
  '      return handlePptBuild(request, env);',
  '    }',
  "    if (path === '/ai-check.js') {",
  "      return new Response(AI_CHECK_JS, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });",
  '    }',
  "    if (path === '/ppt-engine.js') {",
  "      return new Response(PPT_ENGINE_JS, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });",
  '    }',
  "    if (path === '/ppt-export.js') {",
  "      return new Response(PPT_EXPORT_JS, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });",
  '    }',
  '    let page = HOME_E_HTML;',
  "    if (path === '/' || path === '/index.html' || path === '/home.html' || path === '/home') page = HOME_E_HTML;",
  "    else if (path === '/home-a.html' || path === '/home-a') page = HOME_A_HTML;",
  "    else if (path === '/home-b.html' || path === '/home-b') page = HOME_B_HTML;",
  "    else if (path === '/home-c.html' || path === '/home-c') page = HOME_C_HTML;",
  "    else if (path === '/home-d.html' || path === '/home-d') page = HOME_D_HTML;",
  "    else if (path === '/home-e.html' || path === '/home-e') page = HOME_E_HTML;",
  "    else if (path === '/styles.html' || path === '/styles') page = STYLES_HTML;",
  "    if (path === '/preview.html' || path === '/essay' || path === '/essay.html') page = ESSAY_HTML;",
  "    else if (path === '/draft.html' || path === '/draft') page = DRAFT_HTML;",
  "    else if (path === '/ai-check.html' || path === '/ai-check') page = AICHECK_HTML;",
  "    else if (path === '/ai-template.html' || path === '/ai-template') page = AI_TEMPLATE_HTML;",
  "    else if (path === '/mindmap.html' || path === '/mindmap') page = MINDMAP_HTML;",
  "    else if (path === '/ppt.html' || path === '/ppt') page = PPT_HTML;",
  "    return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });",
  '  }',
  '};',
  ''
].join('\n');

const out = header
  + wrap('DS_CSS', dsCss)
  + wrap('FONT_B64', fontB64)
  + wrap('CAT_WEBP', catWebp)
  + wrap('HOME_HTML', home)
  + wrap('HOME_A_HTML', homeA)
  + wrap('HOME_B_HTML', homeB)
  + wrap('HOME_C_HTML', homeC)
  + wrap('HOME_D_HTML', homeD)
  + wrap('HOME_E_HTML', homeE)
  + wrap('STYLES_HTML', stylesPage)
  + wrap('ESSAY_HTML', essay)
  + wrap('DRAFT_HTML', draft)
  + wrap('AICHECK_HTML', aicheck)
  + wrap('AI_TEMPLATE_HTML', aiTemplate)
  + wrap('MINDMAP_HTML', mindmap)
  + wrap('PPT_HTML', pptPage)
  + wrap('AI_CHECK_JS', engine)
  + wrap('PPT_ENGINE_JS', pptEngine)
  + wrap('PPT_EXPORT_JS', pptExport)
  + backend + '\n\n' + pptBackend + '\n\n' + pptProxy + '\n\n' + routing;

fs.writeFileSync(dir + 'worker.js', out, 'utf8');
console.log('worker.js 已重新生成，长度 =', out.length, '字节');
