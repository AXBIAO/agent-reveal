# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.0] - 2026-11-06

### 新增
- Chrome MV3 扩展：工具栏弹窗设置、`Alt+Shift+R` 快捷键、`tabCapture` 录屏（无需确认共享）
- 录屏完成后显示真实保存路径，支持「在文件夹中显示」「打开视频」
- 真人打字：标题会打出重复字、颠倒、错字，停顿后退格改对
- 书签版自动录屏，跑完下载并弹出保存面板

### 变更
- 录屏改用 WebCodecs H.264 + mp4-muxer 输出 MP4；不支持时退回 MediaRecorder WebM

### 修复
- Chrome MediaRecorder 输出的 MP4 解码大面积花屏（H.264 分片错误）
- 采集到间隔极短的重复帧时，MP4 时间戳重叠

## [0.2.0] - 2026-11-06

### 新增
- 光标按下 → 拖到对角拉框（尺寸实时变化）→ 松手后内容出现
- 文字打字时光标跟随打字位置；块元素出现时光标移到中间"放下"

### 变更
- 没有任务的光标自动隐藏，画面中只出现正在工作的光标

## [0.1.0] - 2026-11-06

### 新增
- 书签脚本：收集页面图层，多光标逐层"搭建"，选框带 `宽 × 高` 标签
- 右下角状态条：`agents | layers | Typing…`
- 自动滚动、Esc 中止、结束后字节级还原

[0.3.0]: https://github.com/AXBIAO/agent-reveal/releases/tag/v0.3.0
