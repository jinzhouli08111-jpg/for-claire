/* =========================================================
 * app.js —— 交互逻辑：拖拽建图 / 拖动 / 缩放 / 连线 / 打字 / 撤销 / 导出
 * ========================================================= */
(function (global) {
  'use strict';
  const MM = global.MM;
  const M = MM.model;
  const S = MM.shapes;

  const $ = function (id) { return document.getElementById(id); };
  const svg = $('canvas');
  const area = $('canvasArea');
  const editorLayer = $('textEditorLayer');
  const toastEl = $('toast');

  const state = {
    doc: null,
    view: { x: 0, y: 0, k: 1 },
    sel: [],                 // [{type:'node'|'edge', id}]
    editingId: null,
    drag: null,              // {mode:'move'|'resize', ...}
    connecting: null,
    marquee: null,
    dropGhost: null,
    history: [],
    future: [],
    pendingSnapshot: null,
    service: { ok: false, checked: false }
  };

  /* ============ 通用工具 ============ */
  let toastTimer = null;
  function toast(msg, type, ms) {
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (type === 'err' ? ' err' : type === 'ok' ? ' ok' : '');
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, ms || 3200);
  }
  function cloneDoc() { return JSON.stringify(state.doc); }

  /* 提交一次修改：把「修改前」的快照压入历史栈（由 snapshot() 采集） */
  function commit(pushHistory) {
    if (pushHistory !== false) {
      const prev = state.pendingSnapshot;
      state.pendingSnapshot = null;
      if (prev && prev !== cloneDoc()) {
        state.history.push(prev);
        if (state.history.length > 120) state.history.shift();
        state.future.length = 0;
      }
    }
    updateUndoButtons();
    render();
    persist();
  }
  function snapshot() { state.pendingSnapshot = cloneDoc(); }
  /* 兼容旧调用：拖拽结束后提交 */
  function pushSnapshot() { commit(); }
  function undo() {
    if (!state.history.length) return;
    state.future.push(cloneDoc());
    state.doc = M.normalize(JSON.parse(state.history.pop()));
    state.sel = [];
    state.editingId = null;
    state.pendingSnapshot = null;
    updateUndoButtons(); render(); renderInspector(); persist();
  }
  function redo() {
    if (!state.future.length) return;
    state.history.push(cloneDoc());
    state.doc = M.normalize(JSON.parse(state.future.pop()));
    state.sel = [];
    state.editingId = null;
    state.pendingSnapshot = null;
    updateUndoButtons(); render(); renderInspector(); persist();
  }
  function updateUndoButtons() {
    $('btnUndo').disabled = state.history.length === 0;
    $('btnRedo').disabled = state.future.length === 0;
  }

  /* ============ 视图变换 ============ */
  function screenToWorld(e) {
    const r = area.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - state.view.x) / state.view.k,
      y: (e.clientY - r.top - state.view.y) / state.view.k
    };
  }
  function applyView() {
    MM.render.setTransform(state.view);
    $('zoomLabel').textContent = Math.round(state.view.k * 100) + '%';
    updateGrid();
  }
  function updateGrid() {
    const bg = state.doc.canvas.bg || '#F8FAFC';
    area.style.backgroundColor = bg;
    if (!state.doc.canvas.grid) { area.style.backgroundImage = 'none'; return; }
    const step = 24 * state.view.k;
    if (step < 9) { area.style.backgroundImage = 'none'; return; }
    area.style.backgroundImage =
      'radial-gradient(circle, rgba(148,163,184,.55) 1px, transparent 1.2px)';
    area.style.backgroundSize = step + 'px ' + step + 'px';
    area.style.backgroundPosition = state.view.x + 'px ' + state.view.y + 'px';
  }
  function fitView() {
    const b = M.bounds(state.doc, 70);
    const r = area.getBoundingClientRect();
    const k = Math.min(r.width / b.w, r.height / b.h, 1.35);
    state.view.k = Math.max(0.15, k);
    state.view.x = (r.width - b.w * state.view.k) / 2 - b.x * state.view.k;
    state.view.y = (r.height - b.h * state.view.k) / 2 - b.y * state.view.k;
    applyView();
  }
  function zoomAt(factor, cx, cy) {
    const r = area.getBoundingClientRect();
    const px = cx === undefined ? r.width / 2 : cx - r.left;
    const py = cy === undefined ? r.height / 2 : cy - r.top;
    const k0 = state.view.k;
    const k1 = Math.min(4, Math.max(0.12, k0 * factor));
    const wx = (px - state.view.x) / k0;
    const wy = (py - state.view.y) / k0;
    state.view.k = k1;
    state.view.x = px - wx * k1;
    state.view.y = py - wy * k1;
    applyView();
  }

  /* ============ 渲染 ============ */
  function render() {
    applyView();
    MM.render.draw(state.doc, {
      selection: state.sel.length === 1 ? state.sel[0] : null,
      multi: state.sel.length > 1,
      editingId: state.editingId,
      connecting: state.connecting,
      marquee: state.marquee,
      dropGhost: state.dropGhost,
      rootId: (M.treeInfo(state.doc).root || {}).id
    });
    // 多选高亮
    if (state.sel.length > 1) {
      const ov = MM.render.gOverlay;
      state.sel.forEach(function (s) {
        if (s.type !== 'node') return;
        const n = M.findNode(state.doc, s.id);
        if (!n) return;
        MM.render.el('rect', {
          x: n.x - 4, y: n.y - 4, width: n.w + 8, height: n.h + 8, rx: 4,
          fill: 'none', stroke: '#1D4ED8', 'stroke-width': 1.5, 'stroke-dasharray': '4 3',
          'pointer-events': 'none'
        }, ov);
      });
    }
    updateStatus();
  }
  function updateStatus() {
    $('statNodes').textContent = state.doc.nodes.length + ' 个图形';
    $('statEdges').textContent = state.doc.edges.length + ' 条连线';
    $('statusText').textContent = state.sel.length > 1
      ? '已选中 ' + state.sel.length + ' 项'
      : state.sel.length === 1
        ? (state.sel[0].type === 'node' ? '已选中图形' : '已选中连线')
        : '就绪';
  }

  /* ============ 选中 ============ */
  function isSelected(type, id) {
    return state.sel.some(function (s) { return s.type === type && s.id === id; });
  }
  function selectOnly(type, id) {
    state.sel = [{ type: type, id: id }];
    render();
    renderInspector();
  }
  function clearSelection() {
    state.sel = [];
    render();
    renderInspector();
  }
  function selectedNodes() {
    return state.sel.filter(function (s) { return s.type === 'node'; })
      .map(function (s) { return M.findNode(state.doc, s.id); })
      .filter(Boolean);
  }

  /* ============ 节点增删改 ============ */
  function addNode(shape, wx, wy, opts) {
    const o = opts || {};
    const size = S.defaultSize(shape);
    const n = M.createNode({
      x: Math.round(wx - size.w / 2), y: Math.round(wy - size.h / 2),
      w: size.w, h: size.h, shape: shape,
      text: o.text || '',
      fontSize: o.fontSize || 16,
      fill: o.fill || pickNodeFill(shape),
      stroke: o.stroke || '#2563EB',
      textColor: o.textColor || '#0F172A'
    });
    state.doc.nodes.push(n);
    return n;
  }
  function pickNodeFill(shape) {
    return shape === 'ellipse' || shape === 'circle' ? '#EFF6FF' : '#FFFFFF';
  }
  function deleteSelection() {
    if (!state.sel.length) return;
    endEdit();
    snapshot();
    const nodeIds = {}, edgeIds = {};
    state.sel.forEach(function (s) {
      if (s.type === 'node') nodeIds[s.id] = true; else edgeIds[s.id] = true;
    });
    state.doc.nodes = state.doc.nodes.filter(function (n) { return !nodeIds[n.id]; });
    state.doc.edges = state.doc.edges.filter(function (e) {
      return !edgeIds[e.id] && !nodeIds[e.from.node] && !nodeIds[e.to.node];
    });
    state.sel = [];
    commit();
    renderInspector();
  }
  function duplicateSelection() {
    const nodes = selectedNodes();
    if (!nodes.length) return;
    endEdit();
    snapshot();
    const idMap = {};
    const created = [];
    nodes.forEach(function (n) {
      const c = M.createNode(JSON.parse(JSON.stringify(n)));
      c.id = M.uid('n');
      c.x = n.x + 28; c.y = n.y + 28;
      idMap[n.id] = c.id;
      state.doc.nodes.push(c);
      created.push(c);
    });
    state.doc.edges.forEach(function (e) {
      if (idMap[e.from.node] && idMap[e.to.node]) {
        const c = M.createEdge({ node: idMap[e.from.node], side: e.from.side }, { node: idMap[e.to.node], side: e.to.side }, e);
        state.doc.edges.push(c);
      }
    });
    state.sel = created.map(function (c) { return { type: 'node', id: c.id }; });
    commit();
    renderInspector();
  }

  /* ============ 文字编辑 ============ */
  function beginEdit(node, selectAll) {
    if (!node) return;
    endEdit();
    state.editingId = node.id;
    render();

    const box = S.textBox(node.shape, node.x, node.y, node.w, node.h);
    const k = state.view.k;
    const wpx = Math.max(56, box.w * k);
    const hpx = Math.max(26, box.h * k);
    const left = state.view.x + box.x * k + (box.w * k - wpx) / 2;
    const top = state.view.y + box.y * k + (box.h * k - hpx) / 2;

    const ta = document.createElement('textarea');
    ta.className = 'ink-input';
    ta.value = node.text;
    const originalText = node.text;
    ta.style.left = left + 'px';
    ta.style.top = top + 'px';
    ta.style.width = wpx + 'px';
    ta.style.height = hpx + 'px';
    ta.style.fontSize = Math.max(9, node.fontSize * k) + 'px';
    ta.style.fontWeight = node.bold ? '700' : '400';
    ta.style.color = node.textColor;
    ta.style.textAlign = node.align;
    ta.style.lineHeight = '1.32';
    editorLayer.appendChild(ta);
    ta._nodeId = node.id;

    function centerPad() {
      const lay = S.layoutText(ta.value, {
        fontSize: node.fontSize * k, bold: node.bold, maxWidth: box.w * k, maxHeight: 100000
      });
      const lines = Math.max(1, String(ta.value).split('\n').length);
      const lh = node.fontSize * k * 1.32;
      const pad = Math.max(0, (hpx - Math.max(lay.totalHeight, lines * lh)) / 2);
      ta.style.paddingTop = Math.round(pad) + 'px';
    }
    centerPad();

    let cancelled = false;
    ta.addEventListener('input', function () {
      node.text = ta.value;
      // 自动增高
      const needed = ta.scrollHeight;
      if (needed > hpx + 4) {
        ta.style.height = needed + 'px';
        ta.style.paddingTop = '2px';
      }
      render();
      renderInspector();
    });
    ta.addEventListener('keydown', function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        cancelled = true;
        node.text = originalText;      // 取消编辑，还原文字
        ta.value = originalText;
        ta.blur();
      }
      else if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); ta.blur(); }
    });
    ta.addEventListener('blur', function () {
      const id = ta._nodeId;
      ta.remove();
      state.editingId = null;
      if (!cancelled && id) commit();
      else { state.pendingSnapshot = null; render(); }
      renderInspector();
    });
    // 聚焦并记录快照（若外层已经采集过就不再覆盖）
    if (!state.pendingSnapshot) snapshot();
    ta.focus();
    if (selectAll) ta.select();
    else ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  function endEdit() {
    const ta = editorLayer.querySelector('.ink-input');
    if (ta) ta.blur();
  }

  /* ============ 连线 ============ */
  function startConnect(node, side, e) {
    const p = M.anchorOf(node, side);
    state.connecting = {
      from: node.id, side: side,
      preview: { x1: p.x, y1: p.y, x2: p.x, y2: p.y },
      targetId: null
    };
    svg.classList.add('connect-mode');
    render();
  }
  function finishConnect(world) {
    const c = state.connecting;
    state.connecting = null;
    svg.classList.remove('connect-mode');
    if (!c) return;

    const hit = M.hitTest(state.doc, world.x, world.y, 2);
    let target = hit && hit.type === 'node' ? M.findNode(state.doc, hit.id) : null;

    if (target && target.id === c.from) { render(); return; }

    if (!target) {
      // 拖到空白处：自动新建一个图形并连线
      snapshot();
      target = addNode('textbox', world.x, world.y, { text: '新主题', fontSize: 17 });
      state.doc.edges.push(M.createEdge({ node: c.from, side: c.side }, { node: target.id, side: 'auto' }));
      commit();
      selectOnly('node', target.id);
      beginEdit(target, true);
      return;
    }
    const exists = state.doc.edges.some(function (ed) {
      return (ed.from.node === c.from && ed.to.node === target.id) ||
        (ed.from.node === target.id && ed.to.node === c.from);
    });
    if (exists) { state.pendingSnapshot = null; toast('这两个图形之间已有连线'); return; }
    snapshot();
    const edge = M.createEdge({ node: c.from, side: c.side }, { node: target.id, side: 'auto' });
    edge.dash = 'solid';
    state.doc.edges.push(edge);
    commit();
    selectOnly('edge', edge.id);
  }

  /* ============ 指针交互 ============ */
  svg.addEventListener('pointerdown', function (e) {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // 中键 / Alt+左键：平移画布
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const target = e.target;
    const world = screenToWorld(e);

    // 1) 缩放手柄
    const handle = target.closest('[data-handle]');
    if (handle) {
      e.preventDefault();
      const n = M.findNode(state.doc, handle.getAttribute('data-node'));
      if (!n) return;
      snapshot();
      state.drag = {
        mode: 'resize', h: handle.getAttribute('data-handle'), node: n,
        start: world, orig: { x: n.x, y: n.y, w: n.w, h: n.h }
      };
      svg.setPointerCapture(e.pointerId);
      return;
    }

    // 2) 锚点 → 开始连线
    const anchor = target.closest('[data-anchor]');
    if (anchor) {
      e.preventDefault();
      const n = M.findNode(state.doc, anchor.getAttribute('data-node'));
      if (n) startConnect(n, anchor.getAttribute('data-anchor'), e);
      svg.setPointerCapture(e.pointerId);
      return;
    }

    // 3) 图形
    const nodeEl = target.closest('.node');
    if (nodeEl) {
      const id = nodeEl.getAttribute('data-id');
      const n = M.findNode(state.doc, id);
      if (!n) return;
      e.preventDefault();
      if (e.shiftKey) {
        if (isSelected('node', id)) state.sel = state.sel.filter(function (s) { return !(s.type === 'node' && s.id === id); });
        else state.sel.push({ type: 'node', id: id });
        render(); renderInspector();
        return;
      }
      if (!isSelected('node', id)) selectOnly('node', id);
      const nodes = selectedNodes();
      snapshot();
      state.drag = {
        mode: 'move', start: world,
        items: nodes.map(function (x) { return { node: x, x: x.x, y: x.y }; }),
        moved: false
      };
      svg.setPointerCapture(e.pointerId);
      return;
    }

    // 4) 连线
    const edgeEl = target.closest('.edge');
    if (edgeEl) {
      e.preventDefault();
      selectOnly('edge', edgeEl.getAttribute('data-id'));
      return;
    }

    // 5) 空白：框选 or 平移
    if (e.shiftKey) {
      state.marquee = { x1: world.x, y1: world.y, x2: world.x, y2: world.y };
      state.sel = [];
      render(); renderInspector();
      svg.setPointerCapture(e.pointerId);
      return;
    }
    startPan(e);
  });

  function startPan(e) {
    state.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y };
    svg.classList.add('panning');
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
  }

  svg.addEventListener('pointermove', function (e) {
    const world = screenToWorld(e);

    if (state.connecting) {
      state.connecting.preview.x2 = world.x;
      state.connecting.preview.y2 = world.y;
      render();
      return;
    }
    if (state.marquee) {
      state.marquee.x2 = world.x;
      state.marquee.y2 = world.y;
      render();
      return;
    }
    const d = state.drag;
    if (!d) return;

    if (d.mode === 'pan') {
      state.view.x = d.vx + (e.clientX - d.sx);
      state.view.y = d.vy + (e.clientY - d.sy);
      applyView();
      return;
    }
    if (d.mode === 'move') {
      const dx = world.x - d.start.x, dy = world.y - d.start.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) d.moved = true;
      d.items.forEach(function (it) {
        it.node.x = Math.round(it.x + dx);
        it.node.y = Math.round(it.y + dy);
      });
      render();
      return;
    }
    if (d.mode === 'resize') {
      const dx = world.x - d.start.x, dy = world.y - d.start.y;
      const o = d.orig, n = d.node;
      const minW = 46, minH = 30;
      let x = o.x, y = o.y, w = o.w, h = o.h;
      if (d.h === 'nw') { x = o.x + dx; y = o.y + dy; w = o.w - dx; h = o.h - dy; }
      if (d.h === 'ne') { y = o.y + dy; w = o.w + dx; h = o.h - dy; }
      if (d.h === 'se') { w = o.w + dx; h = o.h + dy; }
      if (d.h === 'sw') { x = o.x + dx; w = o.w - dx; h = o.h + dy; }
      if (w < minW) { if (d.h === 'nw' || d.h === 'sw') x = o.x + o.w - minW; w = minW; }
      if (h < minH) { if (d.h === 'nw' || d.h === 'ne') y = o.y + o.h - minH; h = minH; }
      n.x = Math.round(x); n.y = Math.round(y);
      n.w = Math.round(w); n.h = Math.round(h);
      if (n.shape === 'circle') { const s = Math.min(n.w, n.h); n.w = s; n.h = s; }
      render();
      return;
    }
  });

  svg.addEventListener('pointerup', function (e) {
    const world = screenToWorld(e);
    if (state.connecting) {
      finishConnect(world);
      state.drag = null;
      return;
    }
    if (state.marquee) {
      const m = state.marquee;
      const x1 = Math.min(m.x1, m.x2), x2 = Math.max(m.x1, m.x2);
      const y1 = Math.min(m.y1, m.y2), y2 = Math.max(m.y1, m.y2);
      const ids = state.doc.nodes.filter(function (n) {
        const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
        return cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2;
      }).map(function (n) { return n.id; });
      state.marquee = null;
      state.sel = ids.map(function (id) { return { type: 'node', id: id }; });
      render(); renderInspector();
      return;
    }
    const d = state.drag;
    state.drag = null;
    svg.classList.remove('panning');
    if (d && (d.mode === 'move' || d.mode === 'resize')) {
      if (d.mode === 'move' && !d.moved) {
        state.pendingSnapshot = null;
        render();
      } else {
        commit();
        renderInspector();
      }
    }
  });

  svg.addEventListener('pointercancel', function () {
    state.drag = null;
    state.connecting = null;
    state.marquee = null;
    svg.classList.remove('panning', 'connect-mode');
    render();
  });

  // 滚轮缩放
  area.addEventListener('wheel', function (e) {
    if (e.ctrlKey || e.metaKey || true) {
      e.preventDefault();
      const factor = Math.pow(1.0015, -e.deltaY);
      zoomAt(factor, e.clientX, e.clientY);
    }
  }, { passive: false });

  // 双击：编辑文字 / 空白处新建大圈
  svg.addEventListener('dblclick', function (e) {
    const nodeEl = e.target.closest('.node');
    if (nodeEl) {
      const n = M.findNode(state.doc, nodeEl.getAttribute('data-id'));
      if (n) { selectOnly('node', n.id); beginEdit(n, true); }
      return;
    }
    const world = screenToWorld(e);
    const hit = M.hitTest(state.doc, world.x, world.y, 2);
    if (!hit) {
      snapshot();
      const created = addNode('textbox', world.x, world.y, { text: '新主题', fontSize: 17 });
      commit();
      selectOnly('node', created.id);
      beginEdit(created, true);
    }
  });

  // 右键：删除选中（阻止默认菜单）
  svg.addEventListener('contextmenu', function (e) {
    if (state.sel.length) {
      e.preventDefault();
      deleteSelection();
    }
  });

  /* ============ 拖放：图形库 → 画布 ============ */
  function buildLibrary() {
    const wrap = $('shapeLibrary');
    wrap.innerHTML = '';
    S.LIST.forEach(function (item) {
      const card = document.createElement('div');
      card.className = 'shape-card';
      card.draggable = true;
      card.setAttribute('data-shape', item.id);
      card.title = item.name + '（拖到画布，或双击添加到中央）';
      const size = S.defaultSize(item.id);
      const bare = S.isFrameless(item.id);
      const vb = [-3, -3, size.w + 6, size.h + 6].join(' ');
      const strokeW = Math.max(2, size.w / 40);
      card.innerHTML =
        '<svg viewBox="' + vb + '" preserveAspectRatio="xMidYMid meet">' +
        '<path d="' + S.path(item.id, 0, 0, size.w, size.h) + '"' +
        ' fill="' + (bare ? 'none' : '#EFF6FF') + '"' +
        ' stroke="' + (bare ? '#94A3B8' : '#2563EB') + '"' +
        ' stroke-width="' + strokeW + '"' +
        (bare ? ' stroke-dasharray="9 7"' : '') + ' />' +
        (bare ? '<text x="' + (size.w / 2) + '" y="' + (size.h * 0.66) + '" text-anchor="middle"' +
          ' font-family="Microsoft YaHei,sans-serif" font-weight="700" fill="#475569"' +
          ' font-size="' + (size.h * 0.62) + '">T</text>' : '') +
        '</svg><span>' + item.name + '</span>';
      card.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.setData('text/plain', item.id);
        ev.dataTransfer.setData('application/x-mm-shape', item.id);
        ev.dataTransfer.effectAllowed = 'copy';
        state._dragShape = item.id;
        ev.stopPropagation();
      });
      card.addEventListener('dragend', function () {
        state._dragShape = null;
        state.dropGhost = null;
        render();
      });
      card.addEventListener('dblclick', addShapeAtCenter.bind(null, item.id));
      wrap.appendChild(card);
    });
  }
  function addShapeAtCenter(shape) {
    const r = area.getBoundingClientRect();
    const world = {
      x: (r.width / 2 - state.view.x) / state.view.k,
      y: (r.height / 2 - state.view.y) / state.view.k
    };
    snapshot();
    const n = addNode(shape, world.x, world.y);
    commit();
    selectOnly('node', n.id);
    beginEdit(n, true);
  }

  area.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const shape = state._dragShape;
    if (shape) {
      const w = screenToWorld(e);
      const size = S.defaultSize(shape);
      state.dropGhost = { shape: shape, x: w.x - size.w / 2, y: w.y - size.h / 2, w: size.w, h: size.h };
      render();
    }
  });
  area.addEventListener('dragleave', function (e) {
    if (e.target === area || e.target === svg) {
      state.dropGhost = null;
      render();
    }
  });
  area.addEventListener('drop', function (e) {
    e.preventDefault();
    const dt = e.dataTransfer;
    const shape = state._dragShape || dt.getData('application/x-mm-shape') || dt.getData('text/plain');
    state.dropGhost = null;
    state._dragShape = null;
    if (!shape || !S.map[shape]) { render(); return; }
    const w = screenToWorld(e);
    snapshot();
    const n = addNode(shape, w.x, w.y);
    commit();
    selectOnly('node', n.id);
    beginEdit(n, true);
  });

  /* ============ 属性面板 ============ */
  const SWATCH_FILL = ['#FFFFFF', '#EFF6FF', '#DBEAFE', '#DCFCE7', '#FEF3C7', '#FCE7F3', '#F3E8FF', '#E2E8F0', '#1D4ED8', '#0F172A'];
  const SWATCH_STROKE = ['#2563EB', '#0EA5E9', '#16A34A', '#D97706', '#DB2777', '#7C3AED', '#DC2626', '#0F172A', '#94A3B8', '#1D4ED8'];

  function renderInspector() {
    const body = $('inspectorBody');
    const title = $('inspectorTitle');
    const sub = $('inspectorSub');
    const sel = state.sel;

    if (!sel.length) {
      title.textContent = '属性';
      sub.textContent = '未选中';
      body.innerHTML = emptyInspectorHtml();
      wireInspector();
      return;
    }
    if (sel.length > 1) {
      title.textContent = '批量操作';
      sub.textContent = sel.length + ' 项';
      body.innerHTML = multiInspectorHtml();
      wireInspector();
      return;
    }
    const s = sel[0];
    if (s.type === 'node') {
      const n = M.findNode(state.doc, s.id);
      if (!n) { state.sel = []; renderInspector(); return; }
      title.textContent = '图形属性';
      sub.textContent = S.name(n.shape);
      body.innerHTML = nodeInspectorHtml(n);
    } else {
      const ed = M.findEdge(state.doc, s.id);
      if (!ed) { state.sel = []; renderInspector(); return; }
      title.textContent = '连线属性';
      sub.textContent = { straight: '直线', elbow: '折线', curve: '曲线' }[ed.route] || '连线';
      body.innerHTML = edgeInspectorHtml(ed);
    }
    wireInspector();
  }

  function emptyInspectorHtml() {
    return '' +
      '<div class="insp-empty">' +
      '<b>开始创作：</b>' +
      '<ul>' +
      '<li>从右侧<b>图形库</b>把图形拖进左侧操作区</li>' +
      '<li><b>双击</b>图形即可直接打字（Shift+Enter 换行）</li>' +
      '<li>选中图形后，从<b>边缘圆点</b>拖出连线；<br/>拖到空白处会自动生成子主题</li>' +
      '<li>拖<b>四角手柄</b>可调整图形大小</li>' +
      '<li>滚轮缩放，空白处拖动平移，Shift+拖动框选</li>' +
      '</ul></div>' +
      '<div class="insp-section">' +
      '<p class="insp-title">画布</p>' +
      '<div class="insp-row"><label>底色</label>' +
      '<div class="color-field"><input type="color" data-canvas="bg" value="' + state.doc.canvas.bg + '" />' +
      '<input class="field hex" data-canvas="bg-text" value="' + state.doc.canvas.bg + '" /></div></div>' +
      '<div class="insp-row"><label></label><label class="chk"><input type="checkbox" data-canvas="grid"' +
      (state.doc.canvas.grid ? ' checked' : '') + ' />显示网格</label></div>' +
      '</div>';
  }

  function multiInspectorHtml() {
    return '' +
      '<div class="insp-empty">已选中 <b>' + state.sel.length + '</b> 项，可批量移动、对齐或删除。</div>' +
      '<div class="insp-section"><p class="insp-title">对齐</p>' +
      '<div class="insp-actions">' +
      '<button class="btn-soft" data-cmd="align-left">左对齐</button>' +
      '<button class="btn-soft" data-cmd="align-hcenter">水平居中</button>' +
      '<button class="btn-soft" data-cmd="align-right">右对齐</button>' +
      '</div><div class="insp-actions">' +
      '<button class="btn-soft" data-cmd="align-top">顶对齐</button>' +
      '<button class="btn-soft" data-cmd="align-vcenter">垂直居中</button>' +
      '<button class="btn-soft" data-cmd="align-bottom">底对齐</button>' +
      '</div></div>' +
      '<div class="insp-section"><p class="insp-title">操作</p>' +
      '<div class="insp-actions">' +
      '<button class="btn-soft" data-cmd="duplicate">复制一份</button>' +
      '<button class="btn-soft danger" data-cmd="delete">删除</button>' +
      '</div></div>';
  }

  function colorRow(label, prop, value) {
    return '<div class="insp-row"><label>' + label + '</label>' +
      '<div class="color-field">' +
      '<input type="color" data-prop="' + prop + '" value="' + value + '" />' +
      '<input class="field hex" data-prop="' + prop + '" data-hex="1" value="' + value + '" />' +
      '</div></div>';
  }
  function swatchRow(label, prop, value, colors) {
    let h = '<div class="insp-row col"><label>' + label + '</label><div class="swatches">';
    colors.forEach(function (c) {
      h += '<i class="swatch' + (String(value).toUpperCase() === c.toUpperCase() ? ' on' : '') +
        '" style="background:' + c + '" data-prop="' + prop + '" data-swatch="' + c + '" title="' + c + '"></i>';
    });
    return h + '</div></div>';
  }

  function nodeInspectorHtml(n) {
    let shapeOpts = '';
    S.LIST.forEach(function (s) {
      shapeOpts += '<option value="' + s.id + '"' + (s.id === n.shape ? ' selected' : '') + '>' + s.name + '</option>';
    });
    const bare = S.isFrameless(n.shape);
    const frameSection = bare
      ? '<div class="insp-section">' +
        '<p class="insp-title">边框</p>' +
        '<div class="insp-tip">当前是「无框图形」，只显示文字。想要填充/描边，把上面的「形状」换成圆角矩形、椭圆等即可。</div>' +
        '</div>'
      : '<div class="insp-section">' +
        '<p class="insp-title">填充与描边</p>' +
        colorRow('填充', 'fill', n.fill) +
        swatchRow('常用', 'fill', n.fill, SWATCH_FILL) +
        colorRow('描边', 'stroke', n.stroke) +
        swatchRow('常用', 'stroke', n.stroke, SWATCH_STROKE) +
        '<div class="insp-row"><label>粗细</label>' +
        '<input type="range" class="field" min="0" max="8" step="0.5" data-prop="strokeWidth" value="' + n.strokeWidth + '" />' +
        '<input class="field num-field" type="number" min="0" max="12" step="0.5" data-prop="strokeWidth" value="' + n.strokeWidth + '" /></div>' +
        '</div>';
    return '' +
      '<div class="insp-section">' +
      '<div class="insp-row col"><label>文字</label>' +
      '<textarea class="field" data-prop="text" rows="3" style="height:auto;padding:6px 8px;line-height:1.4;resize:vertical">' +
      MM.render.esc(n.text) + '</textarea></div>' +
      '<div class="insp-row"><label>形状</label>' +
      '<select class="field" data-prop="shape">' + shapeOpts + '</select></div>' +
      '</div>' +

      frameSection +

      '<div class="insp-section">' +
      '<p class="insp-title">文字样式</p>' +
      colorRow('颜色', 'textColor', n.textColor) +
      '<div class="insp-row"><label>字号</label>' +
      '<input type="range" class="field" min="9" max="48" step="1" data-prop="fontSize" value="' + n.fontSize + '" />' +
      '<input class="field num-field" type="number" min="8" max="96" data-prop="fontSize" value="' + n.fontSize + '" /></div>' +
      '<div class="insp-row"><label>样式</label>' +
      '<label class="chk"><input type="checkbox" data-prop="bold"' + (n.bold ? ' checked' : '') + ' />加粗</label>' +
      '</div>' +
      '<div class="insp-row"><label>对齐</label>' +
      '<div class="seg" data-seg="align">' +
      ['left', 'center', 'right'].map(function (a) {
        return '<button data-prop="align" data-value="' + a + '" class="' + (n.align === a ? 'on' : '') + '">' +
          { left: '左', center: '中', right: '右' }[a] + '</button>';
      }).join('') + '</div></div>' +
      '</div>' +

      '<div class="insp-section">' +
      '<p class="insp-title">尺寸与位置</p>' +
      '<div class="insp-row"><label>宽高</label>' +
      '<input class="field num-field" type="number" step="1" min="40" data-prop="w" value="' + Math.round(n.w) + '" />' +
      '<span style="color:#94A3B8">×</span>' +
      '<input class="field num-field" type="number" step="1" min="28" data-prop="h" value="' + Math.round(n.h) + '" /></div>' +
      '<div class="insp-row"><label>坐标</label>' +
      '<input class="field num-field" type="number" step="1" data-prop="x" value="' + Math.round(n.x) + '" />' +
      '<input class="field num-field" type="number" step="1" data-prop="y" value="' + Math.round(n.y) + '" /></div>' +
      '</div>' +

      '<div class="insp-section">' +
      '<div class="insp-actions">' +
      '<button class="btn-soft" data-cmd="duplicate">复制</button>' +
      '<button class="btn-soft" data-cmd="to-center">设为居中</button>' +
      '<button class="btn-soft danger" data-cmd="delete">删除</button>' +
      '</div></div>';
  }

  function edgeInspectorHtml(ed) {
    function segBtn(prop, val, label, cur, extra) {
      return '<button data-prop="' + prop + '" data-value="' + val + '" class="' + (cur === val ? 'on' : '') + '"' +
        (extra || '') + '>' + label + '</button>';
    }
    return '' +
      '<div class="insp-section">' +
      '<p class="insp-title">连线形式</p>' +
      '<div class="seg" style="margin-bottom:7px">' +
      segBtn('route', 'straight', '直线', ed.route) +
      segBtn('route', 'elbow', '折线', ed.route) +
      segBtn('route', 'curve', '曲线', ed.route) +
      '</div>' +
      '<div class="seg" style="margin-bottom:7px">' +
      segBtn('dash', 'solid', '实线', ed.dash) +
      segBtn('dash', 'dash', '虚线', ed.dash) +
      segBtn('dash', 'dot', '点线', ed.dash) +
      '</div>' +
      '</div>' +

      '<div class="insp-section">' +
      '<p class="insp-title">端点箭头</p>' +
      '<div class="insp-row"><label>起点</label>' +
      '<label class="chk"><input type="checkbox" data-prop="arrowStart"' + (ed.arrowStart ? ' checked' : '') + ' />显示箭头</label>' +
      '<label class="chk"><input type="checkbox" data-prop="arrowEnd"' + (ed.arrowEnd ? ' checked' : '') + ' />终点箭头</label>' +
      '</div></div>' +

      '<div class="insp-section">' +
      '<p class="insp-title">颜色与粗细</p>' +
      colorRow('颜色', 'color', ed.color) +
      swatchRow('常用', 'color', ed.color, SWATCH_STROKE) +
      '<div class="insp-row"><label>粗细</label>' +
      '<input type="range" class="field" min="0.5" max="8" step="0.5" data-prop="width" value="' + ed.width + '" />' +
      '<input class="field num-field" type="number" min="0.5" max="12" step="0.5" data-prop="width" value="' + ed.width + '" /></div>' +
      '</div>' +

      '<div class="insp-section"><p class="insp-title">端点位置</p>' +
      '<div class="insp-row"><label>起点</label>' +
      '<select class="field" data-prop="fromSide">' + sideOptions(ed.from.side) + '</select></div>' +
      '<div class="insp-row"><label>终点</label>' +
      '<select class="field" data-prop="toSide">' + sideOptions(ed.to.side) + '</select></div>' +
      '</div>' +

      '<div class="insp-section"><div class="insp-actions">' +
      '<button class="btn-soft" data-cmd="reverse">反向</button>' +
      '<button class="btn-soft danger" data-cmd="delete">删除连线</button>' +
      '</div></div>';
  }
  function sideOptions(cur) {
    const map = { auto: '自动', top: '上', right: '右', bottom: '下', left: '左' };
    return Object.keys(map).map(function (k) {
      return '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' + map[k] + '</option>';
    }).join('');
  }

  /* 属性面板事件绑定（委托，只绑定一次） */
  let inspectorWired = false;
  function wireInspector() {
    if (inspectorWired) return;
    inspectorWired = true;
    const body = $('inspectorBody');
    body.addEventListener('focusin', function (e) {
      if (e.target.matches('[data-prop],[data-canvas]')) snapshot();
    });
    body.addEventListener('input', function (e) {
      const t = e.target;
      if (t.hasAttribute('data-canvas')) {
        const key = t.getAttribute('data-canvas');
        if (key === 'bg' || key === 'bg-text') {
          const v = t.value;
          if (/^#[0-9a-f]{6}$/i.test(v)) {
            state.doc.canvas.bg = v;
            applyView();
          }
          if (key === 'bg') {
            const hex = body.querySelector('[data-canvas="bg-text"]');
            if (hex) hex.value = v;
          } else {
            const cp = body.querySelector('input[type="color"][data-canvas="bg"]');
            if (cp && /^#[0-9a-f]{6}$/i.test(v)) cp.value = v;
          }
        }
        return;
      }
      const prop = t.getAttribute('data-prop');
      if (!prop) return;
      applyProp(prop, readValue(t), false);
    });
    body.addEventListener('change', function (e) {
      const t = e.target;
      if (t.hasAttribute('data-canvas')) {
        if (t.getAttribute('data-canvas') === 'grid') {
          state.doc.canvas.grid = t.checked;
          updateGrid(); persist();
        }
        return;
      }
      const prop = t.getAttribute('data-prop');
      if (prop) { applyProp(prop, readValue(t), false); pushSnapshot(); persist(); }
      if (prop === 'shape' || prop === 'strokeWidth') renderInspector();
    });
    body.addEventListener('click', function (e) {
      const sw = e.target.closest('[data-swatch]');
      if (sw) {
        snapshot();
        const prop = sw.getAttribute('data-prop');
        applyProp(prop, sw.getAttribute('data-swatch'), true);
        pushSnapshot();
        renderInspector();
        e.preventDefault();
        return;
      }
      const btn = e.target.closest('[data-cmd]');
      if (btn) { runCommand(btn.getAttribute('data-cmd')); e.preventDefault(); return; }
      const seg = e.target.closest('[data-value][data-prop]');
      if (seg && seg.tagName === 'BUTTON') {
        snapshot();
        applyProp(seg.getAttribute('data-prop'), seg.getAttribute('data-value'), true);
        pushSnapshot();
        renderInspector();
        e.preventDefault();
      }
    });
    body.addEventListener('keydown', function (e) {
      if (e.target.matches('textarea') && e.key === 'Enter' && !e.shiftKey) e.target.blur();
      e.stopPropagation();
    });
  }
  function readValue(t) {
    if (t.type === 'checkbox') return t.checked;
    if (t.type === 'range' || t.type === 'number') return parseFloat(t.value);
    return t.value;
  }

  function applyProp(prop, value, doRender) {
    const sel = state.sel;
    if (!sel.length) return;
    const isNode = sel[0].type === 'node';
    sel.forEach(function (s) {
      if (isNode) {
        const n = M.findNode(state.doc, s.id);
        if (!n) return;
        if (prop === 'shape') {
          if (S.map[value]) {
            const wasRound = S.isRound(n.shape);
            n.shape = value;
            // 保持正圆比例
            if (value === 'circle') { const d = Math.max(n.w, n.h); n.w = d; n.h = d; }
            else if (wasRound && S.isRound(value) && n.w === n.h) { /* noop */ }
          }
        } else if (prop === 'w' || prop === 'h' || prop === 'x' || prop === 'y') {
          if (isFinite(value)) n[prop] = Math.round(value);
          if (prop === 'w' && n.shape === 'circle') n.h = n.w;
          if (prop === 'h' && n.shape === 'circle') n.w = n.h;
        } else if (prop === 'strokeWidth') {
          if (isFinite(value)) n.strokeWidth = Math.max(0, value);
        } else if (prop === 'fontSize') {
          if (isFinite(value)) n.fontSize = Math.max(6, Math.min(160, value));
        } else if (prop === 'bold') {
          n.bold = !!value;
        } else if (prop === 'text') {
          n.text = String(value);
        } else if (prop === 'fill' || prop === 'stroke' || prop === 'textColor' || prop === 'align') {
          n[prop] = value;
        }
      } else {
        const ed = M.findEdge(state.doc, s.id);
        if (!ed) return;
        if (prop === 'fromSide') ed.from.side = value;
        else if (prop === 'toSide') ed.to.side = value;
        else if (prop === 'width') { if (isFinite(value)) ed.width = Math.max(0.25, value); }
        else if (prop === 'arrowStart' || prop === 'arrowEnd') ed[prop] = !!value;
        else if (prop === 'route' || prop === 'dash' || prop === 'color') ed[prop] = value;
      }
    });
    if (doRender !== false) render();
    else render();
    updateStatus();
    updateInspectorLive();
  }

  /* 拖动滑块时同步输入框等联动控件，不重建整个面板（避免焦点丢失） */
  function updateInspectorLive() {
    const body = $('inspectorBody');
    if (!body || state.sel.length !== 1) return;
    const s = state.sel[0];
    if (s.type === 'node') {
      const n = M.findNode(state.doc, s.id);
      if (!n) return;
      [['w', n.w], ['h', n.h], ['x', n.x], ['y', n.y], ['strokeWidth', n.strokeWidth], ['fontSize', n.fontSize]]
        .forEach(function (pair) {
          body.querySelectorAll('[data-prop="' + pair[0] + '"]').forEach(function (inp) {
            if (document.activeElement === inp) return;
            inp.value = typeof pair[1] === 'number' ? Math.round(pair[1] * 100) / 100 : pair[1];
          });
        });
    }
  }

  function runCommand(cmd) {
    const nodes = selectedNodes();
    switch (cmd) {
      case 'delete': deleteSelection(); break;
      case 'duplicate': duplicateSelection(); break;
      case 'reverse': {
        const ed = M.findEdge(state.doc, state.sel[0].id);
        if (ed) {
          snapshot();
          const t = ed.from; ed.from = ed.to; ed.to = t;
          const a = ed.arrowStart; ed.arrowStart = ed.arrowEnd; ed.arrowEnd = a;
          commit(); renderInspector();
        }
        break;
      }
      case 'to-center': {
        if (!nodes.length) break;
        snapshot();
        const n = nodes[0];
        // 作为中心主题：放大并居中，其他节点保持
        n.shape = 'ellipse';
        n.w = Math.max(n.w, 220); n.h = Math.max(n.h, 116);
        n.fontSize = Math.max(n.fontSize, 22); n.bold = true;
        n.fill = n.fill === '#FFFFFF' ? '#1D4ED8' : n.fill;
        n.textColor = n.fill === '#1D4ED8' ? '#FFFFFF' : n.textColor;
        commit(); renderInspector();
        break;
      }
      case 'align-left': case 'align-right': case 'align-hcenter':
      case 'align-top': case 'align-bottom': case 'align-vcenter': {
        if (nodes.length < 2) { toast('请至少选中 2 个图形'); break; }
        snapshot();
        const xs = nodes.map(function (n) { return n.x; });
        const ys = nodes.map(function (n) { return n.y; });
        const x2 = nodes.map(function (n) { return n.x + n.w; });
        const y2 = nodes.map(function (n) { return n.y + n.h; });
        const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, x2);
        const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, y2);
        nodes.forEach(function (n) {
          if (cmd === 'align-left') n.x = minX;
          if (cmd === 'align-right') n.x = maxX - n.w;
          if (cmd === 'align-hcenter') n.x = Math.round((minX + maxX) / 2 - n.w / 2);
          if (cmd === 'align-top') n.y = minY;
          if (cmd === 'align-bottom') n.y = maxY - n.h;
          if (cmd === 'align-vcenter') n.y = Math.round((minY + maxY) / 2 - n.h / 2);
        });
        commit(); renderInspector();
        break;
      }
      default: break;
    }
  }

  /* ============ 草稿箱 ============ */
  const DRAFT_KEY = 'mindmap.drafts.v1';
  const DRAFT_MAX = 20;

  function loadDrafts() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(function (d) { return d && d.doc && d.id; }) : [];
    } catch (e) { return []; }
  }
  function saveDrafts(list) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(list.slice(0, DRAFT_MAX)));
      return true;
    } catch (e) {
      toast('草稿箱存满了，删掉几份旧草稿再试', 'err');
      return false;
    }
  }
  /* 把「当前状态」存进草稿箱；和最新一份内容相同时只更新时间 */
  function pushDraft(silent) {
    const list = loadDrafts();
    const snap = JSON.parse(cloneDoc());
    const now = Date.now();
    if (list.length && JSON.stringify(list[0].doc) === JSON.stringify(snap)) {
      list[0].at = now;
    } else {
      list.unshift({ id: 'd' + now.toString(36) + Math.random().toString(36).slice(2, 5), at: now, doc: snap });
    }
    if (saveDrafts(list) && !silent) toast('已存入草稿箱（共 ' + Math.min(list.length, DRAFT_MAX) + ' 份）', 'ok');
    return loadDrafts();
  }
  function hintTime(ts) {
    const d = new Date(ts), n = new Date();
    const pad = function (v) { return String(v).padStart(2, '0'); };
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.toDateString() === n.toDateString()) return '今天 ' + hm;
    const days = Math.round((n - d) / 86400000);
    if (days === 1) return '昨天 ' + hm;
    if (days < 7) return days + ' 天前 ' + hm;
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  }
  function renderDraftList() {
    const list = loadDrafts();
    const body = $('draftList');
    $('draftSub').textContent = '共 ' + list.length + ' 份';
    if (!list.length) {
      body.innerHTML = '<div class="draft-empty">草稿箱还是空的 —— 点上方「草稿箱」就会把当前状态存进来。</div>';
      return;
    }
    body.innerHTML = list.map(function (d) {
      let thumb = '';
      try {
        thumb = MM.render.toSVG(M.normalize(d.doc), { pad: 24 });
      } catch (e) { thumb = ''; }
      return '<div class="draft-card" data-id="' + d.id + '">' +
        '<div class="draft-thumb">' + thumb + '</div>' +
        '<div class="draft-info"><b>' + MM.render.esc((d.doc.title || '未命名思维导图')) + '</b>' +
        '<small>' + hintTime(d.at) + ' · ' + (d.doc.nodes || []).length + ' 个图形 · ' +
        (d.doc.edges || []).length + ' 条连线</small></div>' +
        '<div class="draft-acts">' +
        '<button data-act="load">取回</button>' +
        '<button data-act="del">删除</button>' +
        '</div></div>';
    }).join('');
  }
  function openDrafts() {
    pushDraft(true);           // 先把当前状态保住，再打开
    renderDraftList();
    $('draftModal').hidden = false;
  }
  function closeDrafts() { $('draftModal').hidden = true; }
  function loadDraft(id) {
    const item = loadDrafts().filter(function (d) { return d.id === id; })[0];
    if (!item) return;
    snapshot();
    state.doc = M.normalize(item.doc);
    state.sel = [];
    state.editingId = null;
    $('docTitle').value = state.doc.title;
    $('chkGrid').checked = state.doc.canvas.grid !== false;
    commit();
    fitView();
    renderInspector();
    closeDrafts();
    toast('已取回草稿：' + state.doc.title, 'ok');
  }
  function deleteDraft(id) {
    saveDrafts(loadDrafts().filter(function (d) { return d.id !== id; }));
    renderDraftList();
  }

  /* ============ 一键清空 ============ */
  function clearCanvas() {
    if (!state.doc.nodes.length && !state.doc.edges.length) {
      toast('画布已经是空的了');
      return;
    }
    endEdit();
    snapshot();
    state.doc.nodes = [];
    state.doc.edges = [];
    state.sel = [];
    state.editingId = null;
    commit();
    renderInspector();
    toast('已清空画布，可按 Ctrl+Z 撤销，或到「草稿箱」取回上一版', 'ok', 4200);
  }

  /* ============ 顶栏按钮 ============ */
  function wireTopbar() {
    $('btnUndo').addEventListener('click', undo);
    $('btnRedo').addEventListener('click', redo);
    $('btnZoomIn').addEventListener('click', function () { zoomAt(1.2); });
    $('btnZoomOut').addEventListener('click', function () { zoomAt(1 / 1.2); });
    $('btnFit').addEventListener('click', function () { fitView(); });
    $('btnDraft').addEventListener('click', openDrafts);
    $('btnClear').addEventListener('click', clearCanvas);
    $('draftClose').addEventListener('click', closeDrafts);
    $('draftSaveNew').addEventListener('click', function () {
      pushDraft(false);
      renderDraftList();
    });
    $('draftModal').addEventListener('click', function (e) {
      if (e.target === $('draftModal')) closeDrafts();
    });
    $('draftList').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const card = btn.closest('.draft-card');
      const id = card && card.getAttribute('data-id');
      if (!id) return;
      if (btn.getAttribute('data-act') === 'load') loadDraft(id);
      else deleteDraft(id);
    });
    $('btnAutoLayout').addEventListener('click', function () {
      snapshot();
      M.autoLayout(state.doc);
      commit();
      fitView();
      toast('已按左右分支重新排版', 'ok');
    });
    $('btnCenter').addEventListener('click', function () {
      const r = area.getBoundingClientRect();
      const cx = (r.width / 2 - state.view.x) / state.view.k;
      const cy = (r.height / 2 - state.view.y) / state.view.k;
      snapshot();
      const root = M.createNode({
        x: cx - 115, y: cy - 58, w: 230, h: 116, shape: 'ellipse',
        text: '中心主题', fontSize: 22, bold: true,
        fill: '#1D4ED8', stroke: '#1E40AF', textColor: '#FFFFFF'
      });
      state.doc.nodes.push(root);
      commit();
      selectOnly('node', root.id);
      beginEdit(root, true);
    });
    $('chkGrid').addEventListener('change', function () {
      state.doc.canvas.grid = this.checked;
      updateGrid(); persist();
    });
    const titleInput = $('docTitle');
    titleInput.value = state.doc.title;
    titleInput.addEventListener('change', function () {
      state.doc.title = this.value || '未命名思维导图';
      persist();
    });

    // 导出菜单
    const menu = $('exportMenu');
    $('btnExport').addEventListener('click', function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
    });
    menu.addEventListener('click', function (e) {
      const item = e.target.closest('[data-action]');
      if (!item) return;
      menu.hidden = true;
      MM.exporters.run(item.getAttribute('data-action'), state.doc, {
        toast: toast,
        onOpen: openJson
      });
    });
    $('fileInput').addEventListener('change', function (e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const raw = JSON.parse(String(reader.result));
          const doc = M.normalize(raw);
          if (!doc.nodes.length) throw new Error('文件里没有图形数据');
          state.doc = doc;
          state.sel = [];
          state.history = []; state.future = [];
          $('docTitle').value = doc.title;
          $('chkGrid').checked = doc.canvas.grid;
          commit();
          fitView();
          renderInspector();
          toast('已载入工程：' + doc.title, 'ok');
        } catch (err) {
          toast('打开失败：' + err.message, 'err');
        }
      };
      reader.readAsText(f, 'utf-8');
      e.target.value = '';
    });
  }
  function openJson() { $('fileInput').click(); }

  /* ============ 键盘 ============ */
  document.addEventListener('keydown', function (e) {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || state.editingId;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape' && !$('draftModal').hidden) {
      e.preventDefault();
      closeDrafts();
      return;
    }
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      MM.exporters.run('json', state.doc, { toast: toast, onOpen: openJson });
      return;
    }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openJson(); return; }
    if (typing) return;
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      state.sel = state.doc.nodes.map(function (n) { return { type: 'node', id: n.id }; });
      render(); renderInspector();
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
    if (mod && (e.key === '0' || e.key === ')')) { e.preventDefault(); fitView(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomAt(1.2); return; }
    if (mod && e.key === '-') { e.preventDefault(); zoomAt(1 / 1.2); return; }
    if (state.editingId) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelection();
      return;
    }
    if (e.key === 'Escape') {
      if (state.connecting) { state.connecting = null; svg.classList.remove('connect-mode'); render(); }
      else clearSelection();
      return;
    }
    if (e.key === 'F2') {
      const n = selectedNodes()[0];
      if (n) beginEdit(n, true);
      return;
    }
    if (e.key.indexOf('Arrow') === 0 && state.sel.length) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      selectedNodes().forEach(function (n) { n.x += dx; n.y += dy; });
      render();
      if (!state._nudgeTimer) state._nudgeTimer = setTimeout(function () {
        state._nudgeTimer = null;
        commit();
      }, 500);
      return;
    }
  });

  /* ============ 本地存储 ============ */
  const LS_KEY = 'mindmap.workbench.v1';
  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ doc: state.doc, view: state.view }));
      } catch (err) { /* 忽略配额错误 */ }
    }, 400);
  }
  function restore() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.doc || !Array.isArray(obj.doc.nodes) || !obj.doc.nodes.length) return null;
      return obj;
    } catch (err) { return null; }
  }

  /* ============ 启动 ============ */
  function init() {
    MM.render.mount(svg);
    buildLibrary();

    const saved = restore();
    state.doc = saved ? M.normalize(saved.doc) : M.sampleDoc();
    state.doc.canvas.grid = true;
    $('docTitle').value = state.doc.title;
    $('chkGrid').checked = true;

    wireTopbar();
    renderInspector();
    fitView();
    if (saved && saved.view) {
      state.view = { x: saved.view.x, y: saved.view.y, k: saved.view.k };
      applyView();
    }
    render();
    updateUndoButtons();

    setTimeout(function () { $('canvasHint').classList.add('hide'); }, 7000);
    area.addEventListener('pointerdown', function () { $('canvasHint').classList.add('hide'); }, { once: true });


  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  MM.app = {
    state: state, render: render, renderInspector: renderInspector, toast: toast, commit: commit,
    openDrafts: openDrafts, closeDrafts: closeDrafts, pushDraft: pushDraft,
    loadDraft: loadDraft, deleteDraft: deleteDraft, clearCanvas: clearCanvas,
    renderDraftList: renderDraftList, loadDrafts: loadDrafts
  };
})(window);
