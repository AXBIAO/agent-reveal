<div align="center">

<img src="extension/icons/128.png" width="88" alt="Agent Reveal">

# Agent Reveal

**Turn any finished web page into a "swarm of AI agents building it" demo — and record it to MP4 automatically.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/AXBIAO/agent-reveal/actions/workflows/ci.yml/badge.svg)](https://github.com/AXBIAO/agent-reveal/actions/workflows/ci.yml)
![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)

[简体中文](README.md) · English

</div>

<p align="center">
  <img src="docs/demo-typing.gif" width="49%" alt="Marquee selection and human-like typing">
  <img src="docs/demo-swarm.gif" width="49%" alt="Many agents building the page at once">
</p>

The page itself is never modified: the script hides its elements, then 3 → 26 colored cursors rebuild it piece by piece like a swarm. When it finishes (or you press <kbd>Esc</kbd>) the page is restored exactly. Great for product promos, launch demos and short-video material.

## Features

- **Swarm of cursors** — the crowd grows over time; each cursor flies to a corner, presses, drags a marquee to the opposite corner (live size label), releases, and the content appears inside the box
- **Only working cursors are visible** — idle cursors fade out instead of floating around
- **Human-like typing** — headings get typos (repeated, swapped or wrong characters), a pause, backspaces, then the correct text; a blinking caret; big headings start small and step up in size
- **Design-tool look** — selection handles, `W × H` labels and red spacing measurements; rulers slide in only while a guide is being pulled, so they never cover the page
- **Duplicates** — repeated components (nav chips, card grids, list rows) are detected; the first is built, the rest are <kbd>⌥</kbd>-dragged out as copies with spacing measurements, then their text is retyped
- **Pen-tool lines** — dividers, single-side borders and `<hr>` are drawn with a pen: click an anchor, rubber-band to the end, click again
- **Guides from the real layout** — left-aligned or top-aligned groups get a guide that a cursor drags out of the ruler; the aligned elements then snap to it
- **Wireframe placeholders** — images and blocks appear as grey placeholders (images with a diagonal ✕) before the real content arrives; images sweep in top to bottom; cursors switch between arrow, crosshair and I-beam
- **Synthesized sound** — mostly clicky: mouse presses, a mechanical keyboard and guide snaps, with only an occasional quiet mallet note for big blocks and images (on a beat grid, at most one or two per second); recorded into the video in sync (about ±30 ms)
- **Intro & finale** — the page dissolves top-down into a blank canvas under a scan beam, and ends on a chord
- **Clean MP4 recording** — WebCodecs H.264 + [mp4-muxer](https://github.com/Vanilagy/mp4-muxer); plays everywhere ([why not MediaRecorder?](#why-not-mediarecorder-for-mp4))
- **Desktop / mobile view** — mobile view switches the page to a 390×844 phone layout and records a portrait video ([details](#mobile-view))
- **Shows where the file is** — the extension displays the real saved path, with *Show in folder* / *Open*
- **Exact restore** — original `style` attributes are written back byte for byte
- **Two ways to use it** — Chrome extension (recommended) or a zero-install bookmarklet

## Quick start

### Option 1 — Chrome extension (recommended, no Node.js needed)

1. Download `agent-reveal-extension-v*.zip` from [Releases](https://github.com/AXBIAO/agent-reveal/releases/latest) and unzip it to a **permanent folder**
2. Open `chrome://extensions` and turn on **Developer mode** (top right)
3. Click **Load unpacked** and select the unzipped folder (the one containing `manifest.json`)
4. Pin **Agent Reveal** from the puzzle-piece menu 🧩

> Works in Edge too via `edge://extensions`.

### Option 2 — Build from source

Requires [Node.js](https://nodejs.org/) 20+.

```bash
git clone https://github.com/AXBIAO/agent-reveal.git
cd agent-reveal
npm install
npm run build
```

Then follow steps 2–4 above and select the repo's `extension/` folder.

### Option 3 — Bookmarklet (nothing to install)

1. Download `install.html` from [Releases](https://github.com/AXBIAO/agent-reveal/releases/latest) and open it in Chrome (or open `dist/install.html` after building)
2. Show the bookmarks bar (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>) and **drag** the "▶ Agent Reveal" button onto it
3. Open any website and click the bookmark

With the bookmarklet, Chrome asks you to share the tab before recording starts, and the video goes to your default downloads folder.

## Usage

1. Open the page you want to demo and **wait until it has fully loaded**
2. Click the Agent Reveal toolbar icon, adjust the settings, press **▶ Start**
3. Don't interact with the page while it runs; press <kbd>Esc</kbd> to stop (the recording is discarded)
4. When it finishes, a panel shows the full path of the saved video

Shortcut: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> starts with your last settings (change it at `chrome://extensions/shortcuts`).

| Setting | Default | Description |
| --- | --- | --- |
| View | Desktop | **Desktop**: play and record at the current window size; **Mobile**: 390×844 phone layout, portrait video |
| Auto record | on | Records the current tab (with sound) and saves an MP4 at the end |
| Sound | on | Mouse, keyboard and placement sounds; mute from the status bar or press <kbd>M</kbd> |
| Rulers & guides | on | Guides (rulers slide in while pulling) and spacing redlines |
| Auto scroll | on | When off, only the current screen is built; scroll down yourself and the swarm follows |
| Max cursors | 26 | Maximum number of cursors at the same time (4–40) |
| Speed | 1.0× | **Higher is faster** (0.5×–2.0×); raise it for long pages |
| Show agent names | off | Shows `Agent 1`, `Agent 2`… next to each cursor |

Recordings are saved to `<Downloads>/agent-reveal/agent-reveal-<host>-<date>-<time>.mp4`. Only the page content is recorded (no address bar or tabs), at the page's real pixel size.

**Tips:** close DevTools and cookie banners before starting.

## Mobile view

Choose **📱 Mobile** in the popup. The extension then:

1. Temporarily shrinks the current window to phone proportions and raises this tab's zoom so the page viewport is exactly **390×844** — responsive sites switch to their mobile layout
2. Picks the largest zoom that fits your screen for a sharper portrait video (e.g. about 620×1342 on a 2560×1440 screen)
3. Restores the window size, position, maximized state and zoom when it finishes or you press <kbd>Esc</kbd>

Notes: it switches layouts by viewport width, so sites that redirect to a separate mobile site based on the user agent (e.g. `m.example.com`) won't switch. Zoom applies to this tab only. On short screens the window extends below the screen edge to keep the phone height; that part is still recorded. The bookmarklet doesn't support mobile view — use DevTools device mode (<kbd>F12</kbd> → <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>) instead.

## Bookmarklet options

Set `window.AGENT_REVEAL_CONFIG` in the console before clicking the bookmark:

```js
window.AGENT_REVEAL_CONFIG = {
  maxAgents: 26, startAgents: 3, rampRatio: 0.2, durationMs: 30000,
  speed: 1, // higher is faster (0.5–2)
  showNames: false, record: true,
  rulers: true, duplicates: true, sound: true, autoScroll: true, intro: true,
};
```

## How it works

1. **Collect layers** — walk the DOM, collect text, images, controls and visible blocks as "layers", sort them top to bottom and hide them
2. **Swarm scheduling** — only layers already in the viewport are handed to idle cursors, so every cursor on screen is busy; the page auto-scrolls as the build front advances
3. **Marquee & reveal** — cursors drag a box, content appears inside on release; text is played from a typing script (typos, pauses, backspaces) without layout jumps
4. **Restore** — remove only the inline styles the script added, then write the original `style` string back if nothing else changed
5. **Recording** — tab capture → `MediaStreamTrackProcessor` → `VideoEncoder` (H.264) → `mp4-muxer`, at a fixed resolution with frame dropping under back-pressure

### Why not MediaRecorder for MP4

In our tests Chrome's `MediaRecorder` MP4 output has broken H.264 slices: ffmpeg reports 100+ decode errors per 6 seconds with heavy visual corruption, both headed and headless and independent of the page. WebCodecs + mp4-muxer produced zero errors under the same conditions. We fall back to `MediaRecorder` WebM only when WebCodecs is unavailable.

## FAQ

- **"This page can't run"** — `chrome://` pages and the Web Store block extensions; use a normal website.
- **The page doesn't scroll** — sites that scroll an inner container (instead of the window) aren't supported yet.
- **Some content just pops in** — content inserted after start (lazy-loaded lists) isn't collected; scroll through the page once before starting.
- **Permissions** — only `activeTab` (access to the current tab when you click the icon or use the shortcut), plus `tabCapture`/`offscreen` for recording, `downloads` to save and locate the video, and `storage` for settings.

## Development

```bash
npm run build      # bookmarklet (dist/) + extension scripts (extension/)
npm run test:unit  # unit tests
npm run test:sync  # A/V sync: flash + click recorded together, must stay within ±60 ms
npm run test:e2e   # bookmarklet E2E (playback, restore, Esc, decodable recording)
npm run test:ext   # extension E2E (tabCapture recording, real-path panel, Esc)
npm test           # everything
```

E2E runs against `https://eye.zsf.si` by default; use `--url` to change it. The extension E2E uses Playwright's Chromium (`npx playwright install chromium`) because branded Chrome 137+ no longer loads unpacked extensions from the command line. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

Design ideas come from Joel Califa's [Swarm](https://califa.github.io/swarm-site/) site and Dhvanil Patel's [Swarm Rebuild](https://github.com/DhvanilPatel/swarm-cursors) extension: crosshair-drawn boxes, ruler guides, wireframe placeholders and mostly-clicky sound. Neither is published under a license, so **no code from them is used here**, and the approach differs: they snapshot the page into a blueprint and redraw it on a canvas, while Agent Reveal reveals the real DOM elements in place, and adds auto scroll, mobile view and MP4 recording with sound.

## License

[MIT](LICENSE) © 2026 AXBIAO · Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
