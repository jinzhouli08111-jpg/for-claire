/* ============================================================
 * app.js —— 启动与交互
 * ============================================================ */
(function (global) {
  'use strict';

  var cfg = global.POSTER_CONFIG || {};
  var currentFormat = 'ppt';

  function byId(id) { return document.getElementById(id); }

  function buildPresets() {
    var wrap = byId('js-presets');
    if (!wrap) return;
    (cfg.presets || []).forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset js-preset';
      b.dataset.main = p.main;
      b.style.setProperty('--sw', p.main);
      b.setAttribute('aria-label', p.name);
      b.setAttribute('aria-pressed', 'false');
      b.title = p.name;
      var name = document.createElement('span');
      name.className = 'preset__name';
      name.textContent = p.name;
      b.appendChild(name);
      wrap.appendChild(b);
    });
  }

  function wireTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (x) {
          x.classList.remove('is-active');
          x.setAttribute('aria-selected', 'false');
        });
        t.classList.add('is-active');
        t.setAttribute('aria-selected', 'true');
        currentFormat = t.dataset.format;
        global.PosterRender.show(currentFormat);
        global.PosterRender.fit();
      });
    });
  }

  function wireExport() {
    var btn = byId('btn-export');
    var status = byId('status');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var labels = { ppt: 'PPT', pdf: 'PDF', word: 'Word' };
      btn.disabled = true;
      var oldText = btn.textContent;
      btn.textContent = '生成中…';
      if (status) status.textContent = '正在生成 ' + labels[currentFormat] + '…';

      var job = currentFormat === 'ppt'
        ? global.PosterExport.pptx()
        : currentFormat === 'pdf'
          ? global.PosterExport.pdf()
          : global.PosterExport.docx();

      job.then(function (msg) {
        if (status) status.textContent = msg || '完成';
      }).catch(function (err) {
        console.error(err);
        if (status) status.textContent = '失败：' + (err && err.message ? err.message : err);
      }).finally(function () {
        btn.disabled = false;
        btn.textContent = oldText;
        setTimeout(function () { if (status) status.textContent = ''; }, 4000);
      });
    });
  }

  function wireResize() {
    var t = null;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(function () { global.PosterRender.fit(); }, 120);
    });
  }

  function boot() {
    global.Theme.init();
    buildPresets();
    global.PosterRender.renderAll();
    global.PosterPalette.wire();
    wireTabs();
    wireExport();
    wireResize();
    global.PosterRender.show(currentFormat);

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { global.PosterRender.fit(); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
