// mp4 录屏的音轨：MediaStreamTrackProcessor 取 AudioData → WebCodecs 编码（AAC 优先，退回 Opus）→ mp4-muxer
//
// 时间轴：视频第一帧的采集时刻（换算到 performance.now）为零点；音频按"首段到达时刻 + 采样时间差"换算到同一时间轴。
// 三个实测踩过的坑：
// 1. 不能用原始时间戳跨轨道对齐：canvas 流的视频时间戳从 0 开始，音频却是页面性能时钟。
// 2. 必须从一开始就持续读取音频：不读的那段时间采集端会丢数据，但音频时间戳按采样数连续累加，
//    丢掉的部分不计入，之后的时间戳就会比真实时间落后（实测落后约 0.4 秒，声音整体提前）。
// 3. 音频比视频晚开始时要在开头补静音，否则 mp4-muxer 的 offset 模式会把音轨首个时间戳归零，整条音轨提前。

const FIRST_DATA_TIMEOUT_MS = 1500;
const SILENCE_CHUNK = 1024;        // 补静音时每段的采样数
const AUDIO_BUFFER_CHUNKS = 1000;  // 约 10 秒（每段约 10ms）
const BACKLOG_US = 2e6;            // 接上音轨前最多缓存 2 秒
// 不做额外补偿：实际使用的是标签页采集，画面要等页面合成后才采到，本身就比 WebAudio 晚约 50ms，
// 两者基本抵消，实测声音比画面晚约 20–50ms（人对声音偏晚很宽容，ITU-R BT.1359 约 125ms 才能察觉）。
// 若改用 canvas 采集（延迟更低），声音会偏早约 30–45ms。
const AUDIO_DELAY_US = 0;

const nowUs = () => performance.now() * 1000;

const AUDIO_CANDIDATES = [
  { codec: 'mp4a.40.2', mux: 'aac', bitrate: 160000 },
  { codec: 'opus', mux: 'opus', bitrate: 128000 },
];

async function pickAudioConfig(sampleRate, numberOfChannels) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const c of AUDIO_CANDIDATES) {
    const config = { codec: c.codec, sampleRate, numberOfChannels, bitrate: c.bitrate };
    try {
      const { supported } = await AudioEncoder.isConfigSupported(config);
      if (supported) return { config, mux: c.mux };
    } catch { /* 试下一个 */ }
  }
  return null;
}

/**
 * @param {MediaStreamTrack} track 音频轨
 * @returns {{ ready: Promise<null|{codec:string,sampleRate:number,numberOfChannels:number}>,
 *   attach(muxer: object, zeroUs: number): void, stop(): Promise<void>, discard(): void }}
 */
