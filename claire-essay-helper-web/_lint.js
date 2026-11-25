// 静态检查：字号/圆角/间距是否都落在技能刻度上
const fs = require('fs');
const path = require('path');

const FS = [12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72, 96, 128];
const RAD = [0, 2, 4, 6, 8, 12, 16, 24, 999];
const SP = [0, 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96];

const files = ['preview.html', 'draft.html', 'ai-check.html', 'ai-template.html', 'ppt.html', 'mindmap.html', 'home.html', 'ds.css'];

for (const f of files) {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) continue;
  let s = fs.readFileSync(p, 'utf8');
  let css = '';
  if (f.endsWith('.css')) css = s;
  else {
    const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let m;
    while ((m = re.exec(s))) css += m[1] + '\n';
  }

  const badFS = [], badRAD = [], badSP = [];
  let m;

  const fsRe = /font-size\s*:\s*(-?\d*\.?\d+)px/g;
  while ((m = fsRe.exec(css))) {
    const v = parseFloat(m[1]);
    if (!FS.includes(v)) badFS.push(v);
  }
  const radRe = /border-radius\s*:\s*([^;}]+)/g;
  while ((m = radRe.exec(css))) {
    const parts = m[1].match(/(-?\d*\.?\d+)px/g) || [];
    for (const q of parts) {
      const v = parseFloat(q);
      if (!RAD.includes(v)) badRAD.push(v);
    }
  }
  const spRe = /(?:^|[;{\s])(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|block|inline))?\s*:\s*([^;}]+)/g;
  while ((m = spRe.exec(css))) {
    const parts = m[1].match(/(-?\d*\.?\d+)px/g) || [];
    for (const q of parts) {
      const v = parseFloat(q);
      if (!SP.includes(Math.abs(v)) && Math.abs(v) <= 96) badSP.push(v);
    }
  }

  const uniq = a => [...new Set(a)].sort((x, y) => x - y);
  const lab = [];
  if (badFS.length) lab.push('font-size ' + uniq(badFS).join(','));
  if (badRAD.length) lab.push('radius ' + uniq(badRAD).join(','));
  if (badSP.length) lab.push('spacing ' + uniq(badSP).join(','));
  console.log(f.padEnd(20), lab.length ? lab.join(' | ') : 'all on scale');
}
