/* =========================================================
 * exporters.js —— 导出：PPTX / DOCX（浏览器内直接生成原生可编辑文件）
 *                  PDF（矢量打印）/ SVG / PNG / JSON
 * ========================================================= */
(function (global) {
  'use strict';
  const MM = global.MM;
  const M = MM.model;
  const S = MM.shapes;

  function sanitize(name) {
    return String(name || '思维导图').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 60) || '思维导图';
  }
  function stamp() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  function hexOf(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    return m ? '#' + m[1].toUpperCase() : '#FFFFFF';
  }

  /* ---------------- 导出载荷：图形 / 文字 / 连线的几何信息 ---------------- */
  function buildPayload(doc, opt) {
    const o = opt || {};
    const pad = o.pad === undefined ? 40 : o.pad;
    const b = M.bounds(doc, pad);
    const ox = -b.x, oy = -b.y;
    const items = [];

    // 连线先入列，图形覆盖其上（与画布图层顺序一致）
    doc.edges.forEach(function (edge) {
      const geo = M.edgeGeometry(edge, doc);
      if (!geo) return;
      if (!M.findNode(doc, edge.from.node) || !M.findNode(doc, edge.to.node)) return;
      const pts = [];
      if (edge.route === 'curve') {
        for (let i = 0; i < 25; i++) {
          const t = i / 24;
          const mt = 1 - t;
          pts.push({
            x: +(mt * mt * mt * geo.p1.x + 3 * mt * mt * t * geo.c1.x + 3 * mt * t * t * geo.c2.x + t * t * t * geo.p2.x + ox).toFixed(2),
            y: +(mt * mt * mt * geo.p1.y + 3 * mt * mt * t * geo.c1.y + 3 * mt * t * t * geo.c2.y + t * t * t * geo.p2.y + oy).toFixed(2)
          });
        }
      } else {
        geo.points.forEach(function (p) { pts.push({ x: +(p.x + ox).toFixed(2), y: +(p.y + oy).toFixed(2) }); });
      }
      items.push({
        kind: 'edge',
        id: edge.id,
        route: edge.route,
        dash: edge.dash,
        color: hexOf(edge.color),
        width: edge.width,
        arrowStart: !!edge.arrowStart,
        arrowEnd: !!edge.arrowEnd,
        points: pts
      });
    });

    doc.nodes.forEach(function (n) {
      const box = S.textBox(n.shape, 0, 0, n.w, n.h);
      const lay = S.layoutText(n.text, {
        fontSize: n.fontSize, bold: n.bold, maxWidth: box.w, maxHeight: box.h
      });
      items.push({
        kind: 'node',
        id: n.id,
        shape: n.shape,
        x: +(n.x + ox).toFixed(2),
        y: +(n.y + oy).toFixed(2),
        w: +n.w.toFixed(2),
        h: +n.h.toFixed(2),
        fill: hexOf(n.fill),
        stroke: hexOf(n.stroke),
        strokeWidth: n.strokeWidth,
        text: n.text || '',
        textColor: hexOf(n.textColor),
        fontSize: Math.round(lay.fontSize * 10) / 10,
        bold: !!n.bold,
        align: n.align,
        frameless: S.isFrameless(n.shape),
        ins: {
          l: Math.round(box.inset.l), t: Math.round(box.inset.t),
          r: Math.round(box.inset.r), b: Math.round(box.inset.b)
        }
      });
    });

    return {
      version: 1,
      title: doc.title || '思维导图',
      bg: hexOf(doc.canvas.bg || '#FFFFFF'),
      width: +b.w.toFixed(2),
      height: +b.h.toFixed(2),
      items: items
    };
  }

  /* ---------------- PPTX / DOCX ---------------- */
  function exportPptx(doc, cb) {
    cb.toast('正在生成 PPTX（原生图形 + 可编辑文字）…');
    const payload = buildPayload(doc);
    Promise.resolve(MM.ooxml.pptxBlob(payload))
      .then(function (blob) {
        download(blob, sanitize(doc.title) + '-' + stamp() + '.pptx');
        cb.toast('已导出 PPTX。图形、文字、连线都是 PowerPoint 原生对象，\n可以直接双击改字、拖动、改颜色。', 'ok', 4600);
      })
      .catch(function (e) { cb.toast('PPTX 生成失败：' + (e && e.message || e), 'err', 6000); });
  }

  function exportDocx(doc, cb) {
    cb.toast('正在生成 DOCX（原生图形 + 可编辑文字）…');
    const payload = buildPayload(doc);
    Promise.resolve(MM.ooxml.docxBlob(payload))
      .then(function (blob) {
        download(blob, sanitize(doc.title) + '-' + stamp() + '.docx');
        cb.toast('已导出 DOCX。每个图形都是 Word「形状」对象，文字可直接编辑。', 'ok', 4600);
      })
      .catch(function (e) { cb.toast('DOCX 生成失败：' + (e && e.message || e), 'err', 6000); });
  }

  /* ---------------- PDF（浏览器矢量打印） ---------------- */
  function printDoc(doc, cb) {
    let areaEl = document.getElementById('printArea');
    if (!areaEl) {
      areaEl = document.createElement('div');
      areaEl.id = 'printArea';
      document.body.appendChild(areaEl);
    }
    areaEl.innerHTML = MM.render.toSVG(doc, { pad: 24 });
    cb.toast('已打开打印窗口：在「目标打印机」里选「另存为 PDF / Microsoft Print to PDF」，\n即可得到文字可选中的矢量 PDF。', 'ok', 7000);
    setTimeout(function () { window.print(); }, 120);
  }

  /* ---------------- SVG / PNG / JSON ---------------- */
  function exportSVG(doc, cb) {
    const svgText = MM.render.toSVG(doc, { pad: 48 });
    const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svgText],
      { type: 'image/svg+xml;charset=utf-8' });
    download(blob, sanitize(doc.title) + '-' + stamp() + '.svg');
    cb.toast('已导出 SVG 矢量图（可在 Illustrator / Figma 里继续编辑）', 'ok');
  }

  function exportPNG(doc, cb) {
    const svgText = MM.render.toSVG(doc, { pad: 48 });
    const b = M.bounds(doc, 48);
    const scale = 2;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = function () {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(b.w * scale));
      canvas.height = Math.max(1, Math.round(b.h * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = doc.canvas.bg || '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (blob) {
        if (!blob) { cb.toast('PNG 生成失败，请改用 SVG 导出', 'err'); return; }
        download(blob, sanitize(doc.title) + '-' + stamp() + '.png');
        cb.toast('已导出 PNG 图片（2 倍高清）', 'ok');
      }, 'image/png');
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      cb.toast('PNG 生成失败，请改用 SVG 导出', 'err');
    };
    img.src = url;
  }

  function exportJSON(doc, cb) {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json;charset=utf-8' });
    download(blob, sanitize(doc.title) + '.mindmap.json');
    cb.toast('已保存工程文件，可通过「打开工程」再次载入', 'ok');
  }

  /* ---------------- 入口 ---------------- */
  function run(action, doc, cb) {
    const h = cb || { toast: function () { } };
    switch (action) {
      case 'pptx': exportPptx(doc, h); break;
      case 'docx': exportDocx(doc, h); break;
      case 'pdf': printDoc(doc, h); break;
      case 'svg': exportSVG(doc, h); break;
      case 'png': exportPNG(doc, h); break;
      case 'json': exportJSON(doc, h); break;
      case 'open': if (h.onOpen) h.onOpen(); break;
      case 'print': printDoc(doc, h); break;
      default: h.toast('未知的导出类型：' + action, 'err');
    }
  }

  MM.exporters = {
    run: run,
    buildPayload: buildPayload
  };
})(window);
