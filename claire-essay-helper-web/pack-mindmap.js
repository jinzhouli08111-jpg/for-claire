// ============================================================
// pack-mindmap.js
// 把 ..\mindmap\ 这个多文件思维导图工作台，打包成单文件 mindmap.html
// 用法：node pack-mindmap.js
// ============================================================
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'mindmap');
const OUT = path.join(__dirname, 'mindmap.html');

function read(p) {
  return fs.readFileSync(path.join(SRC, p), 'utf8');
}

let html = read('index.html');
const css = read('styles.css');
const jsFiles = ['model', 'shapes', 'render', 'ooxml', 'exporters', 'app'];

// 1) 内联 CSS
html = html.replace(
  /<link[^>]*href="styles\.css"[^>]*>/i,
  '<style>\n' + css + '\n</style>'
);

// 2) 内联 6 个脚本（顺序不变）
let bundle = '';
for (const f of jsFiles) {
  bundle += '\n/* ===== js/' + f + '.js ===== */\n' + read('js/' + f + '.js') + '\n';
}
html = html.replace(
  /<script src="js\/[a-z]+\.js"><\/script>\s*/g,
  ''
);
html = html.replace('</body>', '<script>' + bundle + '</script>\n</body>');

// 3) 顶部加「返回首页」入口
const backLink = '<a class="mm-back" href="./home.html" title="返回首页">&larr; 返回首页</a>';
html = html.replace(
  /<div class="tools">/,
  '<div class="mm-back-wrap">' + backLink + '</div>\n    <div class="tools">'
);
html = html.replace(
  '</head>',
  '<style>\n'
  + '.mm-back-wrap { display: flex; align-items: center; margin-right: 4px; }\n'
  + '.mm-back { display: inline-flex; align-items: center; gap: 4px; text-decoration: none;'
  + ' font-size: 12.5px; color: #15803d; background: #e9f7ee; border: 1px solid #bfe6cd;'
  + ' border-radius: 8px; padding: 5px 10px; font-weight: 600; white-space: nowrap; }\n'
  + '.mm-back:hover { background: #d9f2e3; }\n'
  + '</style>\n</head>'
);

// 4) 标题里标注这是 For Claire 的一页
html = html.replace(/<title>[^<]*<\/title>/, '<title>思维导图 · For Claire</title>');

fs.writeFileSync(OUT, html, 'utf8');
console.log('mindmap.html 已生成，字符数 =', html.length);
console.log('  内联 CSS:', css.length, '字符');
console.log('  内联 JS :', bundle.length, '字符');
