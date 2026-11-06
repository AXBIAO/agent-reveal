// 把视频流录成标准 mp4：MediaStreamTrackProcessor 取帧 → WebCodecs H.264 编码 → mp4-muxer 封装
// 为什么不用 MediaRecorder 录 mp4：Chrome 的 MediaRecorder mp4 输出有 H.264 分片错误，解码会大面积花屏
// （实测 ffmpeg 每 6 秒上百个解码错误）；webm 正常，所以在不支持 WebCodecs 时退回 webm。
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

const MAX_WIDTH = 3840;
const KEYFRAME_EVERY_US = 2e6;   // 每 2 秒一个关键帧
const MAX_QUEUE = 24;            // 编码器积压超过这个数就丢帧，防止内存暴涨
const FALLBACK_FRAME_US = Math.round(1e6 / 30);
const MIN_GAP_US = 8000;         // 间隔 <8ms（>120fps）的帧是重复画面，丢掉，避免 mp4 时间刻度取整后时间戳重叠
const AVC_CODECS = ['avc1.640034', 'avc1.640033', 'avc1.64002A', 'avc1.4D0034', 'avc1.42E034'];
const WEBM_MIMES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

const even = (n) => Math.max(2, Math.floor(n / 2) * 2);

export const canEncodeMp4 = () => typeof window !== 'undefined'
  && 'VideoEncoder' in window && 'MediaStreamTrackProcessor' in window;

// 按分辨率估算码率：约每像素 2.5 bit/s，限制在 4–16 Mbps
export function pickBitrate(width, height) {
  return Math.round(Math.min(16e6, Math.max(4e6, width * height * 2.5)));
}

export function fitSize(width, height) {
  const scale = width > MAX_WIDTH ? MAX_WIDTH / width : 1;
  return { width: even(width * scale), height: even(height * scale) };
}

async function pickAvcConfig(width, height) {
  for (const codec of AVC_CODECS) {
    const config = {
      codec, width, height,
      bitrate: pickBitrate(width, height),
      framerate: 60,
      latencyMode: 'quality',
      avc: { format: 'avc' },
    };
    const { supported } = await VideoEncoder.isConfigSupported(config);
    if (supported) return config;
  }
  throw new Error('当前浏览器不支持 H.264 编码');
}

function createMp4Session(track) {
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  const state = { encoder: null, muxer: null, target: null, size: null, canvas: null, ctx: null,
    t0: null, lastKeyUs: -Infinity, prevUs: null, pending: null, error: null, stopped: false };

  // 帧尺寸与编码尺寸不一致时缩放到固定画布，保证整段视频分辨率不变
  function normalize(frame) {
    const { width, height } = state.size;
    if (frame.displayWidth === width && frame.displayHeight === height) return frame;
    if (!state.canvas) {
      state.canvas = new OffscreenCanvas(width, height);
      state.ctx = state.canvas.getContext('2d');
    }
    state.ctx.drawImage(frame, 0, 0, width, height);
    const scaled = new VideoFrame(state.canvas, { timestamp: frame.timestamp });
    frame.close();
    return scaled;
  }

  async function init(frame) {
    state.size = fitSize(frame.displayWidth, frame.displayHeight);
    const config = await pickAvcConfig(state.size.width, state.size.height);
    state.target = new ArrayBufferTarget();
    state.muxer = new Muxer({
      target: state.target,
      video: { codec: 'avc', width: state.size.width, height: state.size.height },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    state.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try { state.muxer.addVideoChunk(chunk, meta); } catch (err) { state.error = state.error || err; }
      },
      error: (err) => { state.error = state.error || err; },
    });
    state.encoder.configure(config);
  }

  // 采集帧没有 duration，mp4-muxer 要求每个分块都有；用相邻帧的时间差，延后一帧再编码
  function encodePending(nextUs) {
    const p = state.pending;
    if (!p) return;
    state.pending = null;
    const duration = nextUs !== null ? Math.max(1, nextUs - p.us) : FALLBACK_FRAME_US;
    if (state.encoder.encodeQueueSize > MAX_QUEUE) {
      p.frame.close();
      return;
    }
    const frame = new VideoFrame(p.frame, { timestamp: p.us, duration });
    p.frame.close();
    const keyFrame = p.us - state.lastKeyUs >= KEYFRAME_EVERY_US;
    if (keyFrame) state.lastKeyUs = p.us;
    state.encoder.encode(frame, { keyFrame });
    frame.close();
  }

  const pump = (async () => {
    for (;;) {
      const { value: frame, done } = await reader.read();
      if (done) break;
      if (state.stopped) { frame.close(); break; }
      try {
        if (!state.encoder) await init(frame);
        if (state.t0 === null) state.t0 = frame.timestamp;
        const us = Math.max(0, frame.timestamp - state.t0);
        if (state.prevUs !== null && us - state.prevUs < MIN_GAP_US) { frame.close(); continue; }
        encodePending(us);
        state.pending = { frame: normalize(frame), us };
        state.prevUs = us;
      } catch (err) {
        frame.close();
        state.error = state.error || err;
        break;
      }
    }
  })();

  async function stop() {
    state.stopped = true;
    await reader.cancel().catch(() => {});
    await pump;
    if (state.error) throw state.error;
    if (!state.encoder) throw new Error('没有录到任何画面');
    encodePending(null);
    await state.encoder.flush();
    state.encoder.close();
    state.muxer.finalize();
    if (state.error) throw state.error;
    return new Blob([state.target.buffer], { type: 'video/mp4' });
  }

  function discard() {
    state.stopped = true;
    reader.cancel().catch(() => {});
    if (state.pending) state.pending.frame.close();
    if (state.encoder && state.encoder.state !== 'closed') state.encoder.close();
  }

  return { mime: 'video/mp4', stop, discard };
}

function createWebmSession(stream) {
  const mime = WEBM_MIMES.find((t) => MediaRecorder.isTypeSupported(t)) || 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start(1000);
  return {
    mime,
    stop: () => new Promise((resolve) => {
      const done = () => resolve(new Blob(chunks, { type: mime }));
      if (rec.state === 'inactive') return done();
      rec.onstop = done;
      rec.stop();
    }),
    discard: () => { if (rec.state !== 'inactive') rec.stop(); },
  };
}

// 统一入口：优先 mp4（WebCodecs），否则 webm（MediaRecorder）。stop() 之后会停止流的所有轨道
export function createRecorder(stream) {
  const [track] = stream.getVideoTracks();
  if (track && 'contentHint' in track) track.contentHint = 'detail'; // 优先保清晰度，不降分辨率
  const session = canEncodeMp4() ? createMp4Session(track) : createWebmSession(stream);
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
  return {
    mime: session.mime,
    stop: async () => {
      try { return await session.stop(); } finally { stopTracks(); }
    },
    discard: () => { session.discard(); stopTracks(); },
  };
}
