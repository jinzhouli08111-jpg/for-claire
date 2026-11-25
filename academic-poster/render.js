/* ============================================================
 * render.js —— 把 config 渲染成三套版式
 * 只负责排版：文字与图片原样搬过来，不产生任何新内容。
 * ============================================================ */
(function (global) {
  'use strict';

  var cfg = global.POSTER_CONFIG || {};
  var FORMATS = cfg.formats || {};
  var SECTIONS = cfg.sections || [];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function weight(sec) {
    var chars = (sec.body || []).join('').length + String(sec.title || '').length;
    return chars + (sec.figure ? 360 : 0) + 40;
  }

  /* 顺序不变的分栏：按累计权重切，保证阅读顺序从左到右、从上到下 */
  function distribute(cols) {
    var n = Math.max(1, cols);
    if (n === 1) return [SECTIONS.slice()];
    var total = SECTIONS.reduce(function (s, x) { return s + weight(x); }, 0);
    var target = total / n;
    var out = [];
    var col = [];
    var acc = 0;
    var colIndex = 0;
    for (var i = 0; i < SECTIONS.length; i++) {
      col.push(SECTIONS[i]);
      acc += weight(SECTIONS[i]);
      var remainingSections = SECTIONS.length - i - 1;
      var remainingCols = n - colIndex - 1;
      var shouldBreak = remainingCols > 0 &&
        acc >= target * (colIndex + 1) &&
        remainingSections >= remainingCols;
      if (shouldBreak) {
        out.push(col);
        col = [];
        colIndex++;
      }
    }
    if (col.length) out.push(col);
    while (out.length < n) out.push([]);
    return out;
  }

  function sectionNode(sec) {
    var wrap = el('section', 'sec');
    var head = el('h2', 'sec__title');
    head.appendChild(el('span', 'sec__num', sec.no || ''));
    head.appendChild(el('span', 'sec__label', sec.title || ''));
    wrap.appendChild(head);

    (sec.body || []).forEach(function (p) {
      wrap.appendChild(el('p', 'sec__p', p));
    });

    if (sec.figure) {
      var fig = el('figure', 'figure');
      if (sec.figure.src) {
        var img = el('img', 'figure__img');
        img.src = sec.figure.src;
        img.alt = sec.figure.caption || '';
        img.loading = 'lazy';
        fig.appendChild(img);
      } else {
        var ph = el('div', 'figure__ph');
        ph.appendChild(el('span', 'figure__ph-tag', 'IMAGE'));
        ph.appendChild(el('span', 'figure__ph-note', '原图占位 · 将原样嵌入，不裁切'));
        fig.appendChild(ph);
      }
      if (sec.figure.caption) fig.appendChild(el('figcaption', 'figure__cap', sec.figure.caption));
      wrap.appendChild(fig);
    }
    return wrap;
  }

  function buildPoster(key) {
    var fmt = FORMATS[key] || { cols: 2, preview: { w: 794, h: 1123 } };
    var meta = cfg.meta || {};
    var art = el('article', 'poster poster--' + key);
    art.id = 'poster-' + key;
    art.style.width = fmt.preview.w + 'px';
    art.style.height = fmt.preview.h + 'px';

    var head = el('header', 'poster__head');
    var headInner = el('div', 'poster__head-inner');
    if (meta.kicker) headInner.appendChild(el('p', 'poster__kicker', meta.kicker));
    headInner.appendChild(el('h1', 'poster__title', meta.title || ''));
    if (meta.subtitle) headInner.appendChild(el('p', 'poster__subtitle', meta.subtitle));
    if (meta.authors) headInner.appendChild(el('p', 'poster__byline', meta.authors));
    if (meta.affiliation) headInner.appendChild(el('p', 'poster__byline poster__byline--sub', meta.affiliation));
    head.appendChild(headInner);
    art.appendChild(head);

    var body = el('div', 'poster__body');
    var cols = distribute(fmt.cols || 2);
    cols.forEach(function (list) {
      var c = el('div', 'col');
      list.forEach(function (sec) { c.appendChild(sectionNode(sec)); });
      body.appendChild(c);
    });
    art.appendChild(body);

    if (meta.footer) {
      var foot = el('footer', 'poster__foot');
      foot.appendChild(el('span', 'poster__foot-line'));
      foot.appendChild(el('span', 'poster__foot-text', meta.footer));
      art.appendChild(foot);
    }
    return art;
  }

  function fitAll() {
    var stage = document.getElementById('stage');
    if (!stage) return;
    var availW = stage.clientWidth - 8;
    var availH = window.innerHeight - stage.getBoundingClientRect().top - 24;
    Object.keys(FORMATS).forEach(function (key) {
      var node = document.getElementById('poster-' + key);
      if (!node) return;
      var pw = FORMATS[key].preview.w, ph = FORMATS[key].preview.h;
      var z = Math.min(availW / pw, availH / ph, 1);
      node.style.transform = 'scale(' + z + ')';
      var box = node.parentElement;
      if (box) {
        box.style.width = (pw * z) + 'px';
        box.style.height = (ph * z) + 'px';
      }
    });
  }

  function renderAll() {
    var stage = document.getElementById('stage');
    if (!stage) return;
    stage.innerHTML = '';
    Object.keys(FORMATS).forEach(function (key) {
      var box = el('div', 'poster-box');
      box.dataset.format = key;
      box.appendChild(buildPoster(key));
      stage.appendChild(box);
    });
    fitAll();
  }

  function show(key) {
    Array.prototype.forEach.call(document.querySelectorAll('.poster-box'), function (b) {
      b.classList.toggle('is-active', b.dataset.format === key);
    });
  }

  global.PosterRender = {
    renderAll: renderAll,
    show: show,
    fit: fitAll,
    distribute: distribute,
    sectionNode: sectionNode,
  };
})(window);
