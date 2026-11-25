/* =========================================================
 * shapes.js —— 图形库（18 种） / 图形路径 / 文字排版
 * ========================================================= */
(function (global) {
  'use strict';
  const MM = (global.MM = global.MM || {});

  /* 图形定义：id / 名称 / 默认宽高 */
  const SHAPE_LIST = [
    { id: 'textbox', name: '无框图形', w: 190, h: 60 },
    { id: 'ellipse', name: '椭圆 / 大圈', w: 200, h: 110 },
    { id: 'circle', name: '正圆', w: 130, h: 130 },
    { id: 'roundRect', name: '圆角矩形', w: 168, h: 64 },
    { id: 'rect', name: '矩形', w: 168, h: 64 },
    { id: 'diamond', name: '菱形 / 判断', w: 160, h: 92 },
    { id: 'hexagon', name: '六边形', w: 170, h: 74 },
    { id: 'octagon', name: '八边形', w: 150, h: 92 },
    { id: 'triangle', name: '三角形', w: 140, h: 104 },
    { id: 'parallelogram', name: '平行四边形', w: 180, h: 68 },
    { id: 'trapezoid', name: '梯形', w: 176, h: 72 },
    { id: 'parallelogram2', name: '右斜平行四边形', w: 180, h: 68 },
    { id: 'pentagon', name: '五边形', w: 148, h: 100 },
    { id: 'star5', name: '五角星', w: 120, h: 112 },
    { id: 'plus', name: '十字 / 加号', w: 120, h: 120 },
    { id: 'arrowRight', name: '右箭头', w: 180, h: 72 },
    { id: 'chevron', name: '燕尾箭头', w: 170, h: 70 },
    { id: 'cloud', name: '云朵', w: 180, h: 110 },
    { id: 'document', name: '文档', w: 150, h: 96 },
    { id: 'cylinder', name: '圆柱 / 存储', w: 130, h: 100 }
  ];

  const SHAPE_MAP = {};
  SHAPE_LIST.forEach(function (s) { SHAPE_MAP[s.id] = s; });

  function shapeName(id) { return (SHAPE_MAP[id] || { name: '图形' }).name; }
  function defaultSize(id) { const s = SHAPE_MAP[id] || { w: 168, h: 64 }; return { w: s.w, h: s.h }; }
  function isRound(id) { return id === 'ellipse' || id === 'circle'; }
  /* 无框图形：只有文字，不画填充和描边 */
  function isFrameless(id) { return id === 'textbox'; }

  /* 基础图元路径（返回 SVG path 字符串，局部坐标原点在左上角） */
  function primitivePath(shape, x, y, w, h) {
    const rx = x + w, ry = y + h, cx = x + w / 2, cy = y + h / 2;
    switch (shape) {
      case 'ellipse':
      case 'circle': {
        const rx = w / 2, ry = h / 2;
        const cx0 = x + rx, cy0 = y + ry;
        const left = cx0 - rx, right = cx0 + rx;
        return 'M ' + MM.round(left) + ' ' + MM.round(cy0) +
          ' A ' + MM.round(rx) + ' ' + MM.round(ry) + ' 0 1 0 ' + MM.round(right) + ' ' + MM.round(cy0) +
          ' A ' + MM.round(rx) + ' ' + MM.round(ry) + ' 0 1 0 ' + MM.round(left) + ' ' + MM.round(cy0) + ' Z';
      }
      case 'textbox':
        return 'M ' + x + ' ' + y + ' H ' + rx + ' V ' + ry + ' H ' + x + ' Z';
      case 'rect':
        return 'M ' + x + ' ' + y + ' H ' + rx + ' V ' + ry + ' H ' + x + ' Z';
      case 'roundRect': {
        const r = Math.min(16, h / 2, w / 2);
        return roundRectPath(x, y, w, h, r);
      }
      case 'diamond':
        return 'M ' + cx + ' ' + y + ' L ' + rx + ' ' + cy + ' L ' + cx + ' ' + ry + ' L ' + x + ' ' + cy + ' Z';
      case 'hexagon': {
        const a = Math.min(w * 0.25, h / 2);
        return 'M ' + (x + a) + ' ' + y + ' H ' + (rx - a) + ' L ' + rx + ' ' + cy +
          ' L ' + (rx - a) + ' ' + ry + ' H ' + (x + a) + ' L ' + x + ' ' + cy + ' Z';
      }
      case 'octagon': {
        const a = Math.min(w * 0.22, h * 0.22);
        return 'M ' + (x + a) + ' ' + y + ' H ' + (rx - a) + ' L ' + rx + ' ' + (y + a) +
          ' V ' + (ry - a) + ' L ' + (rx - a) + ' ' + ry + ' H ' + (x + a) +
          ' L ' + x + ' ' + (ry - a) + ' V ' + (y + a) + ' Z';
      }
      case 'triangle':
        return 'M ' + cx + ' ' + y + ' L ' + rx + ' ' + ry + ' L ' + x + ' ' + ry + ' Z';
      case 'parallelogram':
        return 'M ' + (x + w * 0.22) + ' ' + y + ' H ' + rx + ' L ' + (rx - w * 0.22) + ' ' + ry + ' H ' + x + ' Z';
      case 'parallelogram2':
        return 'M ' + x + ' ' + y + ' H ' + (rx - w * 0.22) + ' L ' + rx + ' ' + ry + ' H ' + (x + w * 0.22) + ' Z';
      case 'trapezoid':
        return 'M ' + (x + w * 0.2) + ' ' + y + ' H ' + (rx - w * 0.2) + ' L ' + rx + ' ' + ry + ' H ' + x + ' Z';
      case 'pentagon': {
        const pts = [0.5, 0, 1, 0.38, 0.81, 1, 0.19, 1, 0, 0.38];
        return polyPath(pts, x, y, w, h);
      }
      case 'star5': {
        const pts = [];
        for (let i = 0; i < 10; i++) {
          const ang = -Math.PI / 2 + (i * Math.PI) / 5;
          const rad = i % 2 === 0 ? 0.5 : 0.21;
          pts.push(0.5 + Math.cos(ang) * rad, 0.5 + Math.sin(ang) * rad);
        }
        return polyPath(pts, x, y, w, h);
      }
      case 'plus': {
        const a = 0.32;
        const pts = [a, 0, 1 - a, 0, 1 - a, a, 1, a, 1, 1 - a, 1 - a, 1 - a, 1 - a, 1, a, 1, a, 1 - a, 0, 1 - a, 0, a, a, a];
        return polyPath(pts, x, y, w, h);
      }
      case 'arrowRight': {
        const a = 0.62, b = 0.3;
        const pts = [0, b, a, b, a, 0, 1, 0.5, a, 1, a, 1 - b, 0, 1 - b];
        return polyPath(pts, x, y, w, h);
      }
      case 'chevron': {
        const k = 0.22;
        const pts = [0, 0, 1 - k, 0, 1, 0.5, 1 - k, 1, 0, 1, k, 0.5];
        return polyPath(pts, x, y, w, h);
      }
      case 'cloud': {
        const s = 'M ' + (x + w * 0.26) + ' ' + (y + h * 0.72) +
          ' C ' + (x - w * 0.03) + ' ' + (y + h * 0.72) + ' ' + (x - w * 0.03) + ' ' + (y + h * 0.36) + ' ' + (x + w * 0.19) + ' ' + (y + h * 0.34) +
          ' C ' + (x + w * 0.17) + ' ' + (y + h * 0.02) + ' ' + (x + w * 0.55) + ' ' + (y - h * 0.04) + ' ' + (x + w * 0.62) + ' ' + (y + h * 0.2) +
          ' C ' + (x + w * 0.78) + ' ' + (y + h * 0.04) + ' ' + (x + w * 1.02) + ' ' + (y + h * 0.2) + ' ' + (x + w * 0.92) + ' ' + (y + h * 0.42) +
          ' C ' + (x + w * 1.1) + ' ' + (y + h * 0.58) + ' ' + (x + w * 0.98) + ' ' + (y + h * 0.78) + ' ' + (x + w * 0.78) + ' ' + (y + h * 0.74) +
          ' Z';
        return s;
      }
      case 'document': {
        const wave = h * 0.16;
        return 'M ' + x + ' ' + y + ' H ' + rx + ' V ' + (ry - wave) +
          ' Q ' + (x + w * 0.75) + ' ' + (ry + wave * 0.9) + ' ' + (x + w * 0.5) + ' ' + (ry - wave * 0.35) +
          ' Q ' + (x + w * 0.25) + ' ' + (ry - wave * 1.6) + ' ' + x + ' ' + (ry + wave * 0.2) + ' Z';
      }
      case 'cylinder': {
        const ry2 = h * 0.16;
        return 'M ' + x + ' ' + (y + ry2) +
          ' A ' + (w / 2) + ' ' + ry2 + ' 0 0 1 ' + rx + ' ' + (y + ry2) +
          ' V ' + (ry - ry2) +
          ' A ' + (w / 2) + ' ' + ry2 + ' 0 0 1 ' + x + ' ' + (ry - ry2) + ' Z';
      }
      default:
        return roundRectPath(x, y, w, h, 16);
    }
  }

  function id_r(shape, w, h) { return { rx: w / 2, ry: h / 2 }; }
  function roundRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    return 'M ' + (x + rr) + ' ' + y + ' H ' + (x + w - rr) + ' Q ' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + rr) +
      ' V ' + (y + h - rr) + ' Q ' + (x + w) + ' ' + (y + h) + ' ' + (x + w - rr) + ' ' + (y + h) +
      ' H ' + (x + rr) + ' Q ' + x + ' ' + (y + h) + ' ' + x + ' ' + (y + h - rr) +
      ' V ' + (y + rr) + ' Q ' + x + ' ' + y + ' ' + (x + rr) + ' ' + y + ' Z';
  }
  function polyPath(pts, x, y, w, h) {
    let d = '';
    for (let i = 0; i < pts.length; i += 2) {
      d += (i === 0 ? 'M ' : ' L ') + MM.round(x + pts[i] * w) + ' ' + MM.round(y + pts[i + 1] * h);
    }
    return d + ' Z';
  }

  /* 文字可用区域（内边距，随形状变化） */
  function textBox(shape, x, y, w, h) {
    let px = 10, py = 8;
    if (isFrameless(shape)) { px = 5; py = 4; }
    else if (isRound(shape)) { px = w * 0.16; py = h * 0.2; }
    else if (shape === 'diamond') { px = w * 0.2; py = h * 0.24; }
    else if (shape === 'triangle') { px = w * 0.2; py = h * 0.38; }
    else if (shape === 'star5') { px = w * 0.24; py = h * 0.3; }
    else if (shape === 'plus') { px = w * 0.3; py = h * 0.16; }
    else if (shape === 'pentagon') { px = w * 0.16; py = h * 0.24; }
    else if (shape === 'hexagon' || shape === 'octagon' || shape === 'chevron' || shape === 'arrowRight') { px = w * 0.16; py = h * 0.14; }
    else if (shape === 'cloud') { px = w * 0.18; py = h * 0.2; }
    else if (shape === 'cylinder') { px = w * 0.12; py = h * 0.22; }
    else if (shape === 'document') { px = w * 0.1; py = h * 0.14; }
    else if (shape === 'parallelogram' || shape === 'parallelogram2' || shape === 'trapezoid') { px = w * 0.16; py = h * 0.12; }
    const bw = Math.max(12, w - px * 2), bh = Math.max(12, h - py * 2);
    return { x: x + px, y: y + py, w: bw, h: bh, inset: { l: px, t: py, r: px, b: py } };
  }

  /* ---------- 文字测量 ---------- */
  let _ctx = null;
  function measureCtx() {
    if (_ctx) return _ctx;
    try {
      const c = document.createElement('canvas');
      _ctx = c.getContext('2d');
    } catch (e) { _ctx = null; }
    return _ctx;
  }
  function fontOf(size, bold) { return (bold ? '700 ' : '400 ') + size + 'px "Microsoft YaHei","PingFang SC","Segoe UI",sans-serif'; }
  function measure(text, size, bold) {
    const ctx = measureCtx();
    if (ctx) {
      ctx.font = fontOf(size, bold);
      return ctx.measureText(text).width;
    }
    // 无 canvas 时的估算，供导出脚本复用
    let w = 0;
    for (const ch of text) w += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? size : size * 0.56;
    return w;
  }
  const measureEstimate = function (text, size, bold) {
    let w = 0;
    for (const ch of String(text)) {
      w += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? size * 1.02 : size * (bold ? 0.6 : 0.56);
    }
    return w;
  };

  /* 按宽度断行：中文逐字，英文按词 */
  function wrapLines(text, size, bold, maxWidth) {
    const out = [];
    const paras = String(text == null ? '' : text).split(/\r?\n/);
    const tokenRe = /[A-Za-z0-9@#$%&*_+\-/=.:'"~^]+|\s+|[\s\S]/gu;
    paras.forEach(function (p) {
      if (p === '') { out.push(''); return; }
      const tokens = p.match(tokenRe) || [];
      let line = '';
      tokens.forEach(function (tk) {
        const test = line + tk;
        if (line !== '' && measure(test, size, bold) > maxWidth) {
          if (/^\s+$/.test(tk)) { out.push(line); line = ''; return; }
          out.push(line.replace(/\s+$/, ''));
          line = tk;
        } else {
          line = test;
        }
      });
      if (line !== '') out.push(line.replace(/\s+$/, ''));
    });
    return out.filter(function (l, i) { return !(l === '' && i === out.length - 1 && out.length > 1); });
  }

  /* 在给定盒子内排版：必要时自动缩小字号 / 截断 */
  function layoutText(text, opt) {
    const size0 = opt.fontSize || 16;
    const bold = !!opt.bold;
    const maxW = opt.maxWidth, maxH = opt.maxHeight;
    const lh = 1.32;
    let size = size0;
    let lines = wrapLines(text, size, bold, maxW);
    let guard = 0;
    while (lines.length * size * lh > maxH && size > 9 && guard < 30) {
      size -= 1;
      lines = wrapLines(text, size, bold, maxW);
      guard++;
    }
    let truncated = false;
    const maxLines = Math.max(1, Math.floor(maxH / (size * lh)));
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      if (lines.length) lines[lines.length - 1] = cutToWidth(lines[lines.length - 1], size, bold, maxW) ;
      truncated = true;
    }
    const lineHeight = size * lh;
    const totalH = lines.length * lineHeight;
    return { lines: lines, fontSize: size, lineHeight: lineHeight, totalHeight: totalH, truncated: truncated };
  }
  function cutToWidth(line, size, bold, maxW) {
    let s = line;
    while (s.length > 1 && measure(s + '…', size, bold) > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  MM.shapes = {
    LIST: SHAPE_LIST,
    map: SHAPE_MAP,
    name: shapeName,
    defaultSize: defaultSize,
    isRound: isRound,
    isFrameless: isFrameless,
    path: primitivePath,
    textBox: textBox,
    measure: measure,
    measureEstimate: measureEstimate,
    wrapLines: wrapLines,
    layoutText: layoutText,
    fontOf: fontOf,
    roundRectPath: roundRectPath
  };
})(window);
