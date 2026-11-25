# Claire Essay 助手 · 部署说明

一个「教授式」论文/essay 打磨网页应用：干净的前端页面 + Cloudflare Workers 转发后端（调用 DeepSeek）。

- 对方**打开网址即用**：无需安装、无需注册、无需配 Key。
- 你的 DeepSeek Key 只放在 Cloudflare 的后端密钥里，**不会暴露**给使用者。
- 论文内容只做转发，**不落库、不留存**。

---

## 文件说明

| 文件 | 作用 |
|---|---|
| `worker.js` | 唯一要部署的文件：内含前端页面 + 转发后端 + 设计系统 |
| `home-e.html` | **正式首页**（猫爪版）：小猫图 + 六个肉垫热点 + 悬停说明卡片 |
| `cats/cat-hero-v3.webp` | 首页小猫图（1543×1131，透明底，96KB）；改图请换文件名，否则浏览器缓存不会更新 |
| `ds.css` | 全站设计系统：字体、颜色、间距、圆角、动效、文字样式、通用组件 |
| `fonts/manrope-latin.woff2` | Manrope 拉丁子集（24.5KB，可变字重 400–700），本地内嵌，不走 Google CDN |
| `build.js` | 把页面 / ds.css / 字体 / 小猫图打包进 `worker.js`（`node build.js`） |
| `server.js` | 本地预览服务器（`node server.js` → http://localhost:8787） |

### 设计系统速查

- **字体**：`Manrope`（拉丁）+ 系统中文字体（苹方 / 微软雅黑）。`--font` 由 `ds.css` 统一定义。
- **颜色**：`--brand #16a34a` / `--brand-dark #15803d` / `--bg #f5f9f6` / `--ink #1f2a23` / `--muted #6b7a70` / `--line #e3ebe5`。
- **字阶**：12 / 14 / 16 / 18 / 20 / 24 / 30 / 36 / 48 / 60 / 72，全部配好行高；也可直接用 `.heading-1…6` `.title-1…5` `.body-1…6` `.caption-1…5`。
- **间距**：`--s-25`(2) `--s-50`(4) `--s-75`(8) `--s-100`(12) `--s-200`(16) `--s-300`(24) `--s-400`(32) `--s-500`(40) `--s-600`(48) `--s-700`(64) `--s-800`(80) `--s-900`(96)。
- **圆角**：`--r-sm`2 / `--r`4 / `--r-md`6 / `--r-lg`8 / `--r-xl`12 / `--r-2xl`16 / `--r-3xl`24 / `--r-full`。
- **动效**：`--ease: cubic-bezier(0.22,1,0.36,1)`，`--dur-fast`200ms / `--dur`300ms / `--dur-slow`500ms；只动 `transform` / `opacity` / 颜色。
- **无障碍**：全站 `:focus-visible` 焦点环、skip-link、`prefers-reduced-motion` 降级。
- **页面外壳**：统一 64px 半透明毛玻璃 sticky 顶栏、`.page` / `.wrap` 容器 1080px、卡片 `--r-2xl` + `--shadow-1`。

> 改样式时优先用 `var(--…)` token，不要写新的 px 魔法数字；否则会和字阶/间距表脱节。

---

## 一、注册 Cloudflare（免费，无需信用卡）

1. 打开 <https://dash.cloudflare.com/sign-up>
2. 用邮箱注册并登录。

---

## 二、创建 Worker 并粘贴代码

1. 登录后，左侧菜单点 **Workers & Pages**。
2. 点右上角 **Create application（创建应用程序）** → 选择 **Create Worker（创建 Worker）**。
3. 起个名字（比如 `claire-essay-helper`），点 **Deploy（部署）**（先会用示例代码）。
4. 进入该 Worker 页面，点右上角 **Edit code（编辑代码）**。
5. **全选删除**编辑器里的示例代码，把本仓库 `worker.js` 的**全部内容**粘贴进去。
6. 点右上角 **Deploy（部署）**。

---

## 三、配置你的 DeepSeek API Key（Secret）

1. 进入该 Worker 的 **Settings（设置）** → **Variables and Secrets（变量和机密）**。
2. 在 **Secrets（机密）** 区域点 **Add（添加）**：
   - **Name（名称）**：`DEEPSEEK_API_KEY`
   - **Value（值）**：粘贴你的 DeepSeek Key（`sk-` 开头）
