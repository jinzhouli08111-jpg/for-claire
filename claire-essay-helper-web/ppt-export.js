/* ============================================================
 * ppt-export.js —— 多页导出（PPTX / PDF / Word）
 *
 * 与 ai-template.html 的关系：
 *   复用它的 OOXML / PDF 构造思路，但支持**多页**（那套是单页硬编码）。
 *   不依赖它，独立可跑，避免污染现有文件。
 *
 * 输入：
 *   pages = [{ blocks: [...], bg: '#fff' }, ...]
 *   kind  = 'pptx' | 'pdf' | 'docx'
 *
 * blocks 的字段与 ppt-engine.js / ai-template.html 的 blk() 一致。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 基础工具 ---------------- */

  function hx(c) {
    var s = String(c || '#000000').replace('#', '').toUpperCase();
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9A-F]{6}$/.test(s)) s = '000000';
    return s;
  }

  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function emuOf(px) { return Math.round(px * 9525); }
  function twOf(px) { return Math.round(px * 15); }

  function famOf(f) {
    if (f === 'serif') return 'Georgia';
    if (f === 'mono') return 'Consolas';
    return 'Calibri';
  }

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xD800 && c < 0xDC00) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  /* CRC32 */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256), c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* 极简 zip（store，不压缩） */
  function zipStore(files) {
    var parts = [], central = [], offset = 0, i;
    var now = new Date();
    var dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() >> 1) & 31);
    var dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

    for (i = 0; i < files.length; i++) {
      var f = files[i];
      var name = utf8(f.name);
      var data = f.data;
      var crc = crc32(data);
      var lh = new Uint8Array(30 + name.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, dosTime, true);
      dv.setUint16(12, dosDate, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true);
      dv.setUint16(28, 0, true);
      lh.set(name, 30);
      parts.push(lh);
      parts.push(data);
      central.push({ name: name, crc: crc, size: data.length, offset: offset });
      offset += lh.length + data.length;
    }

    var cdParts = [], cdSize = 0;
    for (i = 0; i < central.length; i++) {
      var c = central[i];
      var ch = new Uint8Array(46 + c.name.length);
      var dv2 = new DataView(ch.buffer);
      dv2.setUint32(0, 0x02014b50, true);
      dv2.setUint16(4, 20, true);
      dv2.setUint16(6, 20, true);
      dv2.setUint16(8, 0x0800, true);
      dv2.setUint16(10, 0, true);
      dv2.setUint16(12, dosTime, true);
      dv2.setUint16(14, dosDate, true);
      dv2.setUint32(16, c.crc, true);
      dv2.setUint32(20, c.size, true);
      dv2.setUint32(24, c.size, true);
      dv2.setUint16(28, c.name.length, true);
      dv2.setUint32(42, c.offset, true);
      ch.set(c.name, 46);
      cdParts.push(ch);
      cdSize += ch.length;
    }

    var end = new Uint8Array(22);
    var dv3 = new DataView(end.buffer);
    dv3.setUint32(0, 0x06054b50, true);
    dv3.setUint16(8, central.length, true);
    dv3.setUint16(10, central.length, true);
    dv3.setUint32(12, cdSize, true);
    dv3.setUint32(16, offset, true);

    var total = offset + cdSize + 22;
    var out = new Uint8Array(total);
    var pos = 0, j;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], pos); pos += parts[i].length; }
    for (i = 0; i < cdParts.length; i++) { out.set(cdParts[i], pos); pos += cdParts[i].length; }
    out.set(end, pos);
    return out;
  }

  /* ---------------- 文字折行估算 ---------------- */
  /* 不依赖 canvas，按字号与字符宽度估算，中英文分别计权 */
  function wrapText(text, widthPx, sizePx, isSerif) {
    var out = [];
    String(text).split('\n').forEach(function (para) {
      if (!para) { out.push(''); return; }
      var cur = '', w = 0;
      var cjkW = sizePx * (isSerif ? 1.0 : 0.98);
      var latinW = sizePx * (isSerif ? 0.52 : 0.50);
      for (var i = 0; i < para.length; i++) {
        var ch = para[i];
        var cw = /[\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/.test(ch) ? cjkW : latinW;
        if (w + cw > widthPx && cur) {
          out.push(cur);
          cur = ch; w = cw;
        } else {
          cur += ch; w += cw;
        }
      }
      if (cur) out.push(cur);
    });
    return out;
  }

  /* ============================================================
   * PPTX
   * ============================================================ */

  function pptFill(color, alpha) {
    var a = alpha == null ? 1 : alpha;
    return '<a:solidFill><a:srgbClr val="' + hx(color) + '">' +
      (a < 0.999 ? '<a:alpha val="' + Math.round(a * 100000) + '"/>' : '') +
      '</a:srgbClr></a:solidFill>';
  }

  function pptShape(id, it) {
    var isRound = it.radius > 0;
    var mn = Math.max(1, Math.min(it.w, it.h));
    var av = isRound
      ? '<a:avLst><a:gd name="adj" fmla="val ' + Math.round(Math.min(50000, (it.radius / mn) * 100000)) + '"/></a:avLst>'
      : '<a:avLst/>';
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="shape' + id + '"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr><a:xfrm><a:off x="' + emuOf(it.x) + '" y="' + emuOf(it.y) + '"/>' +
      '<a:ext cx="' + emuOf(Math.max(it.w, 1)) + '" cy="' + emuOf(Math.max(it.h, 1)) + '"/></a:xfrm>' +
      '<a:prstGeom prst="' + (isRound ? 'roundRect' : 'rect') + '">' + av + '</a:prstGeom>' +
      pptFill(it.fill || '#FFFFFF', it.alpha) + '<a:ln><a:noFill/></a:ln></p:spPr>' +
      '<p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>';
  }

  function pptText(id, it) {
    var size = it.size || 13;
    var lh = size * (it.title ? 1.30 : 1.62);
    var lines = wrapText(it.text || '', it.w, size, it.family === 'serif');
    var hh = Math.max(lh * lines.length, lh) * 1.35;
    var algn = it.align === 'center' ? 'ctr' : it.align === 'right' ? 'r' : 'l';
    var sz = Math.max(100, Math.round(size * 75));
    var pct = Math.round((lh / Math.max(1, size)) * 100000);

    var ps = '';
    for (var i = 0; i < lines.length; i++) {
      ps += '<a:p><a:pPr algn="' + algn + '"><a:lnSpc><a:spcPct val="' + pct + '"/></a:lnSpc>' +
        '<a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr>' +
        '<a:r><a:rPr lang="zh-CN" altLang="en-US" sz="' + sz + '" dirty="0"' +
        (it.bold ? ' b="1"' : '') + (it.italic ? ' i="1"' : '') +
        (it.letters ? ' spc="' + Math.round(it.letters * 75) + '"' : '') + '>' +
        pptFill(it.color, it.alpha) +
        '<a:latin typeface="' + famOf(it.family) + '"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/>' +
        '</a:rPr><a:t>' + xmlEsc(lines[i] || ' ') + '</a:t></a:r></a:p>';
    }

    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="text' + id + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr><a:xfrm><a:off x="' + emuOf(it.x) + '" y="' + emuOf(it.y) + '"/>' +
      '<a:ext cx="' + emuOf(Math.max(it.w, 1)) + '" cy="' + emuOf(Math.max(hh, 1)) + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>' +
      '<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" rtlCol="0"><a:spAutoFit/></a:bodyPr>' +
      '<a:lstStyle/>' + ps + '</p:txBody></p:sp>';
  }

  /* ------------------------------------------------------------
   * 动画：把 blocks 上的 anim 字段写成 PowerPoint 的 p:timing
   *   anim 支持：fade / fadeUp / zoom / wipe / none
   *   第一个动画「点一下开始」，其余「与上一动画同时」错峰 0.2s
   * ---------------------------------------------------------- */

  /* 每种动画对应 EnterEffect 的 (presetID, presetSubtype, filter) */
  var ANIM_EFFECT = {
    fade:    { presetID: 10, presetSubtype: 0,  filter: 'fade',      dur: 500 },
    fadeUp:  { presetID: 10, presetSubtype: 0,  filter: 'fade',      dur: 500, move: 'up' },
    zoom:    { presetID: 23, presetSubtype: 16, filter: 'zoom',      dur: 400 },
    wipe:    { presetID: 22, presetSubtype: 4,  filter: 'wipe(up)',  dur: 500 },
    none:    null
  };

  /* 生成 slide 的 <p:timing>；没有动画时返回空串 */
  function buildTiming(blocks, sids) {
    var targets = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var eff = ANIM_EFFECT[b.anim];
      if (!eff) continue;
      /* 背景大色块不动画，避免整页闪 */
      if (b.type === 'shape' && b.w >= 900 && b.h >= 500) continue;
      targets.push({ sid: sids[i], eff: eff });
    }
    if (!targets.length) return '';

    var STEP = 200;   /* 每个动画之间错开 200ms */
    var ctn = '';
    var grpId = 2;

    for (var k = 0; k < targets.length; k++) {
      var t = targets[k];
      var nodeType = k === 0 ? 'clickEffect' : 'withEffect';
      var delay = k === 0 ? 0 : STEP;
      var e = t.eff;

      var setVis = '<p:set><p:cBhvr><p:cTn id="' + (100 + k * 10) + '" dur="1" fill="hold">'
        + '<p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>'
        + '<p:tgtEl><p:spTgt spid="' + t.sid + '"/></p:tgtEl>'
        + '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>'
        + '</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>';

      var animEffect = '<p:animEffect transition="in" filter="' + e.filter + '">'
        + '<p:cBhvr><p:cTn id="' + (101 + k * 10) + '" dur="' + e.dur + '"/>'
        + '<p:tgtEl><p:spTgt spid="' + t.sid + '"/></p:tgtEl></p:cBhvr></p:animEffect>';

      var anim = '';
      if (e.move === 'up') {
        /* 上移淡入：从下方 8% 高度处移到位 */
        anim = '<p:anim calcmode="lin" valueType="num">'
          + '<p:cBhvr additive="base"><p:cTn id="' + (102 + k * 10) + '" dur="' + e.dur + '" fill="hold"/>'
          + '<p:tgtEl><p:spTgt spid="' + t.sid + '"/></p:tgtEl>'
          + '<p:attrNameLst><p:attrName>ppt_x</p:attrName></p:attrNameLst></p:cBhvr>'
          + '<p:tavLst><p:tav tm="0"><p:val><p:strVal val="#ppt_x"/></p:val></p:tav>'
          + '<p:tav tm="100000"><p:val><p:strVal val="#ppt_x"/></p:val></p:tav></p:tavLst></p:anim>'
          + '<p:anim calcmode="lin" valueType="num">'
          + '<p:cBhvr additive="base"><p:cTn id="' + (103 + k * 10) + '" dur="' + e.dur + '" fill="hold"/>'
          + '<p:tgtEl><p:spTgt spid="' + t.sid + '"/></p:tgtEl>'
          + '<p:attrNameLst><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr>'
          + '<p:tavLst><p:tav tm="0"><p:val><p:strVal val="#ppt_y+0.035"/></p:val></p:tav>'
          + '<p:tav tm="100000"><p:val><p:strVal val="#ppt_y"/></p:val></p:tav></p:tavLst></p:anim>';
      }

      ctn += '<p:par><p:cTn id="' + (10 + k) + '" presetID="' + e.presetID + '" presetClass="entr"'
        + ' presetSubtype="' + e.presetSubtype + '" fill="hold" grpId="' + grpId + '" nodeType="' + nodeType + '">'
        + '<p:stCondLst><p:cond delay="' + delay + '"/></p:stCondLst>'
        + '<p:childTnLst>' + setVis + animEffect + anim + '</p:childTnLst>'
        + '</p:cTn></p:par>';
    }

    return '<p:timing><p:tnLst><p:par>'
      + '<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">'
      + '<p:childTnLst><p:seq concurrent="1" nextAc="seek">'
      + '<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
      + '<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>'
      + '<p:childTnLst><p:par><p:cTn id="4" fill="hold">'
      + '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
      + ctn
      + '</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>'
      + '</p:childTnLst></p:cTn>'
      + '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
      + '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
      + '</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>'
      + '<p:bldLst>' + buildBldLst(targets) + '</p:bldLst>'
      + '</p:timing>';
  }

  function buildBldLst(targets) {
    var s = '';
    for (var i = 0; i < targets.length; i++) {
      s += '<p:bldP spid="' + targets[i].sid + '" grpId="0" animBg="1"/>';
    }
    return s;
  }

  function buildPptx(pages, W, H, title) {
    var ns = ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
      + ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

    var spTreeHead = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

    var files = [];
    var emuW = emuOf(W), emuH = emuOf(H);
    var slideCount = pages.length;

    /* 每个 slide 的 XML */
    var sldIdLst = '';
    var presRelsBody = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>';
    var overrides = '';

    for (var i = 0; i < slideCount; i++) {
      var pg = pages[i];
      var tree = '';
      var sid = 1;
      var sids = [];   /* 每个 block 对应的 shape id，动画要用 */
      (pg.blocks || []).forEach(function (b) {
        var myId;
        if (b.type === 'shape') {
          myId = ++sid;
          tree += pptShape(myId, { x: b.x, y: b.y, w: b.w, h: b.h, fill: b.bg, alpha: b.alpha, radius: b.radius || 0 });
        } else if (b.text) {
          myId = ++sid;
          tree += pptText(myId, {
            x: b.x, y: b.y, w: b.w, h: b.h, text: b.text, size: b.size,
            family: b.font, bold: (b.weight || 400) >= 600, italic: !!b.italic,
            letters: b.letters || 0, align: b.align || 'left',
            color: b.color, alpha: b.alpha, title: b.type === 'title'
          });
        } else {
          myId = 0;
        }
        sids.push(myId);
      });

      var bg = '<p:bg><p:bgPr>' + pptFill(pg.bg || '#FFFFFF', 1) + '<a:effectLst/></p:bgPr></p:bg>';
      /* 动画：按 block 顺序写成进入效果 */
      var timing = '';
      try { timing = buildTiming(pg.blocks || [], sids); } catch (e) { timing = ''; }

      var slideXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<p:sld' + ns + '><p:cSld>' + bg + '<p:spTree>' + spTreeHead + tree + '</p:spTree></p:cSld>'
        + '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>'
        + timing
        + '</p:sld>';

      files.push({ name: 'ppt/slides/slide' + (i + 1) + '.xml', data: utf8(slideXml) });

      var relId = 'rId' + (i + 2);
      presRelsBody += '<Relationship Id="' + relId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + (i + 1) + '.xml"/>';
      sldIdLst += '<p:sldId id="' + (256 + i) + '" r:id="' + relId + '"/>';

      var slideRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'
        + '</Relationships>';
      files.push({ name: 'ppt/slides/_rels/slide' + (i + 1) + '.xml.rels', data: utf8(slideRels) });

      overrides += '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
    }

    /* content types */
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
      + overrides
      + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
      + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
      + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '</Types>';
    files.push({ name: '[Content_Types].xml', data: utf8(ct) });

    /* root rels */
    files.push({
      name: '_rels/.rels',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>'
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        + '</Relationships>')
    });

    /* presentation.xml */
    var pres = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<p:presentation' + ns + '>'
      + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
      + '<p:sldIdLst>' + sldIdLst + '</p:sldIdLst>'
      + '<p:sldSz cx="' + emuW + '" cy="' + emuH + '" type="custom"/>'
      + '<p:notesSz cx="6858000" cy="9144000"/>'
      + '</p:presentation>';
    files.push({ name: 'ppt/presentation.xml', data: utf8(pres) });

    files.push({
      name: 'ppt/_rels/presentation.xml.rels',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + presRelsBody + '</Relationships>')
    });

    /* master */
    var master = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<p:sldMaster' + ns + '>'
      + '<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>'
      + '<p:spTree>' + spTreeHead + '</p:spTree></p:cSld>'
      + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
      + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
      + '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle>'
      + '<p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle>'
      + '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles>'
      + '</p:sldMaster>';
    files.push({ name: 'ppt/slideMasters/slideMaster1.xml', data: utf8(master) });

    files.push({
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>'
        + '</Relationships>')
    });

    /* layout */
    var layout = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<p:sldLayout' + ns + ' type="blank" preserve="1">'
      + '<p:cSld name="Blank"><p:spTree>' + spTreeHead + '</p:spTree></p:cSld>'
      + '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
    files.push({ name: 'ppt/slideLayouts/slideLayout1.xml', data: utf8(layout) });

    files.push({
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>'
        + '</Relationships>')
    });

    /* theme */
    var theme = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="PPT">'
      + '<a:themeElements><a:clrScheme name="PPT">'
      + '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
      + '<a:dk2><a:srgbClr val="23201C"/></a:dk2><a:lt2><a:srgbClr val="FAF7F1"/></a:lt2>'
      + '<a:accent1><a:srgbClr val="1E3527"/></a:accent1><a:accent2><a:srgbClr val="A98A57"/></a:accent2>'
      + '<a:accent3><a:srgbClr val="7A7268"/></a:accent3><a:accent4><a:srgbClr val="D9D2C5"/></a:accent4>'
      + '<a:accent5><a:srgbClr val="FAF7F1"/></a:accent5><a:accent6><a:srgbClr val="C9AE7E"/></a:accent6>'
      + '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>'
      + '</a:clrScheme>'
      + '<a:fontScheme name="PPT"><a:majorFont><a:latin typeface="Georgia"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:majorFont>'
      + '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
      /* fmtScheme 的四个列表在 schema 里各要求 3 项，少一项 PowerPoint 就判文件损坏 */
      + '<a:fmtScheme name="PPT">'
      + '<a:fillStyleLst>'
      + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
      + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
      + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
      + '</a:fillStyleLst>'
      + '<a:lnStyleLst>'
      + '<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'
      + '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'
      + '<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'
      + '</a:lnStyleLst>'
      + '<a:effectStyleLst>'
      + '<a:effectStyle><a:effectLst/></a:effectStyle>'
      + '<a:effectStyle><a:effectLst/></a:effectStyle>'
      + '<a:effectStyle><a:effectLst/></a:effectStyle>'
      + '</a:effectStyleLst>'
      + '<a:bgFillStyleLst>'
      + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
      + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
      + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
      + '</a:bgFillStyleLst>'
      + '</a:fmtScheme>'
      + '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
    files.push({ name: 'ppt/theme/theme1.xml', data: utf8(theme) });

    /* docProps */
    files.push({
      name: 'docProps/core.xml',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
        + ' xmlns:dc="http://purl.org/dc/elements/1.1/">'
        + '<dc:title>' + xmlEsc(title || '') + '</dc:title>'
        + '<dc:creator>For Claire</dc:creator>'
        + '</cp:coreProperties>')
    });

    return zipStore(files);
  }

  /* ============================================================
   * PDF —— 极简 PDF 1.4，多页，中文转图（用 canvas 预渲染）
   * ============================================================ */

  function pdfNum(n) { return String(Math.round(n * 100) / 100); }

  function buildPdf(pages, W, H, title) {
    /* 每页渲染成 JPEG，再包进 PDF —— 简单可靠，中文不会乱码 */
    var canvas = document.createElement('canvas');
    canvas.width = W * 2;
    canvas.height = H * 2;
    var g = canvas.getContext('2d');
    g.scale(2, 2);

    var imgs = [];
    pages.forEach(function (pg) {
      g.fillStyle = pg.bg || '#FFFFFF';
      g.fillRect(0, 0, W, H);

      (pg.blocks || []).forEach(function (b) {
        if (b.type === 'shape') {
          g.globalAlpha = b.alpha == null ? 1 : b.alpha;
          g.fillStyle = b.bg || '#000';
          g.fillRect(b.x, b.y, Math.max(0, b.w), Math.max(0, b.h));
          g.globalAlpha = 1;
          return;
        }
        if (!b.text) return;

        var size = b.size || 13;
        var isSerif = b.font === 'serif';
        g.font = (b.weight || 400) + ' ' + size + 'px ' + (isSerif
          ? 'Georgia, "Times New Roman", "Songti SC", SimSun, serif'
          : '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif');
        g.fillStyle = b.color || '#000';
        g.globalAlpha = b.alpha == null ? 1 : b.alpha;
        g.textBaseline = 'top';

        var lines = wrapText(b.text, b.w, size, isSerif);
        var lh = size * (b.type === 'title' ? 1.30 : 1.62);
        var x = b.x;
        if (b.align === 'center') { g.textAlign = 'center'; x = b.x + b.w / 2; }
        else if (b.align === 'right') { g.textAlign = 'right'; x = b.x + b.w; }
        else { g.textAlign = 'left'; }

        lines.forEach(function (ln, i) {
          g.fillText(ln, x, b.y + i * lh + size * 0.16);
        });
        g.globalAlpha = 1;
      });

      var dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      var b64 = dataUrl.split(',')[1];
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      imgs.push({ bytes: bytes, w: canvas.width, h: canvas.height });
    });

    /* 组装 PDF */
    var objs = [];   /* 1-based 序号 */
    function addObj(body) { objs.push(body); return objs.length; }

    var pageObjs = [];
    var contentObjs = [];
    var imgObjs = [];

    var catalogId = addObj('__CATALOG__');
    var pagesId = addObj('__PAGES__');

    /* 页面尺寸：按 520x735 → A4 比例不变，用 pt 表达 */
    var pw = 595.28, ph = 841.89;
    var scale = Math.min(pw / W, ph / H);
    var drawW = W * scale, drawH = H * scale;
    var offX = (pw - drawW) / 2, offY = (ph - drawH) / 2;

    imgs.forEach(function (img) {
      var imgId = addObj({ img: img });
      imgObjs.push(imgId);

      var content = 'q\n' + pdfNum(drawW) + ' 0 0 ' + pdfNum(drawH) + ' ' + pdfNum(offX) + ' ' + pdfNum(offY) + ' cm\n'
        + '/Im' + imgId + ' Do\nQ\n';
      var cId = addObj('__STREAM__' + content);

      var pId = addObj('__PAGE__' + imgId + '|' + cId);
      pageObjs.push(pId);
    });

    /* 序列化 */
    var out = [];
    var offsets = [];
    var enc = new TextEncoder ? new TextEncoder() : null;

    function bytesOf(str) {
      if (enc) return enc.encode(str);
      var a = [], i;
      for (i = 0; i < str.length; i++) a.push(str.charCodeAt(i) & 0xFF);
      return new Uint8Array(a);
    }

    var header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    out.push(bytesOf(header));

    var pos = bytesOf(header).length;
    var i2;

    for (i2 = 0; i2 < objs.length; i2++) {
      var id = i2 + 1;
      var o = objs[i2];
      var chunk = '';
      offsets[id] = pos;

      if (typeof o === 'string') {
        if (o === '__CATALOG__') {
          chunk = id + ' 0 obj\n<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>\nendobj\n';
        } else if (o === '__PAGES__') {
          chunk = id + ' 0 obj\n<< /Type /Pages /Kids [' + pageObjs.map(function (p) { return p + ' 0 R'; }).join(' ') + '] /Count ' + pageObjs.length + ' >>\nendobj\n';
        } else if (o.indexOf('__STREAM__') === 0) {
          var content = o.slice('__STREAM__'.length);
          var cbytes = bytesOf(content);
          chunk = id + ' 0 obj\n<< /Length ' + cbytes.length + ' >>\nstream\n' + content + 'endstream\nendobj\n';
        } else if (o.indexOf('__PAGE__') === 0) {
          var parts = o.slice('__PAGE__'.length).split('|');
          var imgRef = parts[0], conRef = parts[1];
          chunk = id + ' 0 obj\n<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + pdfNum(pw) + ' ' + pdfNum(ph) + ']'
            + ' /Resources << /XObject << /Im' + imgRef + ' ' + imgRef + ' 0 R >> >>'
            + ' /Contents ' + conRef + ' 0 R >>\nendobj\n';
        } else {
          chunk = id + ' 0 obj\n<<>>\nendobj\n';
        }
        var cb = bytesOf(chunk);
        out.push(cb);
        pos += cb.length;
      } else if (o && o.img) {
        var ib = o.img.bytes;
        var head = id + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + o.img.w + ' /Height ' + o.img.h +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + ib.length + ' >>\nstream\n';
        var hb = bytesOf(head);
        var tb = bytesOf('\nendstream\nendobj\n');
        out.push(hb); out.push(ib); out.push(tb);
        pos += hb.length + ib.length + tb.length;
      }
    }

    /* xref */
    var xrefPos = pos;
    var xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    for (i2 = 1; i2 <= objs.length; i2++) {
      xref += String(offsets[i2]).padStart(10, '0') + ' 00000 n \n';
    }
    xref += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalogId + ' 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF';
    out.push(bytesOf(xref));

    /* 合并 */
    var total = 0, k;
    for (k = 0; k < out.length; k++) total += out[k].length;
    var merged = new Uint8Array(total);
    var p2 = 0;
    for (k = 0; k < out.length; k++) { merged.set(out[k], p2); p2 += out[k].length; }
    return merged;
  }

  /* ============================================================
   * Word —— 多页版 .docx（每页一个分页符）
   * ============================================================ */

  function buildDocx(pages, W, H, title) {
    var files = [];
    var nsW = ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

    /* 页面尺寸：A4 竖版，单位 twip */
    var pageW = 11906, pageH = 16838, margin = 1134;
    var contentW = pageW - margin * 2;

    var bodyParas = '';
    var paraIndex = 0;

    pages.forEach(function (pg, pi) {
      var blocks = (pg.blocks || []).slice().sort(function (a, b) { return a.y - b.y; });

      blocks.forEach(function (b) {
        if (b.type === 'shape') {
          /* 色块：用底纹段落近似 */
          if (b.h >= 8) {
            var rows = Math.max(1, Math.round(b.h / 20));
            for (var r = 0; r < rows; r++) {
              bodyParas += '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="exact"/>'
                + '<w:shd w:val="clear" w:color="auto" w:fill="' + hx(b.bg) + '"/></w:pPr></w:p>';
            }
          }
          return;
        }
        if (!b.text) return;

        var isTitle = b.type === 'title';
        var sz = Math.max(100, Math.round((b.size || 13) * 15));
        var jc = b.align === 'center' ? 'center' : (b.align === 'right' ? 'right' : 'left');

        var lines = wrapText(b.text, b.w, b.size || 13, b.font === 'serif');
        lines.forEach(function (ln) {
          bodyParas += '<w:p><w:pPr>'
            + '<w:spacing w:before="' + (isTitle ? 180 : 40) + '" w:after="60" w:line="300" w:lineRule="auto"/>'
            + '<w:jc w:val="' + jc + '"/>'
            + '</w:pPr>'
            + '<w:r><w:rPr>'
            + '<w:rFonts w:ascii="' + famOf(b.font) + '" w:hAnsi="' + famOf(b.font) + '" w:eastAsia="Microsoft YaHei"/>'
            + '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/>'
            + (isTitle ? '<w:b/>' : '')
            + (b.italic ? '<w:i/>' : '')
            + '<w:color w:val="' + hx(b.color) + '"/>'
            + '</w:rPr>'
            + '<w:t xml:space="preserve">' + xmlEsc(ln) + '</w:t></w:r></w:p>';
        });
      });

      /* 分页符 */
      if (pi < pages.length - 1) {
        bodyParas += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      }
    });

    var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:document' + nsW + '><w:body>' + bodyParas
      + '<w:sectPr><w:pgSz w:w="' + pageW + '" w:h="' + pageH + '"/>'
      + '<w:pgMar w:top="' + margin + '" w:right="' + margin + '" w:bottom="' + margin + '" w:left="' + margin + '" w:header="720" w:footer="720" w:gutter="0"/>'
      + '</w:sectPr></w:body></w:document>';
    files.push({ name: 'word/document.xml', data: utf8(docXml) });

    files.push({
      name: '[Content_Types].xml',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '</Types>')
    });

    files.push({
      name: '_rels/.rels',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        + '</Relationships>')
    });

    files.push({
      name: 'word/_rels/document.xml.rels',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>')
    });

    return zipStore(files);
  }

  /* ============================================================
   * 对外接口
   * ============================================================ */

  var MIME = {
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pdf: 'application/pdf'
  };

  function exportDeck(pages, kind, name, opts) {
    var W = (opts && opts.w) || 960;
    var H = (opts && opts.h) || 540;
    var title = name || 'ppt';
    var bytes;

    if (kind === 'pptx') bytes = buildPptx(pages, W, H, title);
    else if (kind === 'docx') bytes = buildDocx(pages, W, H, title);
    else bytes = buildPdf(pages, W, H, title);

    return {
      blob: new Blob([bytes], { type: MIME[kind] }),
      mime: MIME[kind],
      filename: title + '.' + (kind === 'pptx' ? 'pptx' : kind === 'docx' ? 'docx' : 'pdf')
    };
  }

  global.PPTExport = {
    exportDeck: exportDeck,
    buildPptx: buildPptx,
    buildPdf: buildPdf,
    buildDocx: buildDocx,
    wrapText: wrapText,
    zipStore: zipStore
  };
})(typeof window !== 'undefined' ? window : globalThis);
