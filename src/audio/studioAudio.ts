// Web Audio API Synthesizer, WAV Encoder, and Multi-Track DSP Utilities

export type DrumPadId =
  | 'kick808'
  | 'snare'
  | 'clap'
  | 'hihatClosed'
  | 'hihatOpen'
  | 'logDrum'
  | 'rimshot'
  | 'shaker'
  | 'subBass'
  | 'rhodesC'
  | 'rhodesF'
  | 'rhodesG'
  | 'pluck'
  | 'brass'
  | 'airhorn'
  | 'scratch';

export interface DrumPadConfig {
  id: DrumPadId;
  label: string;
  keyBind: string;
  category: 'drums' | 'melodic' | 'fx';
}

export const DRUM_PADS: DrumPadConfig[] = [
  { id: 'kick808', label: '808 Kick', keyBind: '1', category: 'drums' },
  { id: 'snare', label: 'Snare', keyBind: '2', category: 'drums' },
  { id: 'clap', label: 'Studio Clap', keyBind: '3', category: 'drums' },
  { id: 'hihatClosed', label: 'Closed Hat', keyBind: '4', category: 'drums' },
  { id: 'hihatOpen', label: 'Open Hat', keyBind: 'Q', category: 'drums' },
  { id: 'logDrum', label: 'Afro Log', keyBind: 'W', category: 'drums' },
  { id: 'rimshot', label: 'Rimshot', keyBind: 'E', category: 'drums' },
  { id: 'shaker', label: 'Shaker', keyBind: 'R', category: 'drums' },
  { id: 'subBass', label: 'Sub Bass', keyBind: 'A', category: 'melodic' },
  { id: 'rhodesC', label: 'Chord Am7', keyBind: 'S', category: 'melodic' },
  { id: 'rhodesF', label: 'Chord Fmaj7', keyBind: 'D', category: 'melodic' },
  { id: 'rhodesG', label: 'Chord G6', keyBind: 'F', category: 'melodic' },
  { id: 'pluck', label: 'Afro Pluck', keyBind: 'Z', category: 'melodic' },
  { id: 'brass', label: 'Brass Stab', keyBind: 'X', category: 'melodic' },
  { id: 'airhorn', label: 'DJ Horn', keyBind: 'C', category: 'fx' },
  { id: 'scratch', label: 'Vinyl Cut', keyBind: 'V', category: 'fx' },
];

let sharedCtx: AudioContext | null = null;
let sharedAnalyser: AnalyserNode | null = null;
let sharedMasterBus: GainNode | null = null;
const connectedMediaElements = new WeakSet<HTMLMediaElement>();

export function getAudioContext(): AudioContext {
  if (!sharedCtx) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedCtx = new AudioCtx();
  }
  if (sharedCtx.state === 'suspended') {
    sharedCtx.resume().catch(() => {});
  }
  return sharedCtx;
}

export function getStudioMasterNode(ctx?: AudioContext): AudioNode {
  const activeCtx = ctx || getAudioContext();
  if (activeCtx !== sharedCtx) {
    return activeCtx.destination;
  }
  if (!sharedMasterBus || !sharedAnalyser) {
    sharedMasterBus = activeCtx.createGain();
    sharedMasterBus.gain.value = 1.0;
    sharedAnalyser = activeCtx.createAnalyser();
    sharedAnalyser.fftSize = 128;
    sharedAnalyser.smoothingTimeConstant = 0.78;
    sharedMasterBus.connect(sharedAnalyser);
    sharedAnalyser.connect(activeCtx.destination);
  }
  return sharedMasterBus;
}

export function getStudioAnalyser(): AnalyserNode | null {
  if (!sharedCtx) return null;
  getStudioMasterNode(sharedCtx);
  return sharedAnalyser;
}

export function attachMediaElementToAnalyser(el: HTMLMediaElement | null): void {
  if (!el || connectedMediaElements.has(el)) return;
  try {
    const ctx = getAudioContext();
    const src = ctx.createMediaElementSource(el);
    src.connect(getStudioMasterNode(ctx));
    connectedMediaElements.add(el);
  } catch {
    // MediaElementAudioSource already attached or unavailable
  }
}

