// Offline & Real-Time AudioBuffer DSP Operations for the Wavacity-Style Multitrack DAW

export function cloneAudioBuffer(ctx: BaseAudioContext, source: AudioBuffer): AudioBuffer {
  const copy = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    copy.getChannelData(ch).set(source.getChannelData(ch));
  }
  return copy;
}

export function extractBufferRange(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const sr = source.sampleRate;
  const startSample = Math.max(0, Math.min(source.length - 1, Math.floor(startSec * sr)));
  const endSample = Math.max(startSample + 1, Math.min(source.length, Math.floor(endSec * sr)));
  const len = endSample - startSample;
  const out = ctx.createBuffer(source.numberOfChannels, len, sr);
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    out.getChannelData(ch).set(source.getChannelData(ch).subarray(startSample, endSample));
  }
  return out;
}

export function deleteBufferRange(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer | null {
  const sr = source.sampleRate;
  const s0 = Math.max(0, Math.min(source.length, Math.floor(startSec * sr)));
  const s1 = Math.max(s0, Math.min(source.length, Math.floor(endSec * sr)));
  const cutLen = s1 - s0;
  if (cutLen <= 0) return cloneAudioBuffer(ctx, source);
  const newLen = source.length - cutLen;
  if (newLen < 64) return null;

  const out = ctx.createBuffer(source.numberOfChannels, newLen, sr);
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const src = source.getChannelData(ch);
    const dst = out.getChannelData(ch);
    if (s0 > 0) dst.set(src.subarray(0, s0), 0);
    if (s1 < source.length) dst.set(src.subarray(s1), s0);
  }
  return out;
}

export function trimBufferToRange(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  return extractBufferRange(ctx, source, startSec, endSec);
}

export function insertBufferAtSec(
  ctx: BaseAudioContext,
  target: AudioBuffer | null,
  clip: AudioBuffer,
  atSec: number
): AudioBuffer {
  if (!target) return cloneAudioBuffer(ctx, clip);
  const sr = target.sampleRate;
  const pos = Math.max(0, Math.min(target.length, Math.floor(atSec * sr)));
  const channels = Math.max(target.numberOfChannels, clip.numberOfChannels);
  const newLen = target.length + clip.length;
  const out = ctx.createBuffer(channels, newLen, sr);

  for (let ch = 0; ch < channels; ch++) {
    const tData = target.getChannelData(Math.min(ch, target.numberOfChannels - 1));
    const cData = clip.getChannelData(Math.min(ch, clip.numberOfChannels - 1));
    const dst = out.getChannelData(ch);
    if (pos > 0) dst.set(tData.subarray(0, pos), 0);
    dst.set(cData, pos);
    if (pos < target.length) dst.set(tData.subarray(pos), pos + clip.length);
  }
  return out;
}

export function silenceBufferRange(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const out = cloneAudioBuffer(ctx, source);
  const sr = out.sampleRate;
  const s0 = Math.max(0, Math.floor(startSec * sr));
  const s1 = Math.min(out.length, Math.floor(endSec * sr));
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    out.getChannelData(ch).fill(0, s0, s1);
  }
  return out;
}

export function applyFadeRange(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  startSec: number,
  endSec: number,
  direction: 'in' | 'out'
): AudioBuffer {
  const out = cloneAudioBuffer(ctx, source);
  const sr = out.sampleRate;
  const s0 = Math.max(0, Math.floor(startSec * sr));
  const s1 = Math.min(out.length, Math.floor(endSec * sr));
  const len = Math.max(1, s1 - s0);
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const data = out.getChannelData(ch);
    for (let i = s0; i < s1; i++) {
      const progress = (i - s0) / len;
      const factor = direction === 'in' ? progress : 1 - progress;
      data[i] *= factor;
    }
  }
  return out;
}

export function applyReverseRange(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const out = cloneAudioBuffer(ctx, source);
  const sr = out.sampleRate;
  const s0 = Math.max(0, Math.floor(startSec * sr));
  const s1 = Math.min(out.length, Math.floor(endSec * sr));
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const data = out.getChannelData(ch);
    let left = s0;
    let right = s1 - 1;
    while (left < right) {
      const tmp = data[left];
      data[left] = data[right];
      data[right] = tmp;
      left++;
      right--;
    }
  }
  return out;
}

export function applyInvertRange(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const out = cloneAudioBuffer(ctx, source);
  const sr = out.sampleRate;
  const s0 = Math.max(0, Math.floor(startSec * sr));
  const s1 = Math.min(out.length, Math.floor(endSec * sr));
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const data = out.getChannelData(ch);
    for (let i = s0; i < s1; i++) {
      data[i] = -data[i];
    }
  }
  return out;
}

export function applyNormalizeOrAmplify(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  startSec: number,
  endSec: number,
  mode: 'normalize' | 'amplify',
  gainDb = 3
): AudioBuffer {
  const out = cloneAudioBuffer(ctx, source);
  const sr = out.sampleRate;
  const s0 = Math.max(0, Math.floor(startSec * sr));
  const s1 = Math.min(out.length, Math.floor(endSec * sr));

  let multiplier = Math.pow(10, gainDb / 20);
  if (mode === 'normalize') {
    let maxPeak = 0;
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      const data = out.getChannelData(ch);
      for (let i = s0; i < s1; i++) {
        const v = Math.abs(data[i]);
        if (v > maxPeak) maxPeak = v;
      }
    }
    const targetPeak = Math.pow(10, -1 / 20); // -1 dBFS ceiling
    multiplier = maxPeak > 0.0001 ? targetPeak / maxPeak : 1;
  }

  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const data = out.getChannelData(ch);
    for (let i = s0; i < s1; i++) {
      data[i] = Math.max(-1, Math.min(1, data[i] * multiplier));
    }
  }
  return out;
}

