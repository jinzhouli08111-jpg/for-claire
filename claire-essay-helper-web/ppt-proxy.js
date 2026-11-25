// ============================================================
// ppt-proxy.js —— Worker 侧：把生成请求转发给 Python 服务
//
// 设计：
//   · 服务地址和令牌从环境变量读（PPT_SERVICE_URL / PPT_SERVICE_TOKEN）
//   · 没配地址就返回 501，前端可以优雅降级到纯前端导出
//   · 超时放宽到 300 秒（生成一份 deck 约 10-40 秒，留足余量）
// ============================================================

const PPT_TIMEOUT_MS = 300000;

async function handlePptBuild(request, env) {
  const serviceUrl = String(env.PPT_SERVICE_URL || '').replace(/\/+$/, '');
  if (!serviceUrl) {
    return json({
      error: '未配置 PPT_SERVICE_URL',
      hint: '在 Cloudflare Worker 的环境变量里填入 Render 服务地址，例如 https://ppt-master-service.onrender.com'
    }, 501);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  const payload = {
    topic: String(body.topic || '').slice(0, 500),
    audience: String(body.audience || '普通读者').slice(0, 100),
    pages: Math.max(1, Math.min(20, parseInt(body.pages, 10) || 8)),
    style: String(body.style || 'old-money').slice(0, 40),
    extra: String(body.extra || '').slice(0, 500)
  };
  if (body.outline && typeof body.outline === 'object') {
    payload.outline = body.outline;
  }
  if (!payload.topic && !payload.outline) {
    return json({ error: '缺少 topic 或 outline' }, 400);
  }

  const headers = { 'Content-Type': 'application/json' };
  if (env.PPT_SERVICE_TOKEN) headers['x-service-token'] = env.PPT_SERVICE_TOKEN;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PPT_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(serviceUrl + '/api/build', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e && (e.name === 'AbortError' || String(e).includes('abort'));
    return json({
      error: aborted
        ? '生成超时（服务可能正在冷启动，请重试一次）'
        : '连接生成服务失败：' + (e && e.message ? e.message : String(e))
    }, 504);
  }
  clearTimeout(timer);

  if (!upstream.ok) {
    let detail = '';
    try { detail = (await upstream.text()).slice(0, 400); } catch (e) {}
    return json({ error: '生成服务返回 ' + upstream.status + '：' + detail }, upstream.status);
  }

  // 透传二进制 + 元信息头
  const passHeaders = {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'Content-Disposition': 'attachment; filename="deck.pptx"',
    'Cache-Control': 'no-store'
  };
  ['x-deck-title', 'x-deck-pages', 'x-deck-seconds', 'x-deck-checker', 'x-deck-fallback'].forEach((k) => {
    const v = upstream.headers.get(k);
    if (v) passHeaders[k] = v;
  });
  Object.assign(passHeaders, corsHeaders());

  return new Response(upstream.body, { headers: passHeaders });
}
