# 学术海报 · 排版润色（三端输出）

内容冻结：**只改版式，不动一个字、一张图。**
同一套视觉产出 PPT / PDF / Word 三种文件；配色由访客用右下角调色盘选择，默认锁定原文件配色。

## 快速开始

双击 `start.cmd`（会自动打开 http://localhost:8080）。
命令行方式：`node serve.mjs`。

不要直接双击 `index.html`：`file://` 下浏览器会拦截画布取色与部分资源。

## 文件结构

```
academic-poster/
├── index.html      预览页（格式标签 + 导出按钮 + 调色盘）
├── config.js       ← 唯一需要改的地方：文字、图片、尺寸、配色
├── theme.js        配色内核（主色派生、对比度自检、图片取色）
├── render.js       三套版式渲染（PPT 三栏 / PDF 两栏 / Word 单栏）
├── palette.js      调色盘按钮与面板
├── export.js       导出 .pptx / .pdf / .docx
├── app.js          启动、标签切换、导出按钮
├── poster.css      海报版式
├── palette.css     调色盘样式
├── serve.mjs       本地预览服务器（零依赖）
└── start.cmd       Windows 一键预览
```

## 部署到 Cloudflare Pages

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → **Upload assets**
2. 把整个 `academic-poster` 文件夹拖进去（或连 Git，构建命令留空，输出目录 `/`）
3. 纯静态、无后端、无构建

## 换成原件内容（三步）

1. `config.js` 的 `meta` 换成原件标题、作者、单位原文
2. `sections` 按**原件顺序**逐段粘贴：一段一个字符串，**一个字都不改**
3. 图片放进 `img/`，图块填 `figure.src = 'img/xxx.png'`，`caption` 照抄原件图注

尺寸与原件不同时，只改 `formats` 里的 `width` / `height`（英寸）与 `cols`（栏数）。

## 配色规则

- 默认「保留原文件」：颜色取自 `originalColors`，不引入新色 → 导出等于零改动
- 切到「自定义」后只选一个主色，深色 / 浅色 / 分割线 / 强调色全部由主色派生，**只允许同一色相 + 黑白灰**
- 支持网页取色器、HEX 输入、上传图片自动取主色
- 选择写入 URL（`?c=1B3A5C&m=preset`），复制链接即可分享同一配色

## 导出说明

| 格式 | 实现 | 特点 |
|---|---|---|
| PPT | PptxGenJS | 原生形状与文本框，可在 PowerPoint 继续编辑，配色逐层写入 |
| PDF | html2canvas + jsPDF | 像素级还原预览，A4 竖版 |
| Word | docx | 真 .docx，标题色随配色，正文可编辑 |

三个库按需从 CDN 加载，首次导出需联网。

## 待办（拿到原件后）

- [ ] 用原件原文替换 `config.js` 占位文字（逐字）
- [ ] 原件图片放进 `img/` 并填 `src`
- [ ] 核对 `formats` 尺寸方向是否与原件一致
- [ ] 跑逐字 diff（文本必须 100% 一致）
