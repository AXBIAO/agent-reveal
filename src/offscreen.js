// 扩展离屏文档：录屏（tabCapture streamId → mp4-recorder）+ 音效合成
// 音效放在这里而不是网页里：扩展页面不受网页自动播放限制；录屏时把合成器音轨直接混进去。
// 构建时打包为 extension/offscreen.js
import { createRecorder } from './mp4-recorder.js';
import { SoundEngine } from './sound.js';

let session = null; // createRecorder 返回值
let engine = null;

function getEngine() {
  if (!engine) engine = new SoundEngine().init();
  engine.resume();
  return engine;
}

// size：标签页实际像素尺寸。min=max 固定分辨率，避免 Chrome 缩放加黑边
async function startRec(streamId, size, withSound) {
  if (session) throw new Error('已有录制在进行，请等它结束');
  const { width, height } = size || { width: 1920, height: 1080 };
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: {
      chromeMediaSource: 'tab', chromeMediaSourceId: streamId,
      minWidth: width, maxWidth: width, minHeight: height, maxHeight: height, maxFrameRate: 60,
    } },
  });
  const audio = withSound ? getEngine().createTrack() : null;
  session = createRecorder(new MediaStream([...stream.getVideoTracks(), ...(audio ? [audio] : [])]));
  return { mime: session.mime, audio: Boolean(audio) };
}

async function stopRec() {
  if (!session) throw new Error('没有正在进行的录制');
  const s = session;
  session = null;
  const blob = await s.stop();
  return { url: URL.createObjectURL(blob), mime: s.mime, size: blob.size };
}

function discardRec() {
  if (session) session.discard();
  session = null;
  return {};
}

function playSfx(m) {
  const e = getEngine();
  if (m.name === 'setOn') e.setOn(Boolean(m.args && m.args[0]));
  else e.play(m.name, m.args || []);
  return {};
}

const HANDLERS = {
  'rec-start': (m) => startRec(m.streamId, m.size, m.withSound),
  'rec-stop': () => stopRec(),
  'rec-discard': () => discardRec(),
  revoke: (m) => { URL.revokeObjectURL(m.url); return {}; },
  sfx: (m) => playSfx(m),
  'sound-state': () => ({ state: engine ? engine.state : 'none', stats: engine ? { ...engine.stats } : null }),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || !HANDLERS[msg.type]) return false;
  Promise.resolve()
    .then(() => HANDLERS[msg.type](msg))
    .then((r) => sendResponse({ ok: true, ...r }), (err) => sendResponse({ ok: false, error: err.message }));
  return true;
});