export function triggerSynthPad(
  ctx: BaseAudioContext,
  destination: AudioNode,
  padId: DrumPadId,
  when = ctx.currentTime,
  gainAmount = 0.85
): void {
  const master = ctx.createGain();
  master.gain.setValueAtTime(gainAmount, when);
  master.connect(destination);

  switch (padId) {
    case 'kick808': {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(145, when);
      osc.frequency.exponentialRampToValueAtTime(42, when + 0.14);
      osc.frequency.exponentialRampToValueAtTime(34, when + 0.45);
      gain.gain.setValueAtTime(1.0, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.48);
      osc.connect(gain).connect(master);
      osc.start(when);
      osc.stop(when + 0.5);
      break;
    }
    case 'snare': {
      const noiseBuf = createNoiseBuffer(ctx, 0.22);
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(900, when);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.7, when);
      nGain.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
      noise.connect(filter).connect(nGain).connect(master);
      noise.start(when);

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(210, when);
      osc.frequency.exponentialRampToValueAtTime(110, when + 0.08);
      const oGain = ctx.createGain();
      oGain.gain.setValueAtTime(0.55, when);
      oGain.gain.exponentialRampToValueAtTime(0.001, when + 0.11);
      osc.connect(oGain).connect(master);
      osc.start(when);
      osc.stop(when + 0.12);
      break;
    }
    case 'clap': {
      [0, 0.012, 0.025].forEach((offset, idx) => {
        const noise = ctx.createBufferSource();
        noise.buffer = createNoiseBuffer(ctx, 0.16);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1350, when + offset);
        bp.Q.setValueAtTime(1.4, when + offset);
        const g = ctx.createGain();
        g.gain.setValueAtTime(idx === 2 ? 0.65 : 0.4, when + offset);
        g.gain.exponentialRampToValueAtTime(0.001, when + offset + (idx === 2 ? 0.16 : 0.04));
        noise.connect(bp).connect(g).connect(master);
        noise.start(when + offset);
      });
      break;
    }
    case 'hihatClosed': {
      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx, 0.07);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(6500, when);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.45, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.055);
      noise.connect(hp).connect(g).connect(master);
      noise.start(when);
      break;
    }
    case 'hihatOpen': {
      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx, 0.35);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(5800, when);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.45, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
      noise.connect(hp).connect(g).connect(master);
      noise.start(when);
      break;
    }
    case 'logDrum': {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, when);
      osc.frequency.exponentialRampToValueAtTime(76, when + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.95, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.24);
      osc.connect(g).connect(master);
      osc.start(when);
      osc.stop(when + 0.26);
      break;
    }
    case 'rimshot': {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(480, when);
      osc.frequency.exponentialRampToValueAtTime(290, when + 0.03);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1600, when);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.55, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.045);
      osc.connect(bp).connect(g).connect(master);
      osc.start(when);
      osc.stop(when + 0.05);
      break;
    }
    case 'shaker': {
      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx, 0.09);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(7500, when);
      bp.Q.setValueAtTime(2.0, when);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.02, when);
      g.gain.linearRampToValueAtTime(0.35, when + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.085);
      noise.connect(bp).connect(g).connect(master);
      noise.start(when);
      break;
    }
    case 'subBass': {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(55, when);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(180, when);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.55);
      osc.connect(lp).connect(g).connect(master);
      osc.start(when);
      osc.stop(when + 0.58);
      break;
    }
    case 'rhodesC':
    case 'rhodesF':
    case 'rhodesG': {
      const chordMap = {
        rhodesC: [220, 261.63, 329.63, 392.0],
        rhodesF: [174.61, 220, 261.63, 329.63],
        rhodesG: [196.0, 246.94, 293.66, 329.63],
      };
      const notes = chordMap[padId];
      notes.forEach((freq) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, when);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.22, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.7);
        osc.connect(g).connect(master);
        osc.start(when);
        osc.stop(when + 0.72);
      });
      break;
    }
    case 'pluck': {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, when);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2800, when);
      lp.frequency.exponentialRampToValueAtTime(380, when + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.4, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.22);
      osc.connect(lp).connect(g).connect(master);
      osc.start(when);
      osc.stop(when + 0.24);
      break;
    }
    case 'brass': {
      [110, 164.81, 220].forEach((freq) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, when);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1400, when);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.25, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.38);
        osc.connect(lp).connect(g).connect(master);
        osc.start(when);
        osc.stop(when + 0.4);
      });
      break;
    }
    case 'airhorn': {
      [349.23, 440, 523.25].forEach((freq) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, when);
        osc.frequency.linearRampToValueAtTime(freq * 0.96, when + 0.45);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.22, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.5);
        osc.connect(g).connect(master);
        osc.start(when);
        osc.stop(when + 0.52);
      });
      break;
    }
    case 'scratch': {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(620, when);
      osc.frequency.exponentialRampToValueAtTime(140, when + 0.08);
      osc.frequency.exponentialRampToValueAtTime(510, when + 0.16);
      osc.frequency.exponentialRampToValueAtTime(90, when + 0.24);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1100, when);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.55, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.25);
      osc.connect(bp).connect(g).connect(master);
      osc.start(when);
      osc.stop(when + 0.26);
      break;
    }
  }
}

