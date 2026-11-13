import { useEffect, useRef, useState } from 'react';
import {
  Disc3,
  ExternalLink,
  Play,
  Square,
  Upload,
  Radio,
  ShieldAlert,
  Download,
  RefreshCw,
} from 'lucide-react';
import {
  getAudioContext,
  renderGrooveBuffer,
  triggerBlobDownload,
} from '../../audio/studioAudio';

interface VirtualDjTabProps {
  userRole?: string;
}

interface DeckState {
  id: 'A' | 'B';
  title: string;
  baseBpm: number;
  camelotKey: string;
  playing: boolean;
  pitchPct: number; // -16 to +16
  lowEq: number; // -24 to +6
  midEq: number;
  highEq: number;
  filterSweep: number; // -1 (LPF) to +1 (HPF)
  echoWet: number; // 0 to 0.7
  loopBeats: number | null;
  hotCues: (number | null)[];
  stems: {
    vocals: number;
    drums: number;
    bass: number;
    melody: number;
  };
  buffer: AudioBuffer | null;
}

const VINYL_IMG = '/src/assets/images/dj_deck_vinyl_1794573516670.jpg';

const INITIAL_DECK_A: DeckState = {
  id: 'A',
  title: 'Deck A · Afro-Tech Club Groove',
  baseBpm: 120,
  camelotKey: '8A',
  playing: false,
  pitchPct: 0,
  lowEq: 0,
  midEq: 0,
  highEq: 0,
  filterSweep: 0,
  echoWet: 0,
  loopBeats: null,
  hotCues: [0, 1.5, 3.0, null, null, null, null, null],
  stems: { vocals: 1, drums: 1, bass: 1, melody: 1 },
  buffer: null,
};

const INITIAL_DECK_B: DeckState = {
  id: 'B',
  title: 'Deck B · Peak Hour House Roller',
  baseBpm: 124,
  camelotKey: '9A',
  playing: false,
  pitchPct: 0,
  lowEq: 0,
  midEq: 0,
  highEq: 0,
  filterSweep: 0,
  echoWet: 0,
  loopBeats: null,
  hotCues: [0, 2.0, 4.0, null, null, null, null, null],
  stems: { vocals: 1, drums: 1, bass: 1, melody: 1 },
  buffer: null,
};

interface DeckAudioNodes {
  source: AudioBufferSourceNode;
  masterGain: GainNode;
  lowFilter: BiquadFilterNode;
  midFilter: BiquadFilterNode;
  highFilter: BiquadFilterNode;
  colorFilter: BiquadFilterNode;
  stemBassGain: GainNode;
  stemMidGain: GainNode;
  stemHighGain: GainNode;
  delayGain: GainNode;
  startedAt: number;
  startOffset: number;
}