export async function applyEchoToRange(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  startSec: number,
  endSec: number,
  delaySec = 0.26,
  feedback = 0.35
): Promise<AudioBuffer> {
  const out = cloneAudioBuffer(ctx, source);
  const sr = out.sampleRate;
  const s0 = Math.max(0, Math.floor(startSec * sr));
  const s1 = Math.min(out.length, Math.floor(endSec * sr));
  const sliceLen = s1 - s0;
  if (sliceLen <= 0) return out;

  const offline = new OfflineAudioContext(out.numberOfChannels, sliceLen, sr);
  const srcBuf = offline.createBuffer(out.numberOfChannels, sliceLen, sr);
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    srcBuf.getChannelData(ch).set(out.getChannelData(ch).subarray(s0, s1));
  }

  const srcNode = offline.createBufferSource();
  srcNode.buffer = srcBuf;
  const delayNode = offline.createDelay(1.0);
  delayNode.delayTime.value = delaySec;
  const fbGain = offline.createGain();
  fbGain.gain.value = feedback;

  srcNode.connect(offline.destination);
  srcNode.connect(delayNode);
  delayNode.connect(fbGain);
  fbGain.connect(delayNode);
  delayNode.connect(offline.destination);

  srcNode.start(0);
  const processed = await offline.startRendering();
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const dst = out.getChannelData(ch);
    const pData = processed.getChannelData(ch);
    for (let i = 0; i < sliceLen; i++) {
      dst[s0 + i] = Math.max(-1, Math.min(1, pData[i]));
    }
  }
  return out;
}

export async function applyEqToRange(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  startSec: number,
  endSec: number,
  filterType: BiquadFilterType,
  frequency: number,
  gainDb: number
): Promise<AudioBuffer> {
  const out = cloneAudioBuffer(ctx, source);
  const sr = out.sampleRate;
  const s0 = Math.max(0, Math.floor(startSec * sr));
  const s1 = Math.min(out.length, Math.floor(endSec * sr));
  const sliceLen = s1 - s0;
  if (sliceLen <= 0) return out;

  const offline = new OfflineAudioContext(out.numberOfChannels, sliceLen, sr);
  const srcBuf = offline.createBuffer(out.numberOfChannels, sliceLen, sr);
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    srcBuf.getChannelData(ch).set(out.getChannelData(ch).subarray(s0, s1));
  }

  const srcNode = offline.createBufferSource();
  srcNode.buffer = srcBuf;
  const filter = offline.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = frequency;
  filter.gain.value = gainDb;

  srcNode.connect(filter).connect(offline.destination);
  srcNode.start(0);
  const processed = await offline.startRendering();
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const dst = out.getChannelData(ch);
    const pData = processed.getChannelData(ch);
    for (let i = 0; i < sliceLen; i++) {
      dst[s0 + i] = Math.max(-1, Math.min(1, pData[i]));
    }
  }
  return out;
}

export function generateSynthesizedClip(
  ctx: BaseAudioContext,
  kind: 'sine' | 'chirp' | 'noise' | 'silence',
  durationSec = 2.0,
  freqHz = 440,
  amplitude = 0.65
): AudioBuffer {
  const sr = ctx.sampleRate || 44100;
  const len = Math.max(1, Math.floor(sr * durationSec));
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let val = 0;
      if (kind === 'sine') {
        val = Math.sin(2 * Math.PI * freqHz * t) * amplitude;
      } else if (kind === 'chirp') {
        const instFreq = freqHz + (880 - freqHz) * (i / len);
        val = Math.sin(2 * Math.PI * instFreq * t) * amplitude;
      } else if (kind === 'noise') {
        val = (Math.random() * 2 - 1) * (amplitude * 0.45);
      }
      data[i] = val;
    }
  }
  return buf;
}

export interface MixdownTrackInput {
  buffer: AudioBuffer | null;
  offsetSec: number;
  gainDb: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  rate: number;
}

export async function mixdownMultitrackToBuffer(
  tracks: MixdownTrackInput[],
  sampleRate = 44100
): Promise<AudioBuffer | null> {
  const anySolo = tracks.some((t) => t.solo);
  const playable = tracks.filter((t) => t.buffer && !t.muted && (!anySolo || t.solo));
  if (playable.length === 0) return null;

  const totalDur = Math.max(
    1,
    ...playable.map((t) => t.offsetSec + t.buffer!.duration / Math.max(0.25, t.rate))
  );
  const offline = new OfflineAudioContext(2, Math.ceil((totalDur + 0.25) * sampleRate), sampleRate);

  playable.forEach((track) => {
    const src = offline.createBufferSource();
    src.buffer = track.buffer!;
    src.playbackRate.value = track.rate;

    const gain = offline.createGain();
    gain.gain.value = Math.pow(10, track.gainDb / 20);

    const panner = offline.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, track.pan));

    src.connect(gain).connect(panner).connect(offline.destination);
    src.start(Math.max(0, track.offsetSec));
  });

  return offline.startRendering();
}
