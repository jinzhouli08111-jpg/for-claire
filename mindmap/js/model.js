/* =========================================================
 * model.js —— 数据模型 / 几何计算 / 自动排版
 * 无依赖，经典脚本，挂载到 window.MM
 * ========================================================= */
(function (global) {
  'use strict';
  const MM = (global.MM = global.MM || {});

  const SIDES = ['top', 'right', 'bottom', 'left'];
  const NORMAL = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
  const DASH_PATTERN = { solid: null, dash: '9 7', dot: '2 6' };

  let _seq = 0;
  function uid(prefix) {
    _seq += 1;
    return (prefix || 'i') + _seq.toString(36) + Math.random().toString(36).slice(2, 5);
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function dist(x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy); }
  function round(v) { return Math.round(v * 100) / 100; }

  const NODE_STYLE = {
    shape: 'textbox', fill: '#FFFFFF', stroke: '#3B82F6', strokeWidth: 2,
    textColor: '#0F172A', fontSize: 16, bold: false, align: 'center'
  };
  const EDGE_STYLE = {
    route: 'curve', dash: 'solid', color: '#8FA3BF', width: 2,
    arrowStart: false, arrowEnd: true
  };
  const NODE_SIZE = { w: 168, h: 64 };

  /* ---------------- 基础工厂 ---------------- */
  function createNode(patch) {
    const p = patch || {};
    return {
      id: p.id || uid('n'),
      x: num(p.x, 0), y: num(p.y, 0),
      w: Math.max(40, num(p.w, NODE_SIZE.w)),
      h: Math.max(28, num(p.h, NODE_SIZE.h)),
      shape: p.shape || NODE_STYLE.shape,
      fill: p.fill || NODE_STYLE.fill,
      stroke: p.stroke || NODE_STYLE.stroke,
      strokeWidth: num(p.strokeWidth, NODE_STYLE.strokeWidth),
      text: typeof p.text === 'string' ? p.text : '',
      textColor: p.textColor || NODE_STYLE.textColor,
      fontSize: num(p.fontSize, NODE_STYLE.fontSize),
      bold: !!p.bold,
      align: p.align || NODE_STYLE.align
    };
  }

  function createEdge(from, to, patch) {
    const p = patch || {};
    return {
      id: p.id || uid('e'),
      from: { node: from.node, side: from.side || 'auto' },
      to: { node: to.node, side: to.side || 'auto' },
      route: p.route || EDGE_STYLE.route,
      dash: p.dash || EDGE_STYLE.dash,
      color: p.color || EDGE_STYLE.color,
      width: num(p.width, EDGE_STYLE.width),
      arrowStart: p.arrowStart !== undefined ? !!p.arrowStart : EDGE_STYLE.arrowStart,
      arrowEnd: p.arrowEnd !== undefined ? !!p.arrowEnd : EDGE_STYLE.arrowEnd
    };
  }

  function createDoc(patch) {
    const p = patch || {};
    return {
      version: 1,
      title: p.title || '未命名思维导图',
      canvas: Object.assign({ w: 1600, h: 1000, bg: '#F8FAFC', grid: true }, p.canvas || {}),
      nodes: [],
      edges: []
    };
  }

  function sampleDoc() {
    const doc = createDoc({ title: '思维导图示例' });
    const cx = doc.canvas.w / 2, cy = doc.canvas.h / 2;
    const root = createNode({
      x: cx - 115, y: cy - 60, w: 230, h: 120, shape: 'ellipse',
      text: '中心主题', fontSize: 24, bold: true,
      fill: '#1D4ED8', stroke: '#1E40AF', textColor: '#FFFFFF'
    });
    doc.nodes.push(root);

    const branches = [
      { text: '拖拽左侧图形\n到画布', side: 'right', dy: -150, fill: '#DBEAFE', stroke: '#2563EB' },
      { text: '从节点边缘\n拖出连线', side: 'right', dy: 60, fill: '#DCFCE7', stroke: '#16A34A' },
      { text: '双击图形\n直接打字', side: 'left', dy: -130, fill: '#FEF3C7', stroke: '#D97706' },
      { text: '导出 PPT / Word\n/ PDF 可编辑', side: 'left', dy: 80, fill: '#FCE7F3', stroke: '#DB2777' }
    ];

    branches.forEach(function (b) {
      const dir = b.side === 'right' ? 1 : -1;
      const n = createNode({
        x: cx + dir * 330 - 90, y: cy + b.dy, w: 180, h: 76,
        shape: dir > 0 ? 'roundRect' : 'roundRect',
        text: b.text, fontSize: 15, fill: b.fill, stroke: b.stroke
      });
      doc.nodes.push(n);
      doc.edges.push(createEdge(
        { node: root.id, side: dir > 0 ? 'right' : 'left' },
        { node: n.id, side: dir > 0 ? 'left' : 'right' },
        { route: 'curve', width: 2 }
      ));
    });

    // 二级节点示例
    const second = createNode({
      x: cx + 620, y: cy - 320, w: 160, h: 64, shape: 'diamond',
      text: '二级主题', fontSize: 15, fill: '#FFFFFF', stroke: '#0EA5E9'
    });
    doc.nodes.push(second);
    doc.edges.push(createEdge(
      { node: doc.nodes[1].id, side: 'right' },
      { node: second.id, side: 'left' },
      { route: 'curve', width: 2, color: '#38BDF8' }
    ));
    return doc;
  }

  /* ---------------- 查询 ---------------- */
  function findNode(doc, id) {
    for (let i = 0; i < doc.nodes.length; i++) if (doc.nodes[i].id === id) return doc.nodes[i];
    return null;
  }
  function findEdge(doc, id) {
    for (let i = 0; i < doc.edges.length; i++) if (doc.edges[i].id === id) return doc.edges[i];
    return null;
  }
  function centerOf(n) { return { x: n.x + n.w / 2, y: n.y + n.h / 2 }; }

  function anchorOf(n, side) {
    switch (side) {
      case 'top': return { x: n.x + n.w / 2, y: n.y };
      case 'bottom': return { x: n.x + n.w / 2, y: n.y + n.h };
      case 'left': return { x: n.x, y: n.y + n.h / 2 };
      default: return { x: n.x + n.w, y: n.y + n.h / 2 };
    }
  }

  function autoSide(a, b) {
    const ca = centerOf(a), cb = centerOf(b);
    const dx = cb.x - ca.x, dy = cb.y - ca.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return { fromSide: dx >= 0 ? 'right' : 'left', toSide: dx >= 0 ? 'left' : 'right' };
    }
    return { fromSide: dy >= 0 ? 'bottom' : 'top', toSide: dy >= 0 ? 'top' : 'bottom' };
  }

  /* ---------------- 连线几何 ---------------- */
  function edgeEnds(edge, doc) {
    const a = findNode(doc, edge.from.node);
    const b = findNode(doc, edge.to.node);
    if (!a || !b) return null;
    let fs = edge.from.side, ts = edge.to.side;
    if (!fs || fs === 'auto' || !ts || ts === 'auto') {
      const auto = autoSide(a, b);
      if (!fs || fs === 'auto') fs = auto.fromSide;
      if (!ts || ts === 'auto') ts = auto.toSide;
    }
    const p1 = anchorOf(a, fs), p2 = anchorOf(b, ts);
    return { a: a, b: b, fs: fs, ts: ts, p1: p1, p2: p2, n1: NORMAL[fs], n2: NORMAL[ts] };
  }

  function roundedPolyline(pts, r) {
    if (pts.length < 2) return '';
    let d = 'M ' + round(pts[0].x) + ' ' + round(pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
      const v1 = { x: cur.x - prev.x, y: cur.y - prev.y };
      const v2 = { x: next.x - cur.x, y: next.y - cur.y };
      const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
      if (l1 < 0.01 || l2 < 0.01) { d += ' L ' + round(cur.x) + ' ' + round(cur.y); continue; }
      const rr = Math.min(r, l1 / 2, l2 / 2);
      const p0 = { x: cur.x - (v1.x / l1) * rr, y: cur.y - (v1.y / l1) * rr };
      const p3 = { x: cur.x + (v2.x / l2) * rr, y: cur.y + (v2.y / l2) * rr };
      d += ' L ' + round(p0.x) + ' ' + round(p0.y);
      d += ' Q ' + round(cur.x) + ' ' + round(cur.y) + ' ' + round(p3.x) + ' ' + round(p3.y);
    }
    const last = pts[pts.length - 1];
    d += ' L ' + round(last.x) + ' ' + round(last.y);
    return d;
  }

  function elbowPoints(p1, n1, p2, n2) {
    const opposing = (n1.x === -n2.x) && (n1.y === -n2.y);
    if (opposing) {
      if (n1.x !== 0) {
        const mx = (p1.x + p2.x) / 2;
        return [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
      }
      const my = (p1.y + p2.y) / 2;
      return [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
    }
    const g = Math.min(34, dist(p1.x, p1.y, p2.x, p2.y) / 3);
    const a = { x: p1.x + n1.x * g, y: p1.y + n1.y * g };
    const b = { x: p2.x + n2.x * g, y: p2.y + n2.y * g };
    const c = n1.x !== 0 ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    return [p1, a, c, b, p2];
  }

  function bezierPoint(p1, c1, c2, p2, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * mt * p1.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p2.x,
      y: mt * mt * mt * p1.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p2.y
    };
  }

  function edgeGeometry(edge, doc) {
    const e = edgeEnds(edge, doc);
    if (!e) return null;
    const route = edge.route || 'curve';
    const geom = { p1: e.p1, p2: e.p2, dashArray: DASH_PATTERN[edge.dash || 'solid'] || null, route: route };

    if (route === 'curve') {
      const len = Math.max(40, dist(e.p1.x, e.p1.y, e.p2.x, e.p2.y));
      const k = Math.min(140, Math.max(30, len * 0.45));
      const c1 = { x: e.p1.x + e.n1.x * k, y: e.p1.y + e.n1.y * k };
      const c2 = { x: e.p2.x + e.n2.x * k, y: e.p2.y + e.n2.y * k };
      geom.c1 = c1; geom.c2 = c2;
      geom.d = 'M ' + round(e.p1.x) + ' ' + round(e.p1.y) +
        ' C ' + round(c1.x) + ' ' + round(c1.y) + ', ' + round(c2.x) + ' ' + round(c2.y) +
        ', ' + round(e.p2.x) + ' ' + round(e.p2.y);
      geom.points = [e.p1];
      for (let i = 1; i <= 16; i++) geom.points.push(bezierPoint(e.p1, c1, c2, e.p2, i / 16));
      geom.mid = bezierPoint(e.p1, c1, c2, e.p2, 0.5);
    } else if (route === 'elbow') {
      const pts = elbowPoints(e.p1, e.n1, e.p2, e.n2);
      geom.d = roundedPolyline(pts, 14);
      geom.points = pts;
      geom.mid = { x: (e.p1.x + e.p2.x) / 2, y: (e.p1.y + e.p2.y) / 2 };
    } else {
      geom.d = 'M ' + round(e.p1.x) + ' ' + round(e.p1.y) + ' L ' + round(e.p2.x) + ' ' + round(e.p2.y);
      geom.points = [e.p1, e.p2];
      geom.mid = { x: (e.p1.x + e.p2.x) / 2, y: (e.p1.y + e.p2.y) / 2 };
    }
    return geom;
  }

  function pointSegDistance(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const wx = px - ax, wy = py - ay;
    const len2 = vx * vx + vy * vy;
    let t = len2 ? (wx * vx + wy * vy) / len2 : 0;
    t = clamp(t, 0, 1);
    const cx = ax + vx * t, cy = ay + vy * t;
    return Math.hypot(px - cx, py - cy);
  }

  /* ---------------- 命中测试 ---------------- */
  function hitNode(node, x, y, tol) {
    const t = tol || 0;
    const lx = (x - node.x) / (node.w / 2), ly = (y - node.y) / (node.h / 2);
    if (node.shape === 'ellipse') return (lx * lx + ly * ly) <= 1.08 || (x >= node.x - t && x <= node.x + node.w + t && y >= node.y - t && y <= node.y + node.h + t);
    if (node.shape === 'diamond') return Math.abs(lx) + Math.abs(ly) <= 1.1 || (x >= node.x - t && x <= node.x + node.w + t && y >= node.y - t && y <= node.y + node.h + t);
    return x >= node.x - t && x <= node.x + node.w + t && y >= node.y - t && y <= node.y + node.h + t;
  }

  function hitTest(doc, x, y, tol) {
    for (let i = doc.nodes.length - 1; i >= 0; i--) {
      if (hitNode(doc.nodes[i], x, y, tol)) return { type: 'node', id: doc.nodes[i].id };
    }
    for (let i = 0; i < doc.edges.length; i++) {
      const g = edgeGeometry(doc.edges[i], doc);
      if (!g) continue;
      for (let j = 1; j < g.points.length; j++) {
        const a = g.points[j - 1], b = g.points[j];
        if (pointSegDistance(x, y, a.x, a.y, b.x, b.y) <= 7) return { type: 'edge', id: doc.edges[i].id };
      }
    }
    return null;
  }

  /* ---------------- 视图范围 ---------------- */
  function bounds(doc, pad) {
    const p = pad === undefined ? 60 : pad;
    if (!doc.nodes.length) return { x: 0, y: 0, w: doc.canvas.w, h: doc.canvas.h };
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    doc.nodes.forEach(function (n) {
      x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y);
      x2 = Math.max(x2, n.x + n.w); y2 = Math.max(y2, n.y + n.h);
    });
    return { x: x1 - p, y: y1 - p, w: (x2 - x1) + p * 2, h: (y2 - y1) + p * 2 };
  }

  /* ---------------- 层级树 ---------------- */
  function treeInfo(doc) {
    const byId = {}, children = {}, incoming = {};
    doc.nodes.forEach(function (n) { byId[n.id] = n; children[n.id] = []; incoming[n.id] = 0; });
    doc.edges.forEach(function (e) {
      if (!byId[e.from.node] || !byId[e.to.node] || e.from.node === e.to.node) return;
      children[e.from.node].push(e.to.node);
      incoming[e.to.node] += 1;
    });
    let root = null;
    for (let i = 0; i < doc.nodes.length; i++) {
      if (incoming[doc.nodes[i].id] === 0) { root = doc.nodes[i]; break; }
    }
    if (!root) root = doc.nodes[0] || null;
    return { byId: byId, children: children, incoming: incoming, root: root };
  }

  function outline(doc) {
    const t = treeInfo(doc);
    const items = [], seen = {};
    (function walk(id, level) {
      const n = t.byId[id];
      if (!n || seen[id]) return;
      seen[id] = true;
      items.push({ node: n, level: level });
      t.children[id].forEach(function (c) { walk(c, level + 1); });
    })(t.root && t.root.id, 0);
    doc.nodes.forEach(function (n) { if (!seen[n.id]) items.push({ node: n, level: 0 }); });
    return { root: t.root, items: items };
  }

  /* ---------------- 自动排版（左右分支思维导图） ---------------- */
  function autoLayout(doc, opt) {
    const o = opt || {};
    const vGap = o.vGap || 28, hGap = o.hGap || 96;
    const t = treeInfo(doc);
    const root = t.root;
    if (!root) return;

    const cy = root.y + root.h / 2;
    const cx = root.x + root.w / 2;
    root.x = cx - root.w / 2;
    root.y = cy - root.h / 2;

    const usable = function (id, from) {
      return (t.children[id] || []).filter(function (k) { return k !== from; });
    };
    const visited = {};

    function blockHeight(id, from) {
      if (visited['h' + id]) return 0;
      const kids = usable(id, from);
      const node = t.byId[id];
      if (!kids.length) return node.h;
      let h = 0;
      kids.forEach(function (k) { h += blockHeight(k, id) + vGap; });
      h -= vGap;
      return Math.max(node.h, h);
    }

    // 每侧最大宽度，用于计算层级横向间距
    function maxWidths(ids, dir) {
      const widths = [];
      const walk = function (id, depth, from) {
        if (!t.byId[id]) return;
        widths[depth] = Math.max(widths[depth] || 0, t.byId[id].w);
        usable(id, from).forEach(function (k) { walk(k, depth + 1, id); });
      };
      ids.forEach(function (id) { walk(id, 1, root.id); });
      return widths;
    }

    function levelX(widths) {
      const xs = [0];
      let acc = root.w / 2;
      for (let d = 1; d < widths.length + 1; d++) {
        const w = widths[d] || 160;
        xs[d] = acc + hGap + w / 2;
        acc = xs[d] + w / 2;
      }
      return xs;
    }

    const placed = {};
    function place(id, depth, dir, top, xs, from) {
      if (!t.byId[id] || placed[id]) return;
      placed[id] = true;
      const node = t.byId[id];
      const h = blockHeight(id, from);
      const nodeCy = top + h / 2;
      node.x = Math.round(cx + dir * (xs[depth] || xs[xs.length - 1]) - node.w / 2);
      node.y = Math.round(nodeCy - node.h / 2);
      const kids = usable(id, from);
      if (kids.length) {
        let total = 0;
        kids.forEach(function (k) { total += blockHeight(k, id) + vGap; });
        total -= vGap;
        let y = nodeCy - total / 2;
        kids.forEach(function (k) {
          place(k, depth + 1, dir, y, xs, id);
          y += blockHeight(k, id) + vGap;
        });
      }
    }

    const kids = t.children[root.id] || [];
    const half = Math.ceil(kids.length / 2);
    const groups = [{ dir: 1, ids: kids.slice(0, half) }, { dir: -1, ids: kids.slice(half) }];

    groups.forEach(function (g) {
      if (!g.ids.length) return;
      const widths = maxWidths(g.ids, g.dir);
      const xs = levelX(widths);
      let total = 0;
      g.ids.forEach(function (id) { total += blockHeight(id, root.id) + vGap; });
      total -= vGap;
      let y = cy - total / 2;
      g.ids.forEach(function (id) {
        place(id, 1, g.dir, y, xs, root.id);
        y += blockHeight(id, root.id) + vGap;
      });
    });

    // 未连线的孤立节点：放到下方一行
    let orphanX = cx - 400;
    doc.nodes.forEach(function (n) {
      if (!placed[n.id] && n.id !== root.id) {
        n.x = Math.round(orphanX);
        n.y = Math.round(cy + 320);
        orphanX += n.w + 40;
      }
    });

    // 连线走自动端口，让曲线更自然
    doc.edges.forEach(function (e) {
      e.from.side = 'auto';
      e.to.side = 'auto';
    });
  }

  /* ---------------- 序列化 ---------------- */
  function clone(doc) { return JSON.parse(JSON.stringify(doc)); }

  function normalize(raw) {
    const doc = createDoc({});
    if (!raw || !Array.isArray(raw.nodes)) return doc;
    doc.title = typeof raw.title === 'string' ? raw.title : doc.title;
    if (raw.canvas) {
      doc.canvas.w = num(raw.canvas.w, 1600);
      doc.canvas.h = num(raw.canvas.h, 1000);
      doc.canvas.bg = raw.canvas.bg || doc.canvas.bg;
      doc.canvas.grid = raw.canvas.grid !== false;
    }
    doc.nodes = raw.nodes.map(function (n) { return createNode(n); });
    const ids = {};
    doc.nodes.forEach(function (n) { ids[n.id] = true; });
    (raw.edges || []).forEach(function (e) {
      if (!e || !e.from || !e.to) return;
      if (!ids[e.from.node] || !ids[e.to.node]) return;
      doc.edges.push(createEdge(e.from, e.to, e));
    });
    return doc;
  }

  MM.model = {
    SIDES: SIDES, NORMAL: NORMAL, DASH_PATTERN: DASH_PATTERN,
    NODE_STYLE: NODE_STYLE, EDGE_STYLE: EDGE_STYLE,
    uid: uid, clamp: clamp, dist: dist, round: round,
    createDoc: createDoc, createNode: createNode, createEdge: createEdge, sampleDoc: sampleDoc,
    findNode: findNode, findEdge: findEdge, centerOf: centerOf, anchorOf: anchorOf, autoSide: autoSide,
    edgeEnds: edgeEnds, edgeGeometry: edgeGeometry, hitNode: hitNode, hitTest: hitTest,
    bounds: bounds, treeInfo: treeInfo, outline: outline, autoLayout: autoLayout,
    clone: clone, normalize: normalize
  };

  /* 供 shapes.js / render.js 使用的共享小工具 */
  MM.round = round;
  MM.clamp = clamp;
  MM.dist = dist;
  MM.uid = uid;
})(window);
