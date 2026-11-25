/* ============================================================
 * palette.js —— 调色盘按钮与面板
 * 默认锁定为「原文件配色」；用户主动解锁后才能改色。
 * ============================================================ */
(function (global) {
  'use strict';

  var Theme = global.Theme;

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function paintState() {
    var snap = Theme.get();
    var isOriginal = snap.mode === 'original';

    $$('.js-mode').forEach(function (r) {
      r.checked = (r.value === 'original') === isOriginal;
    });

    $$('.js-preset').forEach(function (b) {
      var active = !isOriginal && b.dataset.main.toLowerCase() === snap.main.toLowerCase();
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });

    var swatch = $('#js-current');
    if (swatch) swatch.style.background = snap.palette.main;

    var hexInput = $('#js-hex');
    if (hexInput) hexInput.value = snap.palette.main.replace('#', '').toUpperCase();

    var colorInput = $('#js-color');
    if (colorInput) colorInput.value = snap.palette.main;

    var acc = $('#js-accent');
    if (acc) acc.checked = snap.accentOn;

    var panel = $('#palette-panel');
    if (panel) panel.dataset.locked = isOriginal ? 'true' : 'false';

    var lockNote = $('#js-locknote');
    if (lockNote) lockNote.hidden = !isOriginal;

    var fab = $('#palette-fab');
    if (fab) fab.style.setProperty('--fab-color', snap.palette.main);
  }

  function wire() {
    var fab = $('#palette-fab');
    var panel = $('#palette-panel');
    if (!fab || !panel) return;

    function setOpen(open) {
      panel.classList.toggle('is-open', open);
      fab.setAttribute('aria-expanded', String(open));
      if (open) {
        var first = panel.querySelector('input, button');
        if (first) first.focus({ preventScroll: true });
      }
    }

    fab.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!panel.classList.contains('is-open'));
    });

    document.addEventListener('click', function (e) {
      if (!panel.classList.contains('is-open')) return;
      if (panel.contains(e.target) || fab.contains(e.target)) return;
      setOpen(false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.classList.contains('is-open')) {
        setOpen(false);
        fab.focus();
      }
    });

    var closeBtn = $('#js-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        setOpen(false);
        fab.focus();
      });
    }

    /* 模式切换 */
    $$('.js-mode').forEach(function (r) {
      r.addEventListener('change', function () {
        if (r.value === 'original') {
          Theme.useOriginal();
        } else if (r.value === 'custom') {
          var snap = Theme.get();
          if (snap.mode === 'original') Theme.setMain(snap.palette.main);
        }
        paintState();
      });
    });

    /* 预置主题 */
    $$('.js-preset').forEach(function (b) {
      b.addEventListener('click', function () {
        Theme.usePreset(b.dataset.main);
        paintState();
      });
    });

    /* 取色器 + HEX */
    var color = $('#js-color'), hex = $('#js-hex');
    if (color) {
      color.addEventListener('input', function () {
        Theme.setMain(color.value);
        paintState();
      });
    }
    if (hex) {
      hex.addEventListener('change', function () {
        var v = hex.value.trim().replace('#', '');
        if (/^[0-9a-fA-F]{6}$/.test(v)) {
          Theme.setMain('#' + v);
          paintState();
        } else {
          paintState();
        }
      });
    }

    /* 图片取色 */
    var file = $('#js-file'), note = $('#js-extract-note');
    if (file) {
      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        if (!f) return;
        if (note) note.textContent = '正在取色…';
        Theme.extractFromImage(f).then(function (hexVal) {
          Theme.setMain(hexVal);
          paintState();
          if (note) note.textContent = '已取色 ' + hexVal.toUpperCase();
        }).catch(function (err) {
          if (note) note.textContent = '取色失败：' + err.message;
        });
      });
    }

    /* 强调色开关 */
    var accent = $('#js-accent');
    if (accent) {
      accent.addEventListener('change', function () {
        Theme.setAccentOn(accent.checked);
        paintState();
      });
    }

    /* 恢复原文件配色 */
    var reset = $('#js-reset');
    if (reset) {
      reset.addEventListener('click', function () {
        Theme.useOriginal();
        paintState();
      });
    }

    Theme.onChange(paintState);
    paintState();
  }

  global.PosterPalette = { wire: wire, refresh: paintState };
})(window);