export function createAudioBranch(track) {
  // 大缓冲：录屏开始后收集图层会让主线程连续卡 1–2 秒，默认缓冲很小，溢出会丢音频、时间戳整体落后（实测提前 1.4 秒）
  const reader = new MediaStreamTrackProcessor({ track, maxBufferSize: AUDIO_BUFFER_CHUNKS }).readable.getReader();
  const s = { rawFirst: null, perfFirst: 0, picked: null, encoder: null, muxer: null, zeroUs: 0,
    backlog: [], pendingMeta: null, wroteFirst: false, error: null, stopped: false, done: false };
  let resolveFirst;
  const firstData = new Promise((r) => { resolveFirst = r; });

  // 原始时间戳 → 视频时间轴（微秒）
  const toTimeline = (raw) => raw - s.rawFirst + (s.perfFirst - s.zeroUs) + AUDIO_DELAY_US;

  function write(chunk, meta) {
    if (meta && meta.decoderConfig && !s.wroteFirst) s.pendingMeta = meta;
    const ts = toTimeline(chunk.timestamp);
    if (ts < 0) return;
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    const useMeta = s.wroteFirst ? meta : (meta && meta.decoderConfig ? meta : s.pendingMeta);
    s.muxer.addAudioChunkRaw(data, chunk.type, ts, chunk.duration || 0, useMeta || undefined);
    s.wroteFirst = true;
  }

  // 只丢视频零点之前的部分；音频编码开销很小，不因积压丢弃（丢了会断音）
  function encode(data) {
    const end = toTimeline(data.timestamp) + (data.duration || 0);
    if (end < 0) {
      data.close();
      return;
    }
    s.encoder.encode(data);
    data.close();
  }

  // 接上音轨前缓存，只保留最近 BACKLOG_US
  function keep(data) {
    s.backlog.push(data);
    while (s.backlog.length > 1 && data.timestamp - s.backlog[0].timestamp > BACKLOG_US) s.backlog.shift().close();
  }

  // 从构造起持续读取，一刻不停（见文件头第 2 条）
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (s.stopped) { value.close(); break; }
      if (s.rawFirst === null) {
        s.rawFirst = value.timestamp;
        s.perfFirst = nowUs();
        resolveFirst(value);
      }
      try {
        if (s.encoder) encode(value);
        else keep(value);
      } catch (err) {
        value.close();
        s.error = s.error || err;
        break;
      }
    }
    s.done = true;
  })();

  const ready = (async () => {
    const timeout = new Promise((r) => setTimeout(() => r(null), FIRST_DATA_TIMEOUT_MS));
    const first = await Promise.race([firstData, timeout]);
    if (!first) return null;
    s.picked = await pickAudioConfig(first.sampleRate, first.numberOfChannels);
    if (!s.picked) {
      s.stopped = true;
      reader.cancel().catch(() => {});
      return null;
    }
    return { codec: s.picked.mux, sampleRate: first.sampleRate, numberOfChannels: first.numberOfChannels };
  })();

  // 音频比视频晚开始时，在开头补静音到视频零点（见文件头第 3 条）
  function padSilence(firstRaw) {
    const zeroRaw = s.rawFirst - (s.perfFirst - s.zeroUs) - AUDIO_DELAY_US; // toTimeline(zeroRaw) = 0
    const gapUs = firstRaw - zeroRaw;
    if (gapUs <= 1000) return;
    const { sampleRate, numberOfChannels } = s.picked.config;
    let frames = Math.round((gapUs * sampleRate) / 1e6);
    let ts = zeroRaw;
    while (frames > 0) {
      const n = Math.min(SILENCE_CHUNK, frames);
      const data = new AudioData({
        format: 'f32-planar', sampleRate, numberOfChannels, numberOfFrames: n,
        timestamp: Math.round(ts), data: new Float32Array(n * numberOfChannels),
      });
      s.encoder.encode(data);
      data.close();
      frames -= n;
      ts += (n * 1e6) / sampleRate;
    }
  }

  /** @param {number} zeroUs 视频零点（第一帧采集时刻，performance.now 微秒） */
  function attach(muxer, zeroUs) {
    if (!s.picked || s.stopped || s.encoder) return;
    s.muxer = muxer;
    s.zeroUs = zeroUs;
    s.encoder = new AudioEncoder({
      output: (chunk, meta) => {
        try { write(chunk, meta); } catch (err) { s.error = s.error || err; }
      },
      error: (err) => { s.error = s.error || err; },
    });
    s.encoder.configure(s.picked.config);
    const backlog = s.backlog;
    s.backlog = [];
    const firstKept = backlog.find((d) => toTimeline(d.timestamp) + (d.duration || 0) >= 0);
    if (firstKept) padSilence(firstKept.timestamp);
    for (const d of backlog) encode(d);
  }

  async function stop() {
    // 先停音轨，让读取器把已经采到的数据读完再结束（直接 cancel 会丢掉结尾那一段）
    track.stop();
    await Promise.race([pump, new Promise((r) => setTimeout(r, 1500))]);
    s.stopped = true;
    await reader.cancel().catch(() => {});
    await pump;
    s.backlog.forEach((d) => d.close());
    s.backlog = [];
    if (s.encoder && s.encoder.state !== 'closed') {
      await s.encoder.flush();
      s.encoder.close();
    }
    if (s.error) throw s.error;
  }

  function discard() {
    s.stopped = true;
    reader.cancel().catch(() => {});
    s.backlog.forEach((d) => d.close());
    s.backlog = [];
    if (s.encoder && s.encoder.state !== 'closed') s.encoder.close();
  }

  return { ready, attach, stop, discard };
}