export function createNoiseBuffer(ctx: BaseAudioContext, durationSec: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export function triggerBufferPad(
  ctx: BaseAudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  when = ctx.currentTime,
  gainAmount = 0.85,
  maxDurationSec = 2.2
): void {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  const playDur = Math.min(buffer.duration, maxDurationSec);
  gain.gain.setValueAtTime(0.001, when);
  gain.gain.linearRampToValueAtTime(gainAmount, when + 0.006);
  if (playDur > 0.06) {
    gain.gain.setValueAtTime(gainAmount, when + playDur - 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, when + playDur);
  }
  src.connect(gain).connect(destination);
  src.start(when, 0, playDur);
}

// Render 16-step beat pattern into an AudioBuffer for WAV export or DAW import
export async function renderPatternToBuffer(
  pattern: Record<string, boolean[]>,
  bpm: number,
  bars = 2,
  customPadBuffers?: Partial<Record<DrumPadId, AudioBuffer>>
): Promise<AudioBuffer> {
  const stepSec = 60 / bpm / 4;
  const totalSteps = 16 * bars;
  const durationSec = totalSteps * stepSec + 0.5;
  const sampleRate = 44100;
  const offline = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);

  for (let step = 0; step < totalSteps; step++) {
    const stepIdx = step % 16;
    const time = step * stepSec;
    for (const [padId, steps] of Object.entries(pattern)) {
      if (steps[stepIdx]) {
        const customBuf = customPadBuffers?.[padId as DrumPadId];
        if (customBuf) {
          triggerBufferPad(offline, offline.destination, customBuf, time, 0.78, 1.8);
        } else {
          triggerSynthPad(offline, offline.destination, padId as DrumPadId, time, 0.78);
        }
      }
    }
  }
  return offline.startRendering();
}