3. 保存。

> 配置 Secret 后，通常需要**重新部署一次**才会生效：回到代码编辑器，直接再点一次 **Deploy（部署）** 即可。

---

## 四、访问与分享

**正式地址：<https://ljz-love-claire.asia>**（`www.ljz-love-claire.asia` 同样可用）

备用地址：<https://lijinzhou-love-claire.jinzhouli08111.workers.dev>

- http 会自动 301 跳到 https（在 Worker 里实现，不依赖后台的 Always Use HTTPS 开关）。
- 自定义域名由 `wrangler.toml` 的 `routes` 声明，部署时自动创建 DNS 记录与边缘证书。
- 改完文件后的发布流程：

```powershell
cd D:\dsworkplace_eassy\claire-essay-helper-web
node build.js      # 把 7 个页面 + ds.css + 字体打包进 worker.js
wrangler deploy    # 上传
```

> 只改 `worker.js` 里的后端逻辑（提示词、模型参数）可以跳过 `build.js`，直接 `wrangler deploy`。
> 本地预览用 `node server.js` → http://localhost:8787

---

## 五、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 提示「后端未配置 DEEPSEEK_API_KEY」 | Secret 没配或没重新部署，回第三步检查并再部署一次 |
| 提示「DeepSeek 接口返回错误 401」 | Key 填错 / 已失效，去 DeepSeek 后台重新生成 |
| 提示「DeepSeek 接口返回错误 402」 | DeepSeek 账户余额不足，去充值 |
| 等待很久没反应 | 长文生成较慢属正常；若超时可在 `worker.js` 里把 `max_tokens` 调小 |
| 想换模型 | 改 `worker.js` 里 `model` 字段（如 `deepseek-reasoner`），重新部署 |

---

## 六、可选：用命令行部署（适合会点代码的人）

1. 安装 Node.js，然后：`npm install -g wrangler`
2. `wrangler login`（浏览器授权）
3. 把 `worker.js` 复制到一个空目录，在该目录运行：
   ```
   wrangler deploy worker.js --name claire-essay-helper
   wrangler secret put DEEPSEEK_API_KEY
   ```

---

## 七、费用与合规

- 费用按 DeepSeek 的 API 用量计费，与 Cloudflare（免费额度）无关。
- 本工具定位为**写作辅助与语言润色**，请合规使用，勿用于学术不端。

---

## 八、作图模板的导出（元素级，文字可编辑）

页面里的「导出 PPT / PDF / Word」是**纯前端、零依赖**手写的 OOXML / PDF，
不加载 html2canvas / jsPDF / pptxgenjs，国内网络也能用。
导出的**不是整张图**，而是真正的文本框和段落，进 Office 可以直接改字、改字号、改对齐：

| 格式 | 实现方式 | 可编辑性 |
|---|---|---|
| PPT | 单页 OOXML：色块=形状、文字=文本框、插图框=带虚线边框的形状、花边=透明 PNG 图层 | 文字、字号、颜色、对齐、位置全部可改（实测 8 个对象中 5 个是文本框） |
| Word | OOXML 段落：每块文字一个段落，带 `w:jc` 对齐、缩进、字号、颜色；色块=底纹段落；插图框=1×1 虚线表格；花边=页面边框 | 段落、对齐、字号、颜色全部可改（实测段落对齐值 left/center/right 正确） |
| PDF | 手写 PDF 1.4：文本用标准字体（Helvetica / Times / Courier）原地排版 | 文字可选、可编辑；花边与背景以位图铺底 |

**已知限制**：PDF 的标准字体不含中文字形，所以**含中文的段落会以图片嵌入**（英文/数字仍是可编辑文字）。
PPT 和 Word 没有这个问题，中文照样能改。

### 本地调试

```
node server.js
# 打开 http://localhost:8787/ai-template.html
```

调试钩子：`?demo=all`（六种版式各一张）、`?demo=edit`（直接进编辑器）、`?demo=export`（导出自检）、`?demo=cat`（五类主题各看一批）、`?demo=deco`（六种花边各一张）。