export function VirtualDjTab({ userRole }: VirtualDjTabProps) {
  const [djModeVerified, setDjModeVerified] = useState(userRole === 'dj');
  const [deckA, setDeckA] = useState<DeckState>(INITIAL_DECK_A);
  const [deckB, setDeckB] = useState<DeckState>(INITIAL_DECK_B);
  const [crossfader, setCrossfader] = useState(0.5); // 0 = full A, 1 = full B
  const [recordingMix, setRecordingMix] = useState(false);
  const [recordedMixUrl, setRecordedMixUrl] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const deckNodesRef = useRef<{ A: DeckAudioNodes | null; B: DeckAudioNodes | null }>({
    A: null,
    B: null,
  });
  const masterBusRef = useRef<GainNode | null>(null);
  const mixDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mixRecorderRef = useRef<MediaRecorder | null>(null);
  const mixChunksRef = useRef<Blob[]>([]);

  // Initialize master bus & preload built-in DJ grooves
  useEffect(() => {
    let mounted = true;
    Promise.all([
      renderGrooveBuffer('afro', 120, 4),
      renderGrooveBuffer('house', 124, 4),
    ]).then(([bufA, bufB]) => {
      if (!mounted) return;
      setDeckA((d) => (d.buffer ? d : { ...d, buffer: bufA }));
      setDeckB((d) => (d.buffer ? d : { ...d, buffer: bufB }));
    });
    return () => {
      mounted = false;
      stopDeck('A');
      stopDeck('B');
    };
  }, []);

  const ensureMasterBus = () => {
    const ctx = getAudioContext();
    if (!masterBusRef.current) {
      const bus = ctx.createGain();
      bus.gain.value = 0.9;
      bus.connect(ctx.destination);
      const dest = ctx.createMediaStreamDestination();
      bus.connect(dest);
      masterBusRef.current = bus;
      mixDestRef.current = dest;
    }
    return { ctx, bus: masterBusRef.current, dest: mixDestRef.current! };
  };

  // Update live DSP parameters when sliders change
  useEffect(() => {
    const applyLiveParams = (deck: DeckState, xfGain: number) => {
      const nodes = deckNodesRef.current[deck.id];
      if (!nodes) return;
      const ctx = getAudioContext();
      const now = ctx.currentTime;

      nodes.source.playbackRate.setTargetAtTime(1 + deck.pitchPct / 100, now, 0.02);
      nodes.masterGain.gain.setTargetAtTime(xfGain, now, 0.02);
      nodes.lowFilter.gain.setTargetAtTime(deck.lowEq, now, 0.02);
      nodes.midFilter.gain.setTargetAtTime(deck.midEq, now, 0.02);
      nodes.highFilter.gain.setTargetAtTime(deck.highEq, now, 0.02);

      // 4-Stem Crossover Gains
      nodes.stemBassGain.gain.setTargetAtTime(deck.stems.bass * 0.9 + deck.stems.drums * 0.3, now, 0.02);
      nodes.stemMidGain.gain.setTargetAtTime(deck.stems.vocals * 0.65 + deck.stems.melody * 0.65, now, 0.02);
      nodes.stemHighGain.gain.setTargetAtTime(deck.stems.drums * 0.65 + deck.stems.vocals * 0.45, now, 0.02);

      nodes.delayGain.gain.setTargetAtTime(deck.echoWet, now, 0.02);

      if (Math.abs(deck.filterSweep) < 0.05) {
        nodes.colorFilter.type = 'allpass';
      } else if (deck.filterSweep < 0) {
        nodes.colorFilter.type = 'lowpass';
        const freq = 220 + (1 + deck.filterSweep) * 14000;
        nodes.colorFilter.frequency.setTargetAtTime(Math.max(120, freq), now, 0.02);
        nodes.colorFilter.Q.setTargetAtTime(2.5, now, 0.02);
      } else {
        nodes.colorFilter.type = 'highpass';
        const freq = 60 + deck.filterSweep * 4500;
        nodes.colorFilter.frequency.setTargetAtTime(freq, now, 0.02);
        nodes.colorFilter.Q.setTargetAtTime(2.5, now, 0.02);
      }
    };

    const gainA = Math.cos(crossfader * Math.PI * 0.5);
    const gainB = Math.sin(crossfader * Math.PI * 0.5);
    applyLiveParams(deckA, gainA);
    applyLiveParams(deckB, gainB);
  }, [deckA, deckB, crossfader]);

  const stopDeck = (id: 'A' | 'B') => {
    const existing = deckNodesRef.current[id];
    if (existing) {
      try {
        existing.source.stop();
      } catch {
        // ignored
      }
      deckNodesRef.current[id] = null;
    }
    const setter = id === 'A' ? setDeckA : setDeckB;
    setter((d) => ({ ...d, playing: false }));
  };

  const startDeck = (deck: DeckState, offsetSec = 0) => {
    if (!deck.buffer) return;
    stopDeck(deck.id);

    const { ctx, bus } = ensureMasterBus();
    const src = ctx.createBufferSource();
    src.buffer = deck.buffer;
    src.loop = true;
    src.playbackRate.value = 1 + deck.pitchPct / 100;

    if (deck.loopBeats && deck.loopBeats > 0) {
      const loopDur = (60 / deck.baseBpm) * deck.loopBeats;
      src.loopStart = offsetSec;
      src.loopEnd = Math.min(deck.buffer.duration, offsetSec + loopDur);
    }

    // 3-Band EQ
    const lowFilter = ctx.createBiquadFilter();
    lowFilter.type = 'lowshelf';
    lowFilter.frequency.value = 220;
    lowFilter.gain.value = deck.lowEq;

    const midFilter = ctx.createBiquadFilter();
    midFilter.type = 'peaking';
    midFilter.frequency.value = 1200;
    midFilter.Q.value = 1.0;
    midFilter.gain.value = deck.midEq;

    const highFilter = ctx.createBiquadFilter();
    highFilter.type = 'highshelf';
    highFilter.frequency.value = 3800;
    highFilter.gain.value = deck.highEq;

    const colorFilter = ctx.createBiquadFilter();
    colorFilter.type = 'allpass';

    // 4-Stem Crossover Splitter
    const stemLP = ctx.createBiquadFilter();
    stemLP.type = 'lowpass';
    stemLP.frequency.value = 210;
    const stemBassGain = ctx.createGain();
    stemBassGain.gain.value = deck.stems.bass * 0.9 + deck.stems.drums * 0.3;

    const stemBP = ctx.createBiquadFilter();
    stemBP.type = 'bandpass';
    stemBP.frequency.value = 1250;
    stemBP.Q.value = 0.7;
    const stemMidGain = ctx.createGain();
    stemMidGain.gain.value = deck.stems.vocals * 0.65 + deck.stems.melody * 0.65;

    const stemHP = ctx.createBiquadFilter();
    stemHP.type = 'highpass';
    stemHP.frequency.value = 3400;
    const stemHighGain = ctx.createGain();
    stemHighGain.gain.value = deck.stems.drums * 0.65 + deck.stems.vocals * 0.45;

    const masterGain = ctx.createGain();
    const xfGain = deck.id === 'A' ? Math.cos(crossfader * Math.PI * 0.5) : Math.sin(crossfader * Math.PI * 0.5);
    masterGain.gain.value = xfGain;

    // Beat FX Echo
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = (60 / deck.baseBpm) * 0.75;
    const delayGain = ctx.createGain();
    delayGain.gain.value = deck.echoWet;

    src.connect(lowFilter);
    lowFilter.connect(midFilter);
    midFilter.connect(highFilter);
    highFilter.connect(colorFilter);

    colorFilter.connect(stemLP).connect(stemBassGain).connect(masterGain);
    colorFilter.connect(stemBP).connect(stemMidGain).connect(masterGain);
    colorFilter.connect(stemHP).connect(stemHighGain).connect(masterGain);

    masterGain.connect(bus);
    masterGain.connect(delay).connect(delayGain).connect(bus);

    const safeOffset = offsetSec % Math.max(0.1, deck.buffer.duration);
    src.start(ctx.currentTime, safeOffset);

    deckNodesRef.current[deck.id] = {
      source: src,
      masterGain,
      lowFilter,
      midFilter,
      highFilter,
      colorFilter,
      stemBassGain,
      stemMidGain,
      stemHighGain,
      delayGain,
      startedAt: ctx.currentTime,
      startOffset: safeOffset,
    };

    const setter = deck.id === 'A' ? setDeckA : setDeckB;
    setter((d) => ({ ...d, playing: true }));
  };

  const handleSyncDeck = (targetId: 'A' | 'B') => {
    const target = targetId === 'A' ? deckA : deckB;
    const source = targetId === 'A' ? deckB : deckA;
    const sourceLiveBpm = source.baseBpm * (1 + source.pitchPct / 100);
    const requiredPitchPct = ((sourceLiveBpm / target.baseBpm) - 1) * 100;
    const clamped = Math.max(-16, Math.min(16, Number(requiredPitchPct.toFixed(1))));
    const setter = targetId === 'A' ? setDeckA : setDeckB;
    setter((d) => ({ ...d, pitchPct: clamped }));
    setStatusMsg(`Deck ${targetId} BPM synced to ${sourceLiveBpm.toFixed(1)} BPM.`);
  };

  const handleLoadDeckFile = async (id: 'A' | 'B', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const ab = await file.arrayBuffer();
      const ctx = getAudioContext();
      const decoded = await ctx.decodeAudioData(ab);
      const setter = id === 'A' ? setDeckA : setDeckB;
      setter((d) => ({
        ...d,
        buffer: decoded,
        title: `Deck ${id} · ${file.name.replace(/\.[^/.]+$/, '')}`,
      }));
      setStatusMsg(`Loaded "${file.name}" onto Deck ${id}.`);
    } catch {
      setStatusMsg('Could not decode audio file for deck.');
    }
  };

  const handleToggleRecordMix = () => {
    if (recordingMix) {
      mixRecorderRef.current?.stop();
      setRecordingMix(false);
      return;
    }
    const { dest } = ensureMasterBus();
    const rec = new MediaRecorder(dest.stream);
    mixChunksRef.current = [];
    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) mixChunksRef.current.push(ev.data);
    };
    rec.onstop = () => {
      const blob = new Blob(mixChunksRef.current, { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);
      setRecordedMixUrl(url);
      triggerBlobDownload(blob, 'sounddeck-dj-live-mix.webm');
      setStatusMsg('Live DJ mix recorded and downloaded.');
    };
    mixRecorderRef.current = rec;
    rec.start();
    setRecordingMix(true);
  };

  if (!djModeVerified) {
    return (
      <div className="rounded-xl bg-[#13161B] border border-[#232833] p-8 max-w-2xl mx-auto my-8 text-center space-y-5">
        <div className="w-14 h-14 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6 text-amber-400" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-2xl font-bold text-slate-100">
            Virtual DJ Console — DJ-Only Access
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            This dual-deck 4-stem console, Camelot harmonic sync engine, and VirtualDJ website bridge are engineered specifically for live DJs. Confirm DJ access to unlock the booth.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => setDjModeVerified(true)}
            className="px-6 py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition-colors"
          >
            Enter DJ Booth
          </button>
          <a
            href="https://www.virtualdj.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-3 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-slate-200 text-sm font-medium border border-[#2A313E] inline-flex items-center gap-2 transition-colors"
          >
            <span>VirtualDJ Official</span>
            <ExternalLink className="w-4 h-4 text-amber-400" />
          </a>
        </div>
      </div>
    );
  }

  const renderDeck = (deck: DeckState, setDeck: React.Dispatch<React.SetStateAction<DeckState>>) => {
    const liveBpm = (deck.baseBpm * (1 + deck.pitchPct / 100)).toFixed(1);

    return (
      <div className="rounded-xl bg-[#13161B] border border-[#232833] p-5 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-mono text-amber-400 tabular-nums">
              {liveBpm} BPM · Key {deck.camelotKey}
            </div>
            <h3 className="font-display text-base font-semibold text-slate-100 truncate mt-0.5">
              {deck.title}
            </h3>
          </div>
          <label className="px-3 py-1.5 rounded-lg bg-[#0B0D10] hover:bg-[#1B2028] text-slate-200 text-xs border border-[#232833] flex items-center gap-1.5 cursor-pointer shrink-0">
            <Upload className="w-3.5 h-3.5" />
            <span>Load Track</span>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => handleLoadDeckFile(deck.id, e)}
              className="hidden"
            />
          </label>
        </div>

        {/* Turntable Platter + Transport */}
        <div className="flex flex-col sm:flex-row items-center gap-5">
          <div className="relative w-32 h-32 rounded-full overflow-hidden border border-[#2A313E] shrink-0 bg-[#0B0D10]">
            <img
              src={VINYL_IMG}
              alt={`Deck ${deck.id} platter`}
              referrerPolicy="no-referrer"
              className={`w-full h-full object-cover ${
                deck.playing ? 'animate-vinyl' : 'animate-vinyl-paused'
              }`}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-8 h-8 rounded-full bg-[#0B0D10] border border-amber-500/60 flex items-center justify-center">
                <Disc3 className="w-4 h-4 text-amber-400" />
              </div>
            </div>
          </div>

          <div className="flex-1 w-full space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => (deck.playing ? stopDeck(deck.id) : startDeck(deck, 0))}
                className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                  deck.playing
                    ? 'bg-red-500/20 text-red-200 border border-red-500/40'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                }`}
              >
                {deck.playing ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{deck.playing ? 'Stop' : 'Play'}</span>
              </button>

              <button
                type="button"
                onClick={() => handleSyncDeck(deck.id)}
                className="px-3 py-2 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-amber-400 text-xs font-semibold border border-[#2A313E] flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Sync</span>
              </button>

              <div className="flex items-center gap-1 ml-auto">
                {[0.5, 1, 2, 4].map((beats) => (
                  <button
                    key={beats}
                    type="button"
                    onClick={() => {
                      const nextLoop = deck.loopBeats === beats ? null : beats;
                      const updated = { ...deck, loopBeats: nextLoop };
                      setDeck(updated);
                      if (deck.playing) startDeck(updated, 0);
                    }}
                    className={`px-2 py-1.5 rounded text-[11px] font-mono border ${
                      deck.loopBeats === beats
                        ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                        : 'bg-[#0B0D10] text-slate-400 border-[#232833]'
                    }`}
                  >
                    {beats}B
                  </button>
                ))}
              </div>
            </div>

            {/* Pitch / Tempo Slider */}
            <div className="flex items-center gap-3 text-xs">
              <span className="text-slate-400 w-12">Pitch</span>
              <input
                type="range"
                min={-16}
                max={16}
                step={0.5}
                value={deck.pitchPct}
                onChange={(e) => setDeck((d) => ({ ...d, pitchPct: Number(e.target.value) }))}
                className="studio-slider flex-1"
              />
              <span className="font-mono text-amber-400 w-14 text-right tabular-nums">
                {deck.pitchPct > 0 ? `+${deck.pitchPct}` : deck.pitchPct}%
              </span>
            </div>

            {/* Color Filter & Beat FX Echo */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Filter</span>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={deck.filterSweep}
                  onChange={(e) => setDeck((d) => ({ ...d, filterSweep: Number(e.target.value) }))}
                  className="studio-slider flex-1"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Echo</span>
                <input
                  type="range"
                  min={0}
                  max={0.65}
                  step={0.05}
                  value={deck.echoWet}
                  onChange={(e) => setDeck((d) => ({ ...d, echoWet: Number(e.target.value) }))}
                  className="studio-slider flex-1"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 4-Stem Isolation Faders (Extreme DJ Feature) */}
        <div className="p-3.5 rounded-lg bg-[#0B0D10] border border-[#232833] space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-200">4-Stem Real-Time Isolation</span>
            <button
              type="button"
              onClick={() =>
                setDeck((d) => ({
                  ...d,
                  stems: { vocals: 1, drums: 1, bass: 1, melody: 1 },
                }))
              }
              className="text-[11px] text-amber-400 hover:underline"
            >
              Reset Stems
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(['vocals', 'drums', 'bass', 'melody'] as const).map((stemKey) => (
              <div key={stemKey} className="space-y-1">
                <div className="flex items-center justify-between text-[11px] capitalize">
                  <span className="text-slate-400">{stemKey}</span>
                  <span className="font-mono text-slate-300 tabular-nums">
                    {Math.round(deck.stems[stemKey] * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={deck.stems[stemKey]}
                  onChange={(e) =>
                    setDeck((d) => ({
                      ...d,
                      stems: { ...d.stems, [stemKey]: Number(e.target.value) },
                    }))
                  }
                  className="studio-slider w-full"
                />
              </div>
            ))}
          </div>
        </div>

        {/* 3-Band Kill EQ & 8 Hot Cue Pads */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
          <div className="sm:col-span-5 space-y-2">
            {(
              [
                { key: 'highEq', label: 'High' },
                { key: 'midEq', label: 'Mid' },
                { key: 'lowEq', label: 'Low' },
              ] as const
            ).map((band) => (
              <div key={band.key} className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() =>
                    setDeck((d) => ({
                      ...d,
                      [band.key]: d[band.key] <= -20 ? 0 : -24,
                    }))
                  }
                  className={`w-10 py-1 rounded font-mono border ${
                    deck[band.key] <= -20
                      ? 'bg-red-500/20 border-red-500/40 text-red-300'
                      : 'bg-[#0B0D10] border-[#232833] text-slate-400'
                  }`}
                  title={`Kill ${band.label}`}
                >
                  {band.label}
                </button>
                <input
                  type="range"
                  min={-24}
                  max={6}
                  step={1}
                  value={deck[band.key]}
                  onChange={(e) => setDeck((d) => ({ ...d, [band.key]: Number(e.target.value) }))}
                  className="studio-slider flex-1"
                />
              </div>
            ))}
          </div>

          <div className="sm:col-span-7 grid grid-cols-4 gap-1.5">
            {deck.hotCues.map((cueTime, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  if (cueTime !== null) {
                    startDeck(deck, cueTime);
                  } else {
                    const nextCues = [...deck.hotCues];
                    nextCues[idx] = Number(((idx * 0.8) % Math.max(1, deck.buffer?.duration || 4)).toFixed(2));
                    setDeck((d) => ({ ...d, hotCues: nextCues }));
                  }
                }}
                className={`py-2 px-1 rounded text-[11px] font-mono border transition-colors ${
                  cueTime !== null
                    ? 'bg-amber-500/15 border-amber-500/60 text-amber-300 hover:bg-amber-500/25'
                    : 'bg-[#0B0D10] border-[#232833] text-slate-500 hover:text-slate-300'
                }`}
              >
                {cueTime !== null ? `CUE ${idx + 1}` : `SET ${idx + 1}`}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#232833] pb-5">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-100">
            Virtual DJ Pro Console
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            DJ-only dual-deck booth with 4-stem isolation, Camelot key sync, hot cues, and VirtualDJ integration.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href="https://www.virtualdj.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-2 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-amber-400 text-xs font-semibold border border-amber-500/30 flex items-center gap-1.5 whitespace-nowrap"
          >
            <span>VirtualDJ.com</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <a
            href="https://www.virtualdj.com/products/virtualdj/stems.html"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-2 rounded-lg bg-[#0B0D10] hover:bg-[#1B2028] text-slate-200 text-xs font-medium border border-[#232833] flex items-center gap-1.5 whitespace-nowrap"
          >
            <span>VDJ Stems 2.0</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <a
            href="https://www.virtualdj.com/manuals/hardware/index.html"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-2 rounded-lg bg-[#0B0D10] hover:bg-[#1B2028] text-slate-200 text-xs font-medium border border-[#232833] flex items-center gap-1.5 whitespace-nowrap"
          >
            <span>Controller Mappings</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-lg bg-[#13161B] border border-amber-500/30 text-xs text-amber-200">
          {statusMsg}
        </div>
      )}

      {/* Dual Decks */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {renderDeck(deckA, setDeckA)}
        {renderDeck(deckB, setDeckB)}
      </div>

      {/* Master Crossfader & Live Set Recorder */}
      <div className="rounded-xl bg-[#13161B] border border-[#232833] p-5 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="w-full md:w-1/2 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>DECK A</span>
            <span className="text-amber-400">MASTER CROSSFADER</span>
            <span>DECK B</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={crossfader}
            onChange={(e) => setCrossfader(Number(e.target.value))}
            className="studio-slider w-full"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleToggleRecordMix}
            className={`px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap ${
              recordingMix
                ? 'bg-red-500/20 text-red-200 border border-red-500/50'
                : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>{recordingMix ? 'Stop & Save Set' : 'Record Live DJ Set'}</span>
          </button>

          {recordedMixUrl && (
            <a
              href={recordedMixUrl}
              download="sounddeck-dj-live-mix.webm"
              className="px-3.5 py-2.5 rounded-lg bg-[#1B2028] text-slate-100 text-xs font-medium border border-[#2A313E] flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>Re-download Set</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