// Generate a synthetic full groove AudioBuffer for Virtual DJ / Discover / DAW demos
export async function renderGrooveBuffer(
  style: 'afro' | 'house' | 'trap',
  bpm: number,
  bars = 4
): Promise<AudioBuffer> {
  const patterns: Record<'afro' | 'house' | 'trap', Record<string, boolean[]>> = {
    afro: {
      kick808: [true, false, false, false, false, false, true, false, false, false, true, false, false, false, false, false],
      logDrum: [false, false, false, true, false, false, false, false, false, false, false, true, false, true, false, false],
      rimshot: [false, false, true, false, false, true, false, false, false, false, true, false, false, true, false, false],
      shaker: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
      rhodesC: [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      rhodesF: [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
    },
    house: {
      kick808: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihatOpen: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
      subBass: [true, false, false, true, false, false, true, false, true, false, false, true, false, false, true, false],
      rhodesG: [true, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false],
    },
    trap: {
      kick808: [true, false, false, false, false, false, false, true, false, false, true, false, false, false, false, false],
      snare: [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      hihatClosed: [true, true, true, true, true, false, true, true, true, true, true, true, true, true, true, false],
      subBass: [true, false, false, false, false, false, false, true, false, false, true, false, false, false, false, false],
      pluck: [true, false, false, true, false, false, true, false, false, false, true, false, true, false, false, false],
    },
  };
  return renderPatternToBuffer(patterns[style], bpm, bars);
}

// Extract a tight pad-ready AudioBuffer slice from any source AudioBuffer
export async function sliceAudioBuffer(
  source: AudioBuffer,
  startSec = 0,
  durationSec = 1.5
): Promise<AudioBuffer> {
  const safeStart = Math.max(0, Math.min(Math.max(0, source.duration - 0.1), startSec));
  const safeDur = Math.max(0.15, Math.min(durationSec, source.duration - safeStart));
  const sampleRate = source.sampleRate;
  const offline = new OfflineAudioContext(
    Math.min(2, source.numberOfChannels),
    Math.max(1, Math.ceil(safeDur * sampleRate)),
    sampleRate
  );
  const src = offline.createBufferSource();
  src.buffer = source;
  const gain = offline.createGain();
  gain.gain.setValueAtTime(0.001, 0);
  gain.gain.linearRampToValueAtTime(1.0, 0.008);
  if (safeDur > 0.06) {
    gain.gain.setValueAtTime(1.0, safeDur - 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, safeDur);
  }
  src.connect(gain).connect(offline.destination);
  src.start(0, safeStart, safeDur);
  return offline.startRendering();
}

export async function renderDiscoverSampleSlice(
  style: 'afro' | 'house' | 'trap',
  bpm: number,
  startSec = 0,
  durationSec = 1.5
): Promise<AudioBuffer> {
  const full = await renderGrooveBuffer(style, bpm, 2);
  return sliceAudioBuffer(full, startSec, durationSec);
}

// Compact 22050Hz mono 16-bit WAV base64 encoder (~88KB for 2s) for Firestore persistence
export async function encodeAudioBufferSliceToBase64Wav(
  source: AudioBuffer,
  startSec = 0,
  maxDurationSec = 1.8
): Promise<string> {
  const targetRate = 22050;
  const safeStart = Math.max(0, Math.min(Math.max(0, source.duration - 0.1), startSec));
  const safeDur = Math.max(0.15, Math.min(maxDurationSec, source.duration - safeStart));
  const frameCount = Math.max(1, Math.floor(safeDur * targetRate));
  const offline = new OfflineAudioContext(1, frameCount, targetRate);
  const src = offline.createBufferSource();
  src.buffer = source;
  const gain = offline.createGain();
  gain.gain.setValueAtTime(0.001, 0);
  gain.gain.linearRampToValueAtTime(1.0, 0.008);
  if (safeDur > 0.06) {
    gain.gain.setValueAtTime(1.0, safeDur - 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, safeDur);
  }
  src.connect(gain).connect(offline.destination);
  src.start(0, safeStart, safeDur);
  const resampled = await offline.startRendering();

  const wavBlob = audioBufferToWavBlob(resampled);
  const bytes = new Uint8Array(await wavBlob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function decodeBase64WavToBuffer(
  ctx: BaseAudioContext,
  base64: string
): Promise<AudioBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return ctx.decodeAudioData(bytes.buffer.slice(0));
}

// Convert AudioBuffer -> standard 16-bit PCM WAV Blob
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numChannels * 2;
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, length, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Analyze vocal AudioBuffer for peak onset timestamps (used by Voice Alignment AI)
export function detectVocalOnsetsMs(buffer: AudioBuffer): number[] {
  const channel = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.floor(sampleRate * 0.04); // 40ms frames
  const onsets: number[] = [];
  let prevRms = 0;

  for (let i = 0; i < channel.length; i += windowSize) {
    let sum = 0;
    const end = Math.min(i + windowSize, channel.length);
    for (let j = i; j < end; j++) {
      sum += channel[j] * channel[j];
    }
    const rms = Math.sqrt(sum / Math.max(1, end - i));
    if (rms > 0.04 && rms > prevRms * 1.45) {
      const ms = Math.round((i / sampleRate) * 1000);
      if (onsets.length === 0 || ms - onsets[onsets.length - 1] > 180) {
        onsets.push(ms);
      }
    }
    prevRms = rms * 0.7 + prevRms * 0.3;
    if (onsets.length >= 24) break;
  }
  return onsets;
}

export type BeatSignature = '2/4' | '3/4' | '4/4' | '5/4' | '6/8';

export const BEAT_SIGNATURE_CONFIG: Record<
  BeatSignature,
  { beatsPerMeasure: number; subdivisionFactor: number; label: string }
> = {
  '2/4': { beatsPerMeasure: 2, subdivisionFactor: 1, label: '2/4' },
  '3/4': { beatsPerMeasure: 3, subdivisionFactor: 1, label: '3/4' },
  '4/4': { beatsPerMeasure: 4, subdivisionFactor: 1, label: '4/4' },
  '5/4': { beatsPerMeasure: 5, subdivisionFactor: 1, label: '5/4' },
  '6/8': { beatsPerMeasure: 6, subdivisionFactor: 0.5, label: '6/8' },
};

export function triggerMetronomeClick(
  ctx: BaseAudioContext,
  destination: AudioNode,
  when: number,
  isDownbeat: boolean,
  gainAmount = 0.55
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = isDownbeat ? 'triangle' : 'sine';
  const startFreq = isDownbeat ? 1760 : 840;
  const endFreq = isDownbeat ? 1180 : 600;
  const duration = isDownbeat ? 0.056 : 0.032;
  const peakGain = isDownbeat ? Math.min(1, gainAmount * 1.45) : gainAmount * 0.65;

  osc.frequency.setValueAtTime(startFreq, when);
  osc.frequency.exponentialRampToValueAtTime(endFreq, when + duration);

  gain.gain.setValueAtTime(0.001, when);
  gain.gain.linearRampToValueAtTime(peakGain, when + 0.0025);
  gain.gain.exponentialRampToValueAtTime(0.001, when + duration);

  osc.connect(gain).connect(destination);
  osc.start(when);
  osc.stop(when + duration + 0.005);

  // Distinct upper harmonic chime on beat 1 of the measure
  if (isDownbeat) {
    const overtone = ctx.createOscillator();
    const overtoneGain = ctx.createGain();
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(3520, when);
    overtone.frequency.exponentialRampToValueAtTime(2400, when + 0.042);
    overtoneGain.gain.setValueAtTime(0.001, when);
    overtoneGain.gain.linearRampToValueAtTime(peakGain * 0.35, when + 0.002);
    overtoneGain.gain.exponentialRampToValueAtTime(0.001, when + 0.045);
    overtone.connect(overtoneGain).connect(destination);
    overtone.start(when);
    overtone.stop(when + 0.05);
  }
}
