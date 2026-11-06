<div align="center">

<img src="extension/icons/128.png" width="88" alt="Agent Reveal">

# Agent Reveal

**把任何一个做好的网页，变成"一群 AI agent 正在协作搭建它"的演示动画，并自动录成 MP4。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/AXBIAO/agent-reveal/actions/workflows/ci.yml/badge.svg)](https://github.com/AXBIAO/agent-reveal/actions/workflows/ci.yml)
![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)
![No dependencies at runtime](https://img.shields.io/badge/runtime-zero%20deps-success)

简体中文 · [English](README.en.md)

</div>

<p align="center">
  <img src="docs/demo-typing.gif" width="49%" alt="光标拉框、标题打错再改">
  <img src="docs/demo-swarm.gif" width="49%" alt="多个 agent 同时搭建页面">
</p>

页面本身不做任何改动：脚本先把元素藏起来，再让 3→26 个彩色光标像蜂群一样逐个"搭"回来。跑完或按 <kbd>Esc</kbd> 后页面完全还原。适合做产品宣传片、发布会演示、短视频素材。

## ✨ 特性

- **蜂群式多光标**：光标数量随进度增长；每个光标飞到元素一角 → 按下 → 拖到对角拉出选框（尺寸实时变化）→ 松手吸附，内容出现在框内
- **只显示干活的光标**：没有任务的光标自动淡出，画面里不会有光标闲着乱飘
- **真人打字**：标题会打出重复字、颠倒、错字，停顿后退格改对（例如先打出"让让"再改成"让每个人"）；带闪烁的插入光标；大标题先用小字号打，再逐级放大
- **设计软件质感**：选框带控制点和 `宽 × 高` 标签；放下元素时标出和邻近元素的红色间距；拉参考线时标尺从边缘滑入，用完收起，不遮挡网页内容
- **复制组件**：自动识别一排导航标签、一组卡片这类重复组件，先搭出第一个，其余用 <kbd>⌥</kbd> 拖拽复制出来（副本框跟着光标走，松手吸附并标出间距），粘贴后再把里面的文字重新打一遍
- **钢笔画线**：分隔线、单边边框、`<hr>` 用钢笔工具画出：点下起点锚点，拖出橡皮筋，点下终点后线变实
- **参考线来自真实排版**：自动找出左边缘对齐或顶边对齐的元素，由光标从标尺上把参考线拉出来，对齐的元素再依次吸附上去
- **线框占位**：图片和色块先显示灰色占位框（图片带对角 ✕），再出现真实内容，图片从上往下扫出；光标随工具变形（箭头 / 十字准星 / I 形）
- **合成音效**：以清脆的鼠标点击、机械键盘声为主，参考线吸附有"嗒"的一声；只有大块内容和图片才偶尔响一个很轻的木琴音（对齐节拍，每秒最多一两个）；声音会录进视频，音画对齐（偏差约 ±30ms）
- **开场与收尾**：页面自上而下溶解成白板，扫描光带扫过；结束时有一个和弦
- **自动录屏，输出标准 MP4**：用 WebCodecs 编码 H.264，再用 [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) 封装，剪映、Premiere、手机都能直接用（[为什么不用 MediaRecorder](#为什么不直接用-mediarecorder-录-mp4)）
- **电脑 / 手机两种视图**：手机视图会把网页切到 390×844 的手机布局，录出竖屏视频（[详见下文](#-手机视图)）
- **告诉你文件存在哪**：扩展版跑完后弹出真实保存路径，支持「在文件夹中显示」「打开视频」
- **完全还原**：结束后逐字节恢复原始 `style` 属性，不影响页面后续交互
- **两种用法**：Chrome 扩展（推荐）或书签脚本（不用安装任何东西）

## 🚀 快速开始

### 方式一：安装 Chrome 扩展（推荐，不需要 Node.js）

1. 到 [Releases](https://github.com/AXBIAO/agent-reveal/releases/latest) 下载 `agent-reveal-extension-v*.zip`，解压到一个**固定的文件夹**（删掉这个文件夹，扩展就没了）
2. Chrome 地址栏打开 `chrome://extensions`，打开右上角的 **开发者模式**
3. 点 **加载已解压的扩展程序**，选择刚解压出的文件夹（里面直接就是 `manifest.json`）
4. 点工具栏的拼图图标 🧩，把 **Agent Reveal** 固定到工具栏

> Edge 也可以用：打开 `edge://extensions`，步骤相同。

### 方式二：从源码构建

需要 [Node.js](https://nodejs.org/) 20 或更高版本。

```bash
git clone https://github.com/AXBIAO/agent-reveal.git
cd agent-reveal
npm install
npm run build
```

然后按方式一的第 2–4 步，在第 3 步选择仓库里的 `extension/` 文件夹。

### 方式三：书签脚本（什么都不用装）

1. 从 [Releases](https://github.com/AXBIAO/agent-reveal/releases/latest) 下载 `install.html`，用 Chrome 打开（或者源码构建后打开 `dist/install.html`）
2. 按 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> 显示书签栏，把页面上的「▶ Agent Reveal」按钮**拖到书签栏**
3. 打开任意网站，点这个书签

书签版录屏时 Chrome 会询问「共享此标签页」，确认后才开始录；视频保存到浏览器默认下载文件夹。

## 📖 使用

<img src="docs/popup.png" width="300" align="right" alt="扩展弹窗">

1. 打开要演示的网页，**等它完全加载完**
2. 点工具栏的 Agent Reveal 图标，按需调整设置，点 **▶ 开始**
3. 动画开始后不要操作页面；中途想停就按 <kbd>Esc</kbd>（录屏会丢弃）
4. 跑完后弹出保存面板，显示视频的完整路径

也可以直接按 <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>，用上次的设置开始（可在 `chrome://extensions/shortcuts` 修改）。

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| 视图 | 电脑 | **电脑**：按当前窗口播放和录屏；**手机**：切到 390×844 手机布局，录竖屏视频 |
| 自动录屏 | 开 | 录当前标签页（含音效），跑完自动保存 MP4 |
| 声音 | 开 | 鼠标、键盘、放置音效；播放中可以点状态条上的喇叭，或按 <kbd>M</kbd> 静音 |
| 标尺与参考线 | 开 | 参考线（拉线时标尺滑入）、间距红线 |
| 自动向下滚动 | 开 | 关闭后只搭当前屏幕，你往下滚到哪里，光标就跟到哪里继续搭 |
| 光标上限 | 26 | 同时在场的光标最大数量（4–40） |
| 动作速度 | 1.0× | **越大越快**（0.5×–2.0×）；页面很长时可以调大 |
| 显示 Agent 名字 | 关 | 光标旁显示 `Agent 1`、`Agent 2`… |

<br clear="right">

<p align="center"><img src="docs/saved-panel.png" width="520" alt="录屏保存面板"></p>

### 录屏保存在哪

| 用法 | 保存位置 |
| --- | --- |
| 扩展 | `下载文件夹\agent-reveal\agent-reveal-<域名>-<日期>-<时间>.mp4`，面板里显示完整路径 |
| 书签 | 浏览器默认下载文件夹；浏览器不向网页暴露真实路径，面板里只能显示文件名。可按 <kbd>Ctrl</kbd>+<kbd>J</kbd> 打开下载列表，或点「另存为…」自己选目录 |

### 录出好看视频的小技巧

- 录屏只录网页内容区，不含地址栏和标签栏；分辨率等于网页的实际像素（例如 4K 屏全屏约 3840×2160）
- 关掉开发者工具和页面上的弹窗、Cookie 横幅
- 想要"手机实拍屏幕"的质感，可以关掉自动录屏，直接用手机拍

## 📱 手机视图

在弹窗里选 **📱 手机**，开始后扩展会：

1. 临时把当前窗口缩成手机比例，并放大这个标签页的缩放，让网页的视口正好是 **390×844**（主流手机尺寸），响应式网站会切换到手机布局
2. 按屏幕高度自动选最大的缩放，录出更清晰的竖屏视频（例如 2560×1440 屏约 620×1342）
3. 结束或按 <kbd>Esc</kbd> 后，窗口大小、位置、最大化状态和缩放全部恢复

注意：

- 手机视图是按**屏幕宽度**切换布局的，适用于绝大多数响应式网站；少数靠识别"是不是手机浏览器"跳转到独立手机站（如 `m.xxx.com`）的网站，不会切过去
- 缩放只作用于这一个标签页，不影响同网站的其他标签
- 屏幕较矮时（如 1366×768 笔记本），窗口会向下超出屏幕，以保住手机高度，超出的部分照样会被录进去
- 书签版不支持手机视图，可以用开发者工具的设备模式（<kbd>F12</kbd> → <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>）代替

## ⚙️ 书签版配置

点书签前先在控制台（<kbd>F12</kbd>）设置 `window.AGENT_REVEAL_CONFIG`，再点书签：

```js
window.AGENT_REVEAL_CONFIG = {
  maxAgents: 26,     // 光标上限
  startAgents: 3,    // 开场光标数
  rampRatio: 0.2,    // 前 20% 时长内涨满
  durationMs: 30000, // 决定光标增长节奏（实际总时长取决于页面长度）
  speed: 1,          // 动作速度，越大越快（0.5–2）
  showNames: false,  // 光标旁显示 Agent N
  rulers: true,      // 标尺、参考线、间距红线
  duplicates: true,  // 重复组件用 ⌥ 拖拽复制
  sound: true,       // 音效（书签版在本页合成，录屏会带上）
  autoScroll: true,  // 自动向下滚动
  intro: true,       // 开场溶解 + 扫描
  record: true,      // 自动录屏
};
```

## 🔧 工作原理

1. **收集图层**：遍历 DOM，把文字、图片、按钮、带背景或边框的块收集成"图层"，按从上到下排序后全部隐藏
2. **参考线规划**：在每段约 900px 高的区域里，找出 3 个以上左边缘对齐、或顶边对齐的元素，生成参考线任务，插在它对齐的第一个元素前面
3. **蜂群调度**：只把已经进入视口的任务分给空闲的光标，所以镜头里的每个光标都在干活；施工前沿推进时页面自动滚动（可关闭）
4. **拉框与出现**：十字准星拖拽画框 → 松手吸附、量间距 → 文字按打字脚本逐帧呈现（含打错、停顿、退格），布局不跳动；块元素先显示线框占位再淡入。重复组件里的复制品换成 ⌥ 拖拽复制任务（等原件搭完再开始）；分隔线换成钢笔画线任务
5. **还原**：只撤掉脚本加的内联样式；剩余样式和原来一致时，把原始 `style` 字符串逐字节写回
6. **音效**：WebAudio 实时合成（无音频文件），左右声道跟着光标位置，同时发声数和每秒按键数都有上限，再过一个压缩器。扩展版在离屏页面里合成（网页里的 AudioContext 会被自动播放策略挂起），书签版在本页合成
7. **录屏**：画面用 `MediaStreamTrackProcessor` 逐帧取出 → `VideoEncoder` 编码 H.264；音效音轨用 `AudioEncoder` 编码 AAC（不支持时用 Opus）；再由 `mp4-muxer` 封装。音视频以第一帧到达时刻对齐；分辨率固定，编码器积压时丢帧，内存不会无限增长

### 为什么不直接用 MediaRecorder 录 MP4

实测 Chrome 的 `MediaRecorder` 输出 MP4 时，H.264 分片有问题：用 ffmpeg 解码，每 6 秒就有一百多个错误，画面大面积花屏。有界面、无头模式都一样，跟网页内容无关。同样条件下，WebCodecs + mp4-muxer 的解码错误是 0。所以本项目用 WebCodecs 录 MP4；只有浏览器不支持 WebCodecs 时，才退回 `MediaRecorder` 录 WebM。

## ❓ 常见问题

**点了没反应 / 提示"这个页面不能运行"**
`chrome://`、Chrome 网上应用店等浏览器内置页面不允许扩展运行，换成普通网页即可。

**页面没有自动往下滚**
有些网站的滚动发生在页面内部的容器里，而不是整个窗口，目前不支持自动滚动这类页面。

**有的内容直接出现，没有被光标搭出来**
运行时才动态插入的内容（比如滚动后懒加载的列表），不在开始时收集的图层里。可以先把页面从头到尾滚一遍、等内容加载完，再开始。

**视频文件很大**
大小取决于分辨率：1440×900 一分钟约 25MB，4K 会大几倍。需要小文件的话，可以用剪辑软件导出，或者 `ffmpeg -i in.mp4 -crf 28 out.mp4` 压缩。

**扩展需要哪些权限？**
只用 `activeTab`：只有点工具栏图标或按快捷键时，扩展才能访问**当前这个**标签页，不会读取其他网站。另外 `tabCapture` + `offscreen` 用于录屏，`downloads` 用于保存视频并显示路径，`storage` 用于记住设置。

## 🛠 开发

```
src/                     动画与录屏源码（esbuild 打包）
  agent-reveal.js          主脚本：调度、拉框、打字、复制、画线、录屏流程
  layers.js                图层收集、样式隐藏与字节级还原
  repeats.js               重复组件识别、钢笔线判断（纯函数）
  agent-ui.js  cursors.js  光标形态与选框（拖拽 / 选中 / 线框占位）
  hud.js                   状态条（头像、进度、声音开关）
  rulers.js                标尺
  guides.js  redline.js    参考线推算、间距红线（纯函数）
  design-layer.js          参考线与红线的渲染
  intro.js                 开场溶解与扫描
  typing.js                真人打字脚本生成
  sound.js                 音效合成引擎
  pace.js                  速度换算
  mp4-recorder.js          WebCodecs + mp4-muxer 录 MP4（失败时退回 WebM）
  mp4-audio.js             录屏音轨（AAC / Opus）
  recorder.js              书签版录屏（getDisplayMedia）与保存面板
  offscreen.js             扩展离屏页：录屏 + 音效合成
extension/               Chrome MV3 扩展（build 会把 agent-reveal.js、offscreen.js 生成进来）
  manifest.json  sw.js  popup.*  page-ui.js  settings.js  naming.js  viewport.js
scripts/                 构建、文档截图、图标生成
tests/                   单元测试与 Playwright E2E
```

```bash
npm run build       # 构建书签（dist/）与扩展脚本（extension/）
npm run test:unit   # 单元测试：打字、参考线、红线、标尺刻度、音高、文件命名、设置校验
npm run test:sync   # 音画同步：画布闪白 + 同时发声，要求偏差 ±60ms 内
npm run test:e2e    # 书签 E2E：播放、还原、Esc、录屏可解码
npm run test:ext    # 扩展 E2E：tabCapture 录屏、真实路径面板、Esc 丢弃
npm test            # 全部
```

- E2E 默认在 `https://eye.zsf.si` 上运行，可用 `node tests/e2e.mjs --url https://example.com` 换站点
- 书签 E2E 使用本机 Chrome；扩展 E2E 使用 Playwright 自带的 Chromium，因为品牌版 Chrome 137+ 不再支持命令行加载扩展（需要 `npx playwright install chromium`）
- 改了 `src/` 之后要重新 `npm run build`，再到 `chrome://extensions` 点扩展的刷新按钮

欢迎提 Issue 和 PR，提交前请看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 💡 灵感来源

设计思路参考了 Joel Califa 的 [Swarm](https://califa.github.io/swarm-site/) 网站，以及 Dhvanil Patel 基于它做的 [Swarm Rebuild](https://github.com/DhvanilPatel/swarm-cursors) 扩展：十字准星画框、标尺参考线、线框占位、以点击声为主的音效等想法来自它们。两者都没有开源许可证，所以本项目**没有使用它们的任何代码**，实现方式也不同：它们把页面拍成蓝图后在画布上重画，本项目直接在真实 DOM 上逐个显示原有元素，并加入了自动滚动、手机视图和带音轨的 MP4 录屏。

## 📄 许可证

[MIT](LICENSE) © 2026 AXBIAO

打包进构建产物的第三方代码及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
