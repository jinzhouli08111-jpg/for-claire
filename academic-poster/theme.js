/* ============================================================
 * theme.js —— 配色内核
 * 规则：用户只能选「主色」。其余所有颜色由主色按固定规则派生，
 *       且只允许同一色相 + 黑白灰，绝不引入第二种彩色。
 * ============================================================ */
(function (global) {
  'use strict';

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) h = '1B3A5C';
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  function rgbToHex(c) {
    var f = function (v) { return clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0'); };
    return '#' + f(c.r) + f(c.g) + f(c.b);
  }

  function rgbToHsl(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h * 360, s: s, l: l };
  }

  function hslToRgb(hsl) {
    var h = ((hsl.h % 360) + 360) % 360 / 360, s = clamp(hsl.s, 0, 1), l = clamp(hsl.l, 0, 1);
    if (s === 0) { var v = Math.round(l * 255); return { r: v, g: v, b: v }; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    var hue = function (t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return { r: Math.round(hue(h + 1 / 3) * 255), g: Math.round(hue(h) * 255), b: Math.round(hue(h - 1 / 3) * 255) };
  }

  function relLum(rgb) {
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
  }

  function contrast(a, b) {
    var l1 = relLum(hexToRgb(a)), l2 = relLum(hexToRgb(b));
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function mix(a, b, t) {
    var A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex({
      r: A.r + (B.r - A.r) * t,
      g: A.g + (B.g - A.g) * t,
      b: A.b + (B.b - A.b) * t,
    });
  }

  /* 只调明度/饱和度，色相不变 —— 保证「不新增颜色」 */
  function shift(hex, dl, ds) {
    var hsl = rgbToHsl(hexToRgb(hex));
    hsl.l = clamp(hsl.l + (dl || 0), 0.05, 0.97);
    hsl.s = clamp(hsl.s + (ds || 0), 0, 1);
    return rgbToHex(hslToRgb(hsl));
  }

  function derive(mainHex, accentHex, accentOn) {
    var main = /^#?[0-9a-fA-F]{6}$/.test(mainHex) ? (mainHex[0] === '#' ? mainHex : '#' + mainHex) : '#1B3A5C';
    var mainDark = shift(main, -0.22, 0.02);
    var light = mix(main, '#FFFFFF', 0.90);
    var line = mix(main, '#FFFFFF', 0.78);
    var accent = accentOn ? (accentHex || shift(main, 0.18, -0.15)) : shift(main, 0.12, -0.1);
    var onMain = contrast(main, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#141414';
    return {
      main: main,
      mainDark: mainDark,
      light: light,
      accent: accent,
      bg: '#FFFFFF',
      text: '#1A1A1A',
      muted: '#5A6570',
      line: line,
      onMain: onMain,
    };
  }

  var STORAGE_KEY = 'poster.theme.v1';
  var cfg = global.POSTER_CONFIG || {};
  var listeners = [];

  var state = {
    mode: 'original',
    main: (cfg.originalColors && cfg.originalColors.main) || '#1B3A5C',
    accent: (cfg.originalColors && cfg.originalColors.accent) || '#B08A3E',
    accentOn: true,
  };

  function snapshot() {
    var original = (cfg.originalColors && cfg.originalColors.main) || '#1B3A5C';
    var useMain = state.mode === 'original' ? original : state.main;
    var useAccent = state.mode === 'original'
      ? ((cfg.originalColors && cfg.originalColors.accent) || derive(original).accent)
      : state.accent;
    return {
      mode: state.mode,
      main: useMain,
      accentOn: state.accentOn,
      palette: derive(useMain, useAccent, state.accentOn),
    };
  }

  function apply() {
    var snap = snapshot();
    var p = snap.palette;
    var root = document.documentElement;
    root.style.setProperty('--c-main', p.main);
    root.style.setProperty('--c-main-dark', p.mainDark);
    root.style.setProperty('--c-light', p.light);
    root.style.setProperty('--c-accent', p.accent);
    root.style.setProperty('--c-bg', p.bg);
    root.style.setProperty('--c-text', p.text);
    root.style.setProperty('--c-muted', p.muted);
    root.style.setProperty('--c-line', p.line);
    root.style.setProperty('--c-on-main', p.onMain);
    root.dataset.posterTheme = snap.mode;
    listeners.forEach(function (fn) { try { fn(snap); } catch (e) { console.error(e); } });
    return snap;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    syncUrl();
  }

  function syncUrl() {
    try {
      var u = new URL(window.location.href);
      if (state.mode === 'original') {
        u.searchParams.delete('c'); u.searchParams.delete('m'); u.searchParams.delete('a');
      } else {
        u.searchParams.set('c', state.main.replace('#', ''));
        u.searchParams.set('m', state.mode);
        u.searchParams.set('a', state.accentOn ? '1' : '0');
      }
      history.replaceState(null, '', u.toString());
    } catch (e) {}
  }

  function restore() {
    var fromUrl = false;
    try {
      var u = new URL(window.location.href);
      var c = u.searchParams.get('c');
      var m = u.searchParams.get('m');
      if (c && /^[0-9a-fA-F]{6}$/.test(c)) {
        state.mode = (m === 'preset' || m === 'custom') ? m : 'custom';
        state.main = '#' + c;
        state.accentOn = u.searchParams.get('a') !== '0';
        fromUrl = true;
      }
    } catch (e) {}
    if (fromUrl) return;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s && s.main) {
        state.mode = s.mode || 'original';
        state.main = s.main;
        state.accent = s.accent || state.accent;
        state.accentOn = s.accentOn !== false;
      }
    } catch (e) {}
  }

  /* 上传图片取主色：色相直方图 + 饱和度加权 */
  function extractFromImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('请选择图片文件')); return; }
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        try {
          var n = 64;
          var cv = document.createElement('canvas');
          cv.width = n; cv.height = n;
          var ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, n, n);
          var data = ctx.getImageData(0, 0, n, n).data;
          var bins = {};
          var gray = { r: 0, g: 0, b: 0, n: 0 };
          for (var i = 0; i < data.length; i += 4) {
            var a = data[i + 3];
            if (a < 128) continue;
            var r = data[i], g = data[i + 1], b = data[i + 2];
            var hsl = rgbToHsl({ r: r, g: g, b: b });
            if (hsl.s < 0.12 || hsl.l < 0.08 || hsl.l > 0.94) {
              if (hsl.s < 0.12 && hsl.l > 0.15 && hsl.l < 0.85) { gray.r += r; gray.g += g; gray.b += b; gray.n++; }
              continue;
            }
            var key = Math.round(hsl.h / 15) % 24;
            if (!bins[key]) bins[key] = { w: 0, h: 0, s: 0, l: 0, n: 0 };
            var bin = bins[key];
            var weight = hsl.s * (1 - Math.abs(hsl.l - 0.5) * 0.6);
            bin.w += weight; bin.h += hsl.h; bin.s += hsl.s; bin.l += hsl.l; bin.n++;
          }
          var best = null;
          Object.keys(bins).forEach(function (k) {
            var bn = bins[k];
            if (!best || bn.w > best.w) best = bn;
          });
          var hex;
          if (best && best.n > 8) {
            hex = rgbToHex(hslToRgb({ h: best.h / best.n, s: clamp(best.s / best.n, 0.25, 0.85), l: clamp(best.l / best.n, 0.22, 0.55) }));
          } else if (gray.n) {
            var gv = (gray.r + gray.g + gray.b) / (3 * gray.n);
            hex = rgbToHex({ r: gv * 0.7, g: gv * 0.7, b: gv * 0.7 });
          } else {
            hex = '#1B3A5C';
          }
          URL.revokeObjectURL(url);
          resolve(hex);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  var Theme = {
    get: snapshot,
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },

    useOriginal: function () { state.mode = 'original'; apply(); save(); },
    usePreset: function (mainHex) { state.mode = 'preset'; state.main = mainHex; apply(); save(); },

    setMain: function (hex) {
      if (!/^#?[0-9a-fA-F]{6}$/.test(hex)) return;
      state.mode = 'custom';
      state.main = hex[0] === '#' ? hex : '#' + hex;
      apply(); save();
    },

    setAccentOn: function (on) { state.accentOn = !!on; apply(); save(); },
    extractFromImage: extractFromImage,
    contrast: contrast,

    init: function () { restore(); apply(); return snapshot(); },
  };

  global.Theme = Theme;
})(window);
