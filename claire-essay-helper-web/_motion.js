// 审计：transition 是否都用 token、是否有魔法时长 <200ms
const fs = require('fs');
const path = require('path');
const files = ['preview.html', 'draft.html', 'ai-check.html', 'ai-template.html', 'ppt.html', 'mindmap.html', 'home.html', 'ds.css'];
for (const f of files) {
  const s = fs.readFileSync(path.join(__dirname, f), 'utf8');
  const re = /transition(?:-[a-z]+)?\s*:\s*([^;}]+)/g;
  let m, bad = [];
  while ((m = re.exec(s))) {
    const v = m[1];
    if (/var\(--dur/.test(v)) continue;
    if (/none|inherit|initial|\.01ms/.test(v)) continue;
    bad.push(v.trim());
  }
  const uniq = [...new Set(bad)];
  console.log(f.padEnd(20), uniq.length ? uniq.slice(0, 4).map(x => x.slice(0, 60)).join(' || ') + (uniq.length > 4 ? ' ...+' + (uniq.length - 4) : '') : 'all tokenized');
}
