/* =========================================================
 * ooxml.js —— 纯 JS 生成原生可编辑的 PPTX / DOCX
 *   · 自带 zip 打包（CompressionStream 可用时压缩，否则存储）
 *   · 图形 = DrawingML 预设几何(prstGeom)，可继续编辑/缩放/改色
 *   · 文字 = 文本框内容，可直接双击修改
 *   · 连线 = 自定义几何(custGeom)，支持直线/折线/曲线、实线/虚线/点线、箭头
 * ========================================================= */
(function (global) {
  'use strict';
  const MM = (global.MM = global.MM || {});

  /* ---------- CRC32 ---------- */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- zip ---------- */
  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  function toBytes(str) {
    if (encoder) return encoder.encode(str);
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  async function deflateRaw(bytes) {
    if (typeof CompressionStream !== 'function' || typeof Response !== 'function') return null;
    try {
      const cs = new CompressionStream('deflate-raw');
      const stream = new Blob([bytes]).stream().pipeThrough(cs);
      const buf = await new Response(stream).arrayBuffer();
      const out = new Uint8Array(buf);
      return out.length && out.length < bytes.length ? out : null;
    } catch (e) { return null; }
  }

  function dosTime(d) {
    const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
    const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time, date };
  }

  async function zip(files) {
    const now = new Date();
    const { time, date } = dosTime(now);
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const nameBytes = toBytes(f.name);
      const raw = f.bytes || toBytes(f.text || '');
      const crc = crc32(raw);
      const packed = await deflateRaw(raw);
      const data = packed || raw;
      const method = packed ? 8 : 0;

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, method, true);
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, raw.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      chunks.push(local, data);

      const cDir = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cDir.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, method, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, raw.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cDir.set(nameBytes, 46);
      central.push(cDir);

      offset += local.length + data.length;
    }

    const centralSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    return new Blob(chunks.concat(central, [end]), { type: 'application/octet-stream' });
  }

  /* ---------- 基础工具 ---------- */
  const EMU = 9525;      // 1px(96dpi) -> EMU
  const TWIP = 15;       // 1px -> twips
  function emu(px) { return Math.round(px * EMU); }
  function twip(px) { return Math.round(px * TWIP); }
  function szOf(px) { return Math.max(100, Math.round(px * 75)); }  // 磅 * 100
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }
  function hexOf(c) { return String(c || '#FFFFFF').replace('#', '').toUpperCase(); }
  function dashOf(dash) { return dash === 'dash' ? 'dash' : dash === 'dot' ? 'dot' : 'solid'; }
  function algnOf(a) { return a === 'left' ? 'l' : a === 'right' ? 'r' : 'ctr'; }
  function jcOf(a) { return a === 'left' ? 'left' : a === 'right' ? 'right' : 'center'; }

  const FONT = '微软雅黑';

  /* 形状 → DrawingML 预设几何名 */
  const PRST = {
    rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', circle: 'ellipse',
    diamond: 'diamond', hexagon: 'hexagon', octagon: 'octagon', triangle: 'triangle',
    parallelogram: 'parallelogram', parallelogram2: 'parallelogram', trapezoid: 'trapezoid',
    pentagon: 'homePlate', star5: 'star5', plus: 'mathPlus', arrowRight: 'rightArrow',
    chevron: 'chevron', cloud: 'cloud', document: 'flowChartDocument', cylinder: 'can'
  };

  /* ---------- 文本：拆段落 ---------- */
  function paragraphs(text) {
    const t = String(text == null ? '' : text);
    return t.split(/\r?\n/);
  }

  function runFontXml(size) {
    return '<a:latin typeface="' + esc(FONT) + '"/><a:ea typeface="' + esc(FONT) +
      '"/><a:cs typeface="' + esc(FONT) + '"/><a:sym typeface="' + esc(FONT) + '"/>';
  }

  /* ===================== PPTX ===================== */
  function shapeXml(item, idx) {
    const x = emu(item.x), y = emu(item.y), cx = emu(item.w), cy = emu(item.h);
    const id = idx + 2;
    let geom;
    if (item.kind === 'edge') return edgeShapeXml(item, id);
    const prst = PRST[item.shape] || 'rect';
    let flip = '';
    if (item.shape === 'parallelogram2') flip = ' flipH="1"';
    geom = '<a:prstGeom prst="' + prst + '"><a:avLst/></a:prstGeom>';
    const ins = item.ins || { l: 10, t: 8, r: 10, b: 8 };
    const paras = paragraphs(item.text).map(function (line) {
      return '<a:p><a:pPr algn="' + algnOf(item.align) + '"/>' +
        (line === '' ? '<a:endParaRPr lang="zh-CN" sz="' + szOf(item.fontSize) + '" dirty="0"/>' :
          '<a:r><a:rPr lang="zh-CN" altLang="en-US" sz="' + szOf(item.fontSize) + '"' +
          (item.bold ? ' b="1"' : ' b="0"') + ' dirty="0">' +
          '<a:solidFill><a:srgbClr val="' + hexOf(item.textColor) + '"/></a:solidFill>' +
          runFontXml(item.fontSize) + '</a:rPr><a:t>' + esc(line) + '</a:t></a:r>') +
        '</a:p>';
    }).join('');

    // 无框图形（文字框）：不填色、不描边，按文本框导出
    const bare = !!item.frameless;
    const fillXml = bare
      ? '<a:noFill/>'
      : '<a:solidFill><a:srgbClr val="' + hexOf(item.fill) + '"/></a:solidFill>';
    const lineXml = bare
      ? '<a:ln><a:noFill/></a:ln>'
      : '<a:ln w="' + Math.max(0, Math.round(item.strokeWidth * EMU)) + '" cap="rnd">' +
        (item.strokeWidth > 0
          ? '<a:solidFill><a:srgbClr val="' + hexOf(item.stroke) + '"/></a:solidFill><a:prstDash val="solid"/>'
          : '<a:noFill/>') +
        '</a:ln>';

    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + esc('图形 ' + id) + '"/>' +
      '<p:cNvSpPr txBox="' + (bare ? 1 : 0) + '"/><p:nvPr/></p:nvSpPr><p:spPr>' +
      '<a:xfrm' + flip + '><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      geom + fillXml + lineXml + '</p:spPr>' +
      '<p:txBody><a:bodyPr vert="horz" wrap="square" lIns="' + emu(ins.l) + '" tIns="' + emu(ins.t) +
      '" rIns="' + emu(ins.r) + '" bIns="' + emu(ins.b) + '" anchor="ctr" anchorCtr="0" rtlCol="0">' +
      '<a:normAutofit/></a:bodyPr><a:lstStyle/>' + paras + '</p:txBody></p:sp>';
  }

  function edgeShapeXml(item, id) {
    const pts = item.points || [];
    if (pts.length < 2) return '';
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(function (p) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    });
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const W = emu(w), H = emu(h);

    // 路径：折线用 lnTo，曲线用 cubicBezTo（用相邻点做控制点近似，足够平滑）
    let path = '';
    const P = function (p) {
      return '<a:pt x="' + Math.round((p.x - minX) * EMU) + '" y="' + Math.round((p.y - minY) * EMU) + '"/>';
    };
    path += '<a:moveTo>' + P(pts[0]) + '</a:moveTo>';
    if (item.route === 'curve' && pts.length >= 4) {
      // 以 Catmull-Rom 转三次贝塞尔，还原浏览器里的平滑曲线
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
        const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
        path += '<a:cubicBezTo>' + P(c1) + P(c2) + P(p2) + '</a:cubicBezTo>';
      }
    } else {
      for (let i = 1; i < pts.length; i++) path += '<a:lnTo>' + P(pts[i]) + '</a:lnTo>';
    }

    const arrow = function (on, tag) {
      return on ? '<a:' + tag + ' type="triangle" w="med" len="med"/>' : '';
    };

    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + esc('连线 ' + id) + '"/>' +
      '<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>' +
      '<a:xfrm><a:off x="' + emu(minX) + '" y="' + emu(minY) + '"/><a:ext cx="' + W + '" cy="' + H + '"/></a:xfrm>' +
      '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/>' +
      '<a:rect l="0" t="0" r="' + W + '" b="' + H + '"/>' +
      '<a:pathLst><a:path w="' + W + '" h="' + H + '" fill="none">' + path + '</a:path></a:pathLst>' +
      '</a:custGeom>' +
      '<a:noFill/>' +
      '<a:ln w="' + Math.max(1, Math.round(item.width * EMU)) + '" cap="rnd">' +
      '<a:solidFill><a:srgbClr val="' + hexOf(item.color) + '"/></a:solidFill>' +
      '<a:prstDash val="' + dashOf(item.dash) + '"/>' +
      arrow(item.arrowStart, 'headEnd') + arrow(item.arrowEnd, 'tailEnd') +
      '</a:ln></p:spPr>' +
      '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>';
  }

  function slideXml(payload) {
    const tree = (payload.items || []).map(shapeXml).filter(Boolean).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="' + hexOf(payload.bg) + '"/></a:solidFill>' +
      '<a:effectLst/></p:bgPr></p:bg>' +
      '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      tree + '</p:spTree></p:cSld>' +
      '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  }

  const THEME = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office">' +
    '<a:themeElements><a:clrScheme name="Office">' +
    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
    '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
    '<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
    '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
    '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
    '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
    '</a:clrScheme><a:fontScheme name="Office">' +
    '<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface="微软雅黑"/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="微软雅黑"/><a:cs typeface=""/></a:minorFont>' +
    '</a:fontScheme><a:fmtScheme name="Office">' +
    '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
    '<a:lnStyleLst>' +
    '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
    '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
    '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
    '</a:lnStyleLst><a:effectStyleLst>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
    '</a:fmtScheme></a:themeElements></a:theme>';

  function pptxParts(payload) {
    const W = emu(payload.width), H = emu(payload.height);
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
    const files = [];

    files.push({
      name: '[Content_Types].xml', text: xml +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
        '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        '</Types>'
    });

    files.push({
      name: '_rels/.rels', text: xml +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
        '</Relationships>'
    });

    files.push({
      name: 'docProps/core.xml', text: xml +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:title>' + esc(payload.title) + '</dc:title><dc:creator>思维导图工作台</dc:creator>' +
        '<cp:lastModifiedBy>思维导图工作台</cp:lastModifiedBy>' +
        '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '</dcterms:created>' +
        '<dcterms:modified xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '</dcterms:modified>' +
        '</cp:coreProperties>'
    });

    files.push({
      name: 'docProps/app.xml', text: xml +
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
        '<Application>Microsoft Office PowerPoint</Application><Slides>1</Slides><Company></Company>' +
        '</Properties>'
    });

    files.push({
      name: 'ppt/presentation.xml', text: xml +
        '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
        '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
        '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>' +
        '<p:sldSz cx="' + W + '" cy="' + H + '" type="custom"/>' +
        '<p:notesSz cx="6858000" cy="9144000"/>' +
        '<p:defaultTextStyle><a:defPPr><a:defRPr lang="zh-CN"/></a:defPPr></p:defaultTextStyle>' +
        '</p:presentation>'
    });

    files.push({
      name: 'ppt/_rels/presentation.xml.rels', text: xml +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
        '</Relationships>'
    });

    files.push({
      name: 'ppt/slideMasters/slideMaster1.xml', text: xml +
        '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
        '<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' +
        '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
        '</p:spTree></p:cSld>' +
        '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" ' +
        'accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
        '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
        '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle>' +
        '<p:bodyStyle><a:lvl1pPr><a:defRPr sz="2000"/></a:lvl1pPr></p:bodyStyle>' +
        '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles>' +
        '</p:sldMaster>'
    });

    files.push({
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', text: xml +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>' +
        '</Relationships>'
    });

    files.push({
      name: 'ppt/slideLayouts/slideLayout1.xml', text: xml +
        '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">' +
        '<p:cSld name="空白">' +
        '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
        '</p:spTree></p:cSld>' +
        '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'
    });

    files.push({
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', text: xml +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>' +
        '</Relationships>'
    });

    files.push({ name: 'ppt/theme/theme1.xml', text: THEME });

    files.push({
      name: 'ppt/slides/slide1.xml', text: slideXml(payload)
    });

    files.push({
      name: 'ppt/slides/_rels/slide1.xml.rels', text: xml +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
        '</Relationships>'
    });

    return files;
  }

  /* ===================== DOCX ===================== */
  const MAX_PAGE_EMU = 22 * 914400;   // Word 页面上限 22 英寸

  function docxParts(payload) {
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
    let k = 1;   // 全局缩放：保证页面不超过 Word 的 22 英寸上限
    const wEmu0 = emu(payload.width), hEmu0 = emu(payload.height);
    if (wEmu0 > MAX_PAGE_EMU) k = MAX_PAGE_EMU / wEmu0;
    if (hEmu0 * k > MAX_PAGE_EMU) k = MAX_PAGE_EMU / hEmu0;

    const E = function (px) { return Math.round(emu(px) * k); };
    const pageWTw = Math.round(payload.width * TWIP * k) + 360;
    const pageHTw = Math.round(payload.height * TWIP * k) + 360;

    let drawRun = '';
    let idSeq = 2;

    const insEmu = function (ins) {
      return {
        l: E(ins.l), t: E(ins.t), r: E(ins.r), b: E(ins.b)
      };
    };

    (payload.items || []).forEach(function (item) {
      const id = idSeq++;
      if (item.kind === 'edge') {
        const pts = item.points || [];
        if (pts.length < 2) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pts.forEach(function (p) {
          minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        });
        const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
        const cw = E(w), ch = E(h);
        let path = '';
        const PT = function (p) {
          return '<a:pt x="' + Math.round(emu(p.x - minX) * k) + '" y="' + Math.round(emu(p.y - minY) * k) + '"/>';
        };
        path += '<a:moveTo>' + PT(pts[0]) + '</a:moveTo>';
        if (item.route === 'curve' && pts.length >= 4) {
          for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
            const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
            const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
            path += '<a:cubicBezTo>' + PT(c1) + PT(c2) + PT(p2) + '</a:cubicBezTo>';
          }
        } else {
          for (let i = 1; i < pts.length; i++) path += '<a:lnTo>' + PT(pts[i]) + '</a:lnTo>';
        }

        drawRun += wordShapeXml({
          id: id,
          offX: E(minX), offY: E(minY), cx: cw, cy: ch,
          geom: '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/>' +
            '<a:rect l="0" t="0" r="' + cw + '" b="' + ch + '"/>' +
            '<a:pathLst><a:path w="' + cw + '" h="' + ch + '" fill="none">' + path + '</a:path></a:pathLst></a:custGeom>',
          fillXml: '<a:noFill/>',
          lineXml: '<a:ln w="' + Math.max(1270, Math.round(item.width * EMU * k)) + '" cap="rnd">' +
            '<a:solidFill><a:srgbClr val="' + hexOf(item.color) + '"/></a:solidFill>' +
            '<a:prstDash val="' + dashOf(item.dash) + '"/>' +
            (item.arrowEnd ? '<a:tailEnd type="triangle" w="med" len="med"/>' : '') +
            '</a:ln>',
          name: '连线 ' + id
        });

        // Word 对自定义几何的箭头支持不稳定：再补一个真实的三角形箭头
        if (item.arrowEnd) {
          drawRun += wordArrowXml(pts[pts.length - 2], pts[pts.length - 1], item, idSeq++, k, E);
        }
        if (item.arrowStart) {
          drawRun += wordArrowXml(pts[1], pts[0], item, idSeq++, k, E);
        }
        return;
      }

      const ins = insEmu(item.ins || { l: 10, t: 8, r: 10, b: 8 });
      const txbx = '<wps:txbx><w:txbxContent>' + paragraphs(item.text).map(function (line) {
        return '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>' +
          '<w:jc w:val="' + jcOf(item.align) + '"/>' +
          '<w:rPr><w:rFonts w:ascii="' + esc(FONT) + '" w:hAnsi="' + esc(FONT) + '" w:eastAsia="' + esc(FONT) + '"/>' +
          '<w:sz w:val="' + Math.max(2, Math.round(item.fontSize * 1.5)) + '"/></w:rPr></w:pPr>' +
          '<w:r><w:rPr><w:rFonts w:ascii="' + esc(FONT) + '" w:hAnsi="' + esc(FONT) + '" w:eastAsia="' + esc(FONT) + '"/>' +
          (item.bold ? '<w:b/><w:bCs/>' : '') +
          '<w:color w:val="' + hexOf(item.textColor) + '"/>' +
          '<w:sz w:val="' + Math.max(2, Math.round(item.fontSize * 1.5)) + '"/>' +
          '<w:szCs w:val="' + Math.max(2, Math.round(item.fontSize * 1.5)) + '"/></w:rPr>' +
          '<w:t xml:space="preserve">' + esc(line) + '</w:t></w:r></w:p>';
      }).join('') + '</w:txbxContent></wps:txbx>';

      drawRun += wordShapeXml({
        id: id,
        offX: E(item.x), offY: E(item.y), cx: E(item.w), cy: E(item.h),
        geom: '<a:prstGeom prst="' + (PRST[item.shape] || 'rect') + '"><a:avLst/></a:prstGeom>',
        fillXml: item.frameless
          ? '<a:noFill/>'
          : '<a:solidFill><a:srgbClr val="' + hexOf(item.fill) + '"/></a:solidFill>',
        lineXml: item.frameless
          ? '<a:ln><a:noFill/></a:ln>'
          : item.strokeWidth > 0
            ? '<a:ln w="' + Math.round(item.strokeWidth * EMU) + '"><a:solidFill><a:srgbClr val="' + hexOf(item.stroke) + '"/></a:solidFill><a:prstDash val="solid"/></a:ln>'
            : '<a:ln><a:noFill/></a:ln>',
        name: '图形 ' + id,
        txbx: txbx,
        ins: ins,
        flipH: item.shape === 'parallelogram2'
      });
    });

    const documentXml = xml +
      '<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" ' +
      'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
      'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
      'xmlns:v="urn:schemas-microsoft-com:vml" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:w10="urn:schemas-microsoft-com:office:word" ' +
      'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
      'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" ' +
      'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
      'xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'mc:Ignorable="w14 wp14">' +
      '<w:body>' +
      '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>' + drawRun + '</w:p>' +
      '<w:sectPr><w:pgSz w:w="' + pageWTw + '" w:h="' + pageHTw + '" w:orient="landscape"/>' +
      '<w:pgMar w:top="180" w:right="180" w:bottom="180" w:left="180" w:header="0" w:footer="0" w:gutter="0"/>' +
      '</w:sectPr></w:body></w:document>';

    const files = [];
    files.push({
      name: '[Content_Types].xml', text: xml +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        '</Types>'
    });

    files.push({
      name: '_rels/.rels', text: xml +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
        '</Relationships>'
    });

    files.push({
      name: 'docProps/core.xml', text: xml +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:title>' + esc(payload.title) + '</dc:title><dc:creator>思维导图工作台</dc:creator>' +
        '<cp:lastModifiedBy>思维导图工作台</cp:lastModifiedBy>' +
        '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '</dcterms:created>' +
        '</cp:coreProperties>'
    });

    files.push({
      name: 'docProps/app.xml', text: xml +
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
        '<Application>Microsoft Office Word</Application></Properties>'
    });

    files.push({
      name: 'word/_rels/document.xml.rels', text: xml +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>'
    });

    files.push({
      name: 'word/styles.xml', text: xml +
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:docDefaults><w:rPrDefault><w:rPr>' +
        '<w:rFonts w:ascii="' + esc(FONT) + '" w:hAnsi="' + esc(FONT) + '" w:eastAsia="' + esc(FONT) + '" w:cs="' + esc(FONT) + '"/>' +
        '<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/>' +
        '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
        '</w:styles>'
    });

    files.push({ name: 'word/document.xml', text: documentXml });
    return files;
  }

  function wordShapeXml(o) {
    const flip = o.flipH ? ' flipH="1"' : '';
    return '<w:r><w:drawing>' +
      '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="' + (251658240 + o.id) + '" ' +
      'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
      '<wp:simplePos x="0" y="0"/>' +
      '<wp:positionH relativeFrom="page"><wp:posOffset>' + o.offX + '</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="page"><wp:posOffset>' + o.offY + '</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="' + o.cx + '" cy="' + o.cy + '"/>' +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
      '<wp:docPr id="' + o.id + '" name="' + esc(o.name) + '"/>' +
      '<wp:cNvGraphicFramePr/>' +
      '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
      '<wps:wsp>' +
      '<wps:cNvSpPr' + (o.txbx ? ' txBox="1"/>' : '/>') +
      '<wps:spPr><a:xfrm' + flip + '><a:off x="0" y="0"/><a:ext cx="' + o.cx + '" cy="' + o.cy + '"/></a:xfrm>' +
      o.geom + o.fillXml + o.lineXml + '</wps:spPr>' +
      (o.txbx || '') +
      '<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="' + (o.ins ? o.ins.l : 0) + '" tIns="' + (o.ins ? o.ins.t : 0) +
      '" rIns="' + (o.ins ? o.ins.r : 0) + '" bIns="' + (o.ins ? o.ins.b : 0) + '" anchor="ctr" anchorCtr="0"' +
      ' upright="1"><a:noAutofit/></wps:bodyPr>' +
      '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';
  }

  function wordArrowXml(a, b, item, id, k, E) {
    const dx = (b.x - a.x) * k, dy = (b.y - a.y) * k;
    if (Math.hypot(dx, dy) < 2) return '';
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const size = Math.min(14, Math.max(8, 6 + item.width * 1.6));
    const cxPx = b.x - Math.cos(angle * Math.PI / 180) * (size / 2) / k;
    const cyPx = b.y - Math.sin(angle * Math.PI / 180) * (size / 2) / k;
    const side = E(size);
    return wordShapeXml({
      id: id,
      offX: E(cxPx) - side / 2, offY: E(cyPx) - side / 2, cx: side, cy: side,
      geom: '<a:prstGeom prst="triangle"><a:avLst/></a:prstGeom>',
      fillXml: '<a:solidFill><a:srgbClr val="' + hexOf(item.color) + '"/></a:solidFill>',
      lineXml: '<a:ln w="0"><a:noFill/></a:ln>',
      name: '箭头 ' + id,
      rot: Math.round((angle + 90) * 60000)
    }).replace('<a:xfrm', '<a:xfrm rot="' + Math.round((angle + 90) * 60000) + '"');
  }

  /* ===================== 对外接口 ===================== */
  function pptxBlob(payload) { return zip(pptxParts(payload)); }
  function docxBlob(payload) { return zip(docxParts(payload)); }

  MM.ooxml = {
    zip: zip,
    crc32: crc32,
    pptxBlob: pptxBlob,
    docxBlob: docxBlob,
    pptxParts: pptxParts,
    docxParts: docxParts
  };
})(typeof window !== 'undefined' ? window : globalThis);
