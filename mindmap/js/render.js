/* =========================================================
 * render.js —— SVG 渲染层（画布 / 图形 / 文字 / 连线 / 选中态）
 * ========================================================= */
(function (global) {
  'use strict';
  const MM = (global.MM = global.MM || {});
  const S = MM.shapes;
  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  const markers = {};
  function markerId(color, kind) {
    const key = (kind || 'end') + ':' + String(color).replace(/[^a-zA-Z0-9]/g, '');
    return 'mk_' + key;
  }

  function ensureMarker(defs, color, kind) {
    const id = markerId(color, kind);
    if (markers[id]) return id;
    markers[id] = true;
    const m = el('marker', {
      id: id, viewBox: '0 0 10 10', refX: kind === 'start' ? 1.2 : 8.8, refY: 5,
      markerWidth: 7, markerHeight: 7, orient: 'auto', markerUnits: 'strokeWidth'
    }, defs);
    el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color }, m);
    return id;
  }

  const Render = {
    svg: null, world: null, gEdges: null, gNodes: null, gOverlay: null, defs: null,

    mount(svg) {
      this.svg = svg;
      svg.innerHTML = '';
      this.defs = el('defs', {}, svg);
      /* 无框图形的“马赛克”底纹：只是画布上的可视提示，导出时不出现 */
      const pat = el('pattern', {
        id: 'mm-bare', width: 10, height: 10, patternUnits: 'userSpaceOnUse'
      }, this.defs);
      el('rect', { x: 0, y: 0, width: 10, height: 10, fill: '#FFFFFF' }, pat);
      el('rect', { x: 0, y: 0, width: 5, height: 5, fill: '#E9EFF7' }, pat);
      el('rect', { x: 5, y: 5, width: 5, height: 5, fill: '#E9EFF7' }, pat);
      this.world = el('g', { id: 'world' }, svg);
      this.gEdges = el('g', { id: 'layer-edges' }, this.world);
      this.gNodes = el('g', { id: 'layer-nodes' }, this.world);
      this.gOverlay = el('g', { id: 'layer-overlay' }, this.world);
    },

    setTransform(view) {
      if (!this.world) return;
      this.world.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
    },

    /* ---------- 图形 ---------- */
    nodeShapePath(n) { return S.path(n.shape, n.x, n.y, n.w, n.h); },

    drawText(g, n, editingId) {
      if (editingId === n.id) return;
      const box = S.textBox(n.shape, n.x, n.y, n.w, n.h);
      const lay = S.layoutText(n.text, { fontSize: n.fontSize, bold: n.bold, maxWidth: box.w, maxHeight: box.h });
      if (!lay.lines.length) return;
      const anchorX = n.align === 'left' ? box.x : n.align === 'right' ? box.x + box.w : box.x + box.w / 2;
      const anchor = n.align === 'left' ? 'start' : n.align === 'right' ? 'end' : 'middle';
      const startY = box.y + (box.h - lay.totalHeight) / 2;
      const t = el('text', {
        x: anchorX, y: startY, fill: n.textColor,
        'font-family': '"Microsoft YaHei","PingFang SC","Segoe UI",sans-serif',
        'font-size': lay.fontSize,
        'font-weight': n.bold ? 700 : 400,
        'text-anchor': anchor, 'pointer-events': 'none',
        'dominant-baseline': 'text-before-edge', style: 'white-space:pre'
      }, g);
      lay.lines.forEach(function (line, i) {
        const isLast = i === lay.lines.length - 1;
        const tspan = el('tspan', { x: anchorX, y: startY + i * lay.lineHeight }, t);
        if (lay.truncated && isLast) {
          tspan.setAttribute('x', anchorX);
        }
        tspan.textContent = line === '' ? '\u00a0' : line;
      });
    },

    /* ---------- 主绘制 ---------- */
    draw(doc, state) {
      const st = state || {};
      this.gEdges.innerHTML = '';
      this.gNodes.innerHTML = '';
      this.gOverlay.innerHTML = '';
      const self = this;

      doc.edges.forEach(function (edge) {
        const a = MM.model.findNode(doc, edge.from.node);
        const b = MM.model.findNode(doc, edge.to.node);
        if (!a || !b) return;
        const g = MM.model.edgeGeometry(edge, doc);
        if (!g) return;
        const mk = { 'marker-end': null, 'marker-start': null };
        if (edge.arrowEnd) mk['marker-end'] = 'url(#' + ensureMarker(self.defs, edge.color, 'end') + ')';
        if (edge.arrowStart) mk['marker-start'] = 'url(#' + ensureMarker(self.defs, edge.color, 'start') + ')';
        const isSel = st.selection && st.selection.type === 'edge' && st.selection.id === edge.id;
        const path = el('path', Object.assign({
          d: g.d, fill: 'none', stroke: isSel ? '#2563EB' : edge.color,
          'stroke-width': edge.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          'stroke-dasharray': g.dashArray || null,
          class: 'edge', 'data-id': edge.id
        }, mk), self.gEdges);
        if (isSel) {
          el('path', {
            d: g.d, fill: 'none', stroke: '#2563EB', 'stroke-opacity': 0.25,
            'stroke-width': edge.width + 8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
            'pointer-events': 'none'
          }, self.gEdges);
        }
        path.setAttribute('data-id', edge.id);
      });

      doc.nodes.forEach(function (n) {
        const g = el('g', { class: 'node', 'data-id': n.id }, self.gNodes);
        const isSel = st.selection && st.selection.type === 'node' && st.selection.id === n.id;
        const bare = S.isFrameless(n.shape);
        el('path', {
          d: self.nodeShapePath(n),
          // 无框图形在画布上用马赛克底纹 + 浅虚线，方便看到位置并点选；导出时依然是纯文字
          fill: bare ? 'url(#mm-bare)' : n.fill,
          stroke: bare ? '#CBD5E1' : n.stroke,
          'stroke-width': bare ? 1 : n.strokeWidth,
          'stroke-dasharray': bare ? '6 5' : null,
          'stroke-linejoin': 'round',
          'pointer-events': 'all',
          class: 'node-shape' + (bare ? ' node-bare' : '') + (n.id === (st.rootId || '') ? ' node-root' : '')
        }, g);
        if (isSel && !bare) {
          el('path', {
            d: self.nodeShapePath(n), fill: 'none', stroke: '#1D4ED8',
            'stroke-width': n.strokeWidth + 3, 'stroke-opacity': 0.35, 'pointer-events': 'none'
          }, g);
        }
        self.drawText(g, n, st.editingId);
      });

      this.drawOverlay(doc, st);
    },

    drawOverlay(doc, st) {
      const ov = this.gOverlay;
      const sel = st.selection;

      // 节点选中：四角缩放手柄 + 边缘锚点
      if (sel && sel.type === 'node') {
        const n = MM.model.findNode(doc, sel.id);
        if (n) {
          el('rect', {
            x: n.x - 5, y: n.y - 5, width: n.w + 10, height: n.h + 10,
            fill: 'none', stroke: '#1D4ED8', 'stroke-width': 1.5, 'stroke-dasharray': '5 4',
            'pointer-events': 'none'
          }, ov);
          if (!st.connecting) {
            ['nw', 'ne', 'se', 'sw'].forEach(function (h) {
              const pos = {
                nw: { x: n.x - 5, y: n.y - 5 }, ne: { x: n.x + n.w + 5, y: n.y - 5 },
                se: { x: n.x + n.w + 5, y: n.y + n.h + 5 }, sw: { x: n.x - 5, y: n.y + n.h + 5 }
              }[h];
              el('rect', {
                x: pos.x - 4, y: pos.y - 4, width: 8, height: 8, rx: 2,
                fill: '#FFFFFF', stroke: '#1D4ED8', 'stroke-width': 1.5,
                class: 'handle', 'data-handle': h, 'data-node': n.id, style: 'cursor:' + (h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize')
              }, ov);
            });
          }
          MM.model.SIDES.forEach(function (side) {
            const p = MM.model.anchorOf(n, side);
            el('circle', {
              cx: p.x, cy: p.y, r: 6, fill: '#FFFFFF', stroke: '#1D4ED8', 'stroke-width': 2,
              class: 'anchor', 'data-anchor': side, 'data-node': n.id, style: 'cursor:crosshair'
            }, ov);
          });
        }
      }

      // 连线拖拽预览
      if (st.connecting && st.connecting.preview) {
        const pv = st.connecting.preview;
        el('path', {
          d: 'M ' + pv.x1 + ' ' + pv.y1 + ' L ' + pv.x2 + ' ' + pv.y2,
          stroke: '#1D4ED8', 'stroke-width': 2, 'stroke-dasharray': '6 5', fill: 'none',
          'pointer-events': 'none'
        }, ov);
        el('circle', { cx: pv.x1, cy: pv.y1, r: 5, fill: '#1D4ED8', 'pointer-events': 'none' }, ov);
        el('circle', { cx: pv.x2, cy: pv.y2, r: 8, fill: 'none', stroke: '#1D4ED8', 'stroke-width': 2, 'pointer-events': 'none' }, ov);
      }

      // 框选
      if (st.marquee) {
        const m = st.marquee;
        el('rect', {
          x: Math.min(m.x1, m.x2), y: Math.min(m.y1, m.y2),
          width: Math.abs(m.x2 - m.x1), height: Math.abs(m.y2 - m.y1),
          fill: 'rgba(37,99,235,0.08)', stroke: '#2563EB', 'stroke-width': 1, 'stroke-dasharray': '4 4',
          'pointer-events': 'none'
        }, ov);
      }

      // 拖入提示
      if (st.dropGhost) {
        const g = st.dropGhost;
        el('path', {
          d: S.path(g.shape, g.x, g.y, g.w, g.h),
          fill: 'rgba(37,99,235,0.10)', stroke: '#2563EB', 'stroke-width': 2,
          'stroke-dasharray': '8 6', 'pointer-events': 'none'
        }, ov);
      }
    }
  };

  /* 导出静态 SVG 字符串（无交互，用于下载 / 预览 / 打印） */
  function toSVG(doc, opt) {
    const o = opt || {};
    const svg = document.createElementNS(NS, 'svg');
    const box = o.crop === false
      ? { x: 0, y: 0, w: doc.canvas.w, h: doc.canvas.h }
      : MM.model.bounds(doc, o.pad === undefined ? 48 : o.pad);
    svg.setAttribute('xmlns', NS);
    svg.setAttribute('viewBox', [MM.round(box.x), MM.round(box.y), MM.round(box.w), MM.round(box.h)].join(' '));
    svg.setAttribute('width', Math.ceil(box.w));
    svg.setAttribute('height', Math.ceil(box.h));
    const defs = el('defs', {}, svg);
    el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, fill: o.bg || doc.canvas.bg || '#ffffff' }, svg);

    doc.edges.forEach(function (edge) {
      const geo = MM.model.edgeGeometry(edge, doc);
      if (!geo) return;
      const attrs = {
        d: geo.d, fill: 'none', stroke: edge.color, 'stroke-width': edge.width,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      };
      if (geo.dashArray) attrs['stroke-dasharray'] = geo.dashArray;
      if (edge.arrowEnd) {
        ensureMarker(defs, edge.color, 'end');
        attrs['marker-end'] = 'url(#' + markerId(edge.color, 'end') + ')';
      }
      if (edge.arrowStart) {
        ensureMarker(defs, edge.color, 'start');
        attrs['marker-start'] = 'url(#' + markerId(edge.color, 'start') + ')';
      }
      el('path', attrs, svg);
    });

    doc.nodes.forEach(function (n) {
      const bare = S.isFrameless(n.shape);
      el('path', {
        d: S.path(n.shape, n.x, n.y, n.w, n.h),
        fill: bare ? 'none' : n.fill,
        stroke: bare ? 'none' : n.stroke,
        'stroke-width': bare ? 0 : n.strokeWidth,
        'stroke-linejoin': 'round'
      }, svg);
      const boxT = S.textBox(n.shape, n.x, n.y, n.w, n.h);
      const lay = S.layoutText(n.text, { fontSize: n.fontSize, bold: n.bold, maxWidth: boxT.w, maxHeight: boxT.h });
      if (!lay.lines.length) return;
      const anchorX = n.align === 'left' ? boxT.x : n.align === 'right' ? boxT.x + boxT.w : boxT.x + boxT.w / 2;
      const anchor = n.align === 'left' ? 'start' : n.align === 'right' ? 'end' : 'middle';
      const startY = boxT.y + (boxT.h - lay.totalHeight) / 2;
      const t = el('text', {
        x: anchorX, y: startY, fill: n.textColor,
        'font-family': '"Microsoft YaHei","PingFang SC","Segoe UI",sans-serif',
        'font-size': lay.fontSize, 'font-weight': n.bold ? 700 : 400,
        'text-anchor': anchor, 'dominant-baseline': 'text-before-edge'
      }, svg);
      lay.lines.forEach(function (line, i) {
        const ts = el('tspan', { x: anchorX, y: startY + i * lay.lineHeight }, t);
        ts.textContent = line === '' ? '\u00a0' : line;
      });
    });

    return new XMLSerializer().serializeToString(svg);
  }

  MM.render = Render;
  MM.render.toSVG = toSVG;
  MM.render.esc = esc;
  MM.render.el = el;
})(window);
