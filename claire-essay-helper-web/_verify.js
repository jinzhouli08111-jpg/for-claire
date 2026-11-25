const fs = require('fs');
const files = ['preview.html', 'draft.html', 'ai-check.html', 'ai-template.html', 'ppt.html', 'mindmap.html', 'home.html'];
for (const f of files) {
  const s = fs.readFileSync(__dirname + '/' + f, 'utf8');
  const ok = {
    ds: s.includes('/ds.css'),
    icon: s.includes('rel="icon"'),
    desc: s.includes('name="description"'),
    og: s.includes('og:title'),
    skip: s.includes('class="skip-link"'),
    main: s.includes('id="main"') || s.includes('role="main"')
  };
  const bad = Object.keys(ok).filter(k => !ok[k]);
  console.log(f.padEnd(20), bad.length ? 'MISSING: ' + bad.join(',') : 'all ok');
}
