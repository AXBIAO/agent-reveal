# 贡献指南

感谢你愿意改进 Agent Reveal！

## 开发环境

- Node.js 20+
- Chrome（书签 E2E）
- Playwright 自带的 Chromium（扩展 E2E）：`npx playwright install chromium`
- ffmpeg / ffprobe（E2E 用来检查录屏能否正常解码）

```bash
npm install
npm run build
```

在 `chrome://extensions` 用「加载已解压的扩展程序」加载 `extension/`。改了 `src/` 之后重新 `npm run build`，再点扩展的刷新按钮。

## 提交前

1. `npm run test:unit` 必须通过
2. 改动涉及动画、还原或录屏时，跑一遍 `npm run test:e2e` 和 `npm run test:ext`
3. 录屏相关改动：确认录出来的视频 `ffmpeg -v error -i out.mp4 -f null -` 没有解码错误
4. 改了用户能看到的行为，同步更新 `README.md`、`README.en.md` 和 `CHANGELOG.md`

## 代码约定

- 每个文件只做一件事，尽量控制在 400 行以内
- 外部数据（存储里的设置、表单输入）先校验再用，见 `extension/settings.js`
- 注入页面的函数（`extension/page-ui.js`）会被序列化执行，必须自包含
- 扩展只申请 `activeTab`，不要为了方便加 `<all_urls>` 这类大权限

## 提交信息

使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：`feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`chore:`。

## 发布

1. 更新 `package.json` 与 `extension/manifest.json` 的版本号，以及 `CHANGELOG.md`
2. `npm run build`
3. 打包：`pwsh scripts/package.ps1`，产物在 `dist/`
4. 打 tag 并在 GitHub Releases 上传 `dist/agent-reveal-extension-v*.zip` 和 `dist/install.html`
