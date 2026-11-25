/* ============================================================
 * export.js —— 三端导出
 * PPT : PptxGenJS 生成可编辑 .pptx，逐层写入当前配色
 * PDF : html2canvas + jsPDF，像素级还原预览
 * Word: docx 生成可编辑 .docx，标题色随配色
 * ============================================================ */
(function (global) {
  'use strict';

  var cfg = global.POSTER_CONFIG || {};
  var CDN = {
    pptx: 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
    jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    docx: 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js',
  };

  var cache = {};
  function loadScript(key) {
    if (cache[key]) return cache[key];
    cache[key] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = CDN[key];
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('加载失败：' + CDN[key])); };
      document.head.appendChild(s);
    });
    return cache[key];
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function safeName(s) {
    return String(s || 'poster').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60);
  }

  function hex6(c) { return String(c || '#000000').replace('#', '').toUpperCase(); }

  function estHeight(text, fontSizePt, widthIn) {
    var charW = fontSizePt * 0.5 / 72;
    var perLine = Math.max(8, Math.floor(widthIn / charW));
    var chars = String(text || '').length;
    var lines = Math.max(1, Math.ceil(chars / perLine));
    return lines * fontSizePt * 1.32 / 72;
  }

  /* ============================ PPT ============================ */
  async function exportPptx() {
    await loadScript('pptx');
    var PptxGenJS = global.PptxGenJS;
    var fmt = cfg.formats.ppt;
    var meta = cfg.meta || {};
    var p = global.Theme.get().palette;
    var cols = global.PosterRender.distribute(fmt.cols || 3);
    var W = fmt.width, H = fmt.height;

    var sheet = new PptxGenJS();
    sheet.defineLayout({ name: 'POSTER', width: W, height: H });
    sheet.layout = 'POSTER';
    var slide = sheet.addSlide();
    slide.background = { color: hex6(p.bg) };

    /* 标题带 */
    var bandH = Math.max(1.5, H * 0.25);
    slide.addShape(sheet.ShapeType.rect, { x: 0, y: 0, w: W, h: bandH, line: { width: 0 }, fill: { color: hex6(p.main) } });
    slide.addShape(sheet.ShapeType.rect, { x: 0, y: bandH - 0.05, w: W, h: 0.05, line: { width: 0 }, fill: { color: hex6(p.accent) } });

    var marginX = 0.5;
    var padY = 0.28;
    if (meta.kicker) {
      slide.addText(String(meta.kicker).toUpperCase(), {
        x: marginX, y: padY, w: W - marginX * 2, h: 0.24,
        fontSize: 9, bold: true, charSpacing: 3, color: hex6(p.onMain), fontFace: 'Arial', align: 'left',
      });
    }
    slide.addText(meta.title || '', {
      x: marginX, y: padY + 0.26, w: W - marginX * 2, h: 0.78,
      fontSize: 24, bold: true, color: hex6(p.onMain), fontFace: 'Georgia', align: 'left', valign: 'top',
    });
    if (meta.subtitle) {
      slide.addText(meta.subtitle, {
        x: marginX, y: padY + 1.02, w: W - marginX * 2, h: 0.34,
        fontSize: 11, italic: true, color: hex6(p.onMain), fontFace: 'Georgia', align: 'left',
      });
    }
    var byline = [meta.authors, meta.affiliation].filter(Boolean).join('  ·  ');
    if (byline) {
      slide.addText(byline, {
        x: marginX, y: padY + 1.34, w: W - marginX * 2, h: 0.26,
        fontSize: 8.5, color: hex6(p.onMain), fontFace: 'Arial', align: 'left',
      });
    }

    /* 正文分栏 */
    var gap = 0.3;
    var colW = (W - marginX * 2 - gap * (cols.length - 1)) / cols.length;
    var bodyTop = bandH + 0.32;
    var bodyBottom = H - 0.45;

    cols.forEach(function (list, ci) {
      var x = marginX + ci * (colW + gap);
      var y = bodyTop;
      list.forEach(function (sec) {
        var fs = 10;
        var needed = 0;
        while (fs >= 6.5) {
          needed = 0.34;
          (sec.body || []).forEach(function (t) { needed += estHeight(t, fs, colW) + 0.05; });
          if (sec.figure) needed += Math.min(1.5, colW * 0.62) + (sec.figure.caption ? 0.3 : 0);
          if (y + needed <= bodyBottom || fs <= 6.5) break;
          fs -= 0.5;
        }
        slide.addText((sec.no ? sec.no + '  ' : '') + String(sec.title || '').toUpperCase(), {
          x: x, y: y, w: colW, h: 0.26,
          fontSize: 9, bold: true, charSpacing: 1, color: hex6(p.mainDark), fontFace: 'Arial', align: 'left', valign: 'middle',
        });
        slide.addShape(sheet.ShapeType.line, {
          x: x, y: y + 0.26, w: colW, h: 0,
          line: { color: hex6(p.main), width: 1.25 },
        });
        y += 0.32;

        (sec.body || []).forEach(function (t) {
          var h = estHeight(t, fs, colW);
          slide.addText(t, {
            x: x, y: y, w: colW, h: h,
            fontSize: fs, color: hex6(p.text), fontFace: 'Arial',
            align: 'left', valign: 'top', lineSpacingMultiple: 1.18,
          });
          y += h + 0.06;
        });

        if (sec.figure) {
          var imgH = Math.min(1.5, colW * 0.62);
          if (sec.figure.src) {
            try {
              slide.addImage({ path: sec.figure.src, x: x, y: y, w: colW, h: imgH, sizing: { type: 'contain', w: colW, h: imgH } });
            } catch (e) {
              slide.addShape(sheet.ShapeType.rect, { x: x, y: y, w: colW, h: imgH, line: { color: hex6(p.line), width: 1, dashType: 'dash' }, fill: { color: hex6(p.bg) } });
            }
          } else {
            slide.addShape(sheet.ShapeType.rect, {
              x: x, y: y, w: colW, h: imgH,
              line: { color: hex6(p.line), width: 1, dashType: 'dash' },
              fill: { color: hex6(p.light) },
            });
            slide.addText('IMAGE', {
              x: x, y: y + imgH / 2 - 0.12, w: colW, h: 0.24,
              fontSize: 8, color: hex6(p.muted), fontFace: 'Arial', align: 'center', charSpacing: 2,
            });
          }
          y += imgH + 0.04;
          if (sec.figure.caption) {
            slide.addText(sec.figure.caption, {
              x: x, y: y, w: colW, h: 0.28,
              fontSize: 7, italic: true, color: hex6(p.muted), fontFace: 'Arial', align: 'left',
            });
            y += 0.3;
          }
        }
        y += 0.12;
      });
    });

    if (meta.footer) {
      slide.addText(meta.footer, {
        x: marginX, y: H - 0.38, w: W - marginX * 2, h: 0.24,
        fontSize: 7.5, color: hex6(p.muted), fontFace: 'Arial', align: 'left',
      });
    }

    await sheet.writeFile({ fileName: safeName(meta.title) + '.pptx' });
    return 'PPTX 已生成';
  }

  /* ============================ PDF ============================ */
  async function exportPdf() {
    await Promise.all([loadScript('html2canvas'), loadScript('jspdf')]);
    var node = document.getElementById('poster-pdf');
    if (!node) throw new Error('未找到 PDF 版式');
    var stage = document.getElementById('stage');

    var oldTransform = node.style.transform;
    node.style.transform = 'none';
    node.style.position = 'fixed';
    node.style.left = '-20000px';
    node.style.top = '0';

    var canvas;
    try {
      canvas = await global.html2canvas(node, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#FFFFFF',
        logging: false,
        windowWidth: node.offsetWidth,
        windowHeight: node.offsetHeight,
      });
    } finally {
      node.style.transform = oldTransform;
      node.style.position = '';
      node.style.left = '';
      node.style.top = '';
    }

    var jsPDFCtor = global.jspdf && global.jspdf.jsPDF;
    if (!jsPDFCtor) throw new Error('jsPDF 未就绪');
    var pdf = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    var pw = pdf.internal.pageSize.getWidth();
    var ph = pdf.internal.pageSize.getHeight();
    var ratio = canvas.height / canvas.width;
    var w = pw, h = pw * ratio;
    if (h > ph) { h = ph; w = ph / ratio; }
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', (pw - w) / 2, 0, w, h);
    pdf.save(safeName(cfg.meta && cfg.meta.title) + '.pdf');
    return 'PDF 已生成';
  }

  /* ============================ Word ============================ */
  async function exportDocx() {
    await loadScript('docx');
    var D = global.docx;
    var meta = cfg.meta || {};
    var p = global.Theme.get().palette;
    var TW = 11906, TH = 16838; /* A4, twips */

    var children = [];
    var P = D.Paragraph, T = D.TextRun, A = D.AlignmentType;

    if (meta.kicker) {
      children.push(new P({ children: [new T({ text: String(meta.kicker).toUpperCase(), bold: true, size: 18, color: hex6(p.main) })] }));
    }
    children.push(new P({
      spacing: { after: 120 },
      children: [new T({ text: meta.title || '', bold: true, size: 40, color: hex6(p.main), font: 'Georgia' })],
    }));
    if (meta.subtitle) {
      children.push(new P({ spacing: { after: 120 }, children: [new T({ text: meta.subtitle, italics: true, size: 24, color: hex6(p.muted), font: 'Georgia' })] }));
    }
    if (meta.authors) {
      children.push(new P({ spacing: { after: 40 }, children: [new T({ text: meta.authors, size: 20, color: hex6(p.text) })] }));
    }
    if (meta.affiliation) {
      children.push(new P({ spacing: { after: 200 }, children: [new T({ text: meta.affiliation, size: 20, color: hex6(p.muted) })] }));
    }
    children.push(new P({
      spacing: { after: 200 },
      border: { bottom: { style: D.BorderStyle.SINGLE, size: 12, color: hex6(p.accent), space: 1 } },
      children: [new T({ text: '', size: 2 })],
    }));

    var secs = cfg.sections || [];
    for (var i = 0; i < secs.length; i++) {
      var sec = secs[i];
      children.push(new P({
        spacing: { before: 220, after: 100 },
        children: [new T({ text: (sec.no ? sec.no + '  ' : '') + String(sec.title || '').toUpperCase(), bold: true, size: 22, color: hex6(p.mainDark) })],
      }));
      (sec.body || []).forEach(function (t) {
        children.push(new P({
          spacing: { after: 120, line: 320 },
          alignment: A.JUSTIFIED,
          children: [new T({ text: t, size: 21, color: hex6(p.text) })],
        }));
      });
      if (sec.figure) {
        if (sec.figure.src) {
          try {
            var resp = await fetch(sec.figure.src);
            var buf = await resp.arrayBuffer();
            children.push(new P({
              alignment: A.CENTER,
              spacing: { before: 120, after: 60 },
              children: [new D.ImageRun({ data: new Uint8Array(buf), transformation: { width: 480, height: 300 } })],
            }));
          } catch (e) { /* 图片读取失败时保留图注 */ }
        }
        if (sec.figure.caption) {
          children.push(new P({
            alignment: A.CENTER,
            spacing: { after: 160 },
            children: [new T({ text: sec.figure.caption, italics: true, size: 18, color: hex6(p.muted) })],
          }));
        }
      }
    }

    if (meta.footer) {
      children.push(new P({
        spacing: { before: 360 },
        children: [new T({ text: meta.footer, size: 16, color: hex6(p.muted) })],
      }));
    }

    var doc = new D.Document({
      creator: 'Poster Layout',
      title: meta.title || 'Poster',
      sections: [{
        properties: { page: { size: { width: TW, height: TH }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
        children: children,
      }],
    });

    var blob = await D.Packer.toBlob(doc);
    download(blob, safeName(meta.title) + '.docx');
    return 'DOCX 已生成';
  }

  global.PosterExport = { pptx: exportPptx, pdf: exportPdf, docx: exportDocx };
})(window);
