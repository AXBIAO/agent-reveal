// 扩展离屏文档：用 tabCapture 的 streamId 取流，交给 mp4-recorder 录制
// （Service Worker 不能用媒体 API）。构建时打包为 extension/offscreen.js
import { createRecorder } from './mp4-recorder.js';

let session = null; // createRecorder 返回值

async function startRec(streamId) {
  if (session) throw new Error('已有录制在进行，请等它结束');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60 } },
  });
  session = createRecorder(stream);
  return { mime: session.mime };
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

const HANDLERS = {
  'rec-start': (m) => startRec(m.streamId),
  'rec-stop': () => stopRec(),
  'rec-discard': () => discardRec(),
  revoke: (m) => { URL.revokeObjectURL(m.url); return {}; },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || !HANDLERS[msg.type]) return false;
  Promise.resolve()
    .then(() => HANDLERS[msg.type](msg))
    .then((r) => sendResponse({ ok: true, ...r }), (err) => sendResponse({ ok: false, error: err.message }));
  return true;
});
