import { useEffect, useRef, useState } from 'react';
import {
  Wand2,
  Play,
  Square,
  Download,
  Mic,
  MicOff,
  Save,
  Sliders,
  Upload,
  CheckCircle2,
  Trash2,
  X,
  Music2,
  Sparkles,
  ImagePlus,
  Box,
} from 'lucide-react';
import { type User } from 'firebase/auth';
import {
  DRUM_PADS,
  type DrumPadId,
  getAudioContext,
  getStudioMasterNode,
  attachMediaElementToAnalyser,
  triggerSynthPad,
  triggerBufferPad,
  renderPatternToBuffer,
  audioBufferToWavBlob,
  triggerBlobDownload,
  detectVocalOnsetsMs,
} from '../../audio/studioAudio';
import { DISCOVER_CATALOG_TRACKS } from '../../audio/discoverCatalog';
import {
  saveMusicProject,
  removeMusicProject,
  type SavedMusicProject,
  type PadSampleAssignment,
} from '../../firebase';

interface MusicCreationTabProps {
  user: User | null;
  projects: SavedMusicProject[];
  padAssignments: PadSampleAssignment[];
  padSampleBuffers: Partial<Record<DrumPadId, AudioBuffer>>;
  discoverCustomSamples: { id: string; title: string; buffer: AudioBuffer }[];
  onAssignSampleToPad: (params: {
    padId: DrumPadId;
    sampleName: string;
    sourceType: 'catalog' | 'custom_audio';
    sourceTrackId: string;
    grooveStyle: 'afro' | 'house' | 'trap';
    bpm: number;
    sliceStartSec: number;
    sliceDurationSec: number;
    rawBuffer?: AudioBuffer;
  }) => Promise<{ savedToCloud: boolean }>;
  onRemovePadAssignment: (padId: DrumPadId) => Promise<void>;
  onOpenAuth: () => void;
  onActiveTrackChange: (title: string) => void;
  initialBpm?: number;
  onBpmChange?: (bpm: number) => void;
  onOpen3DStage?: () => void;
}

interface LyricBar {
  line: string;
  syllables: number;
  beatCue: string;
}

interface LyricSection {
  name: string;
  deliveryTip: string;
  bars: LyricBar[];
}

interface GeneratedLyrics {
  title: string;
  hookSummary: string;
  keySignature: string;
  sections: LyricSection[];
}

interface AlignmentResult {
  recommendedOffsetMs: number;
  pocketDiagnosis: string;
  cadenceTips: string[];
  mixingChain: {
    highPassHz: number;
    presenceBoostDb: string;
    compressorRatio: string;
    reverbDecaySec: string;
  };
}

const PRESET_PATTERNS: Record<'afrobeats' | 'trap' | 'house' | 'lofi', Record<string, boolean[]>> = {
  afrobeats: {
    kick808: [true, false, false, false, false, false, true, false, false, false, true, false, false, false, false, false],
    logDrum: [false, false, false, true, false, false, false, false, false, false, false, true, false, true, false, false],
    rimshot: [false, false, true, false, false, true, false, false, false, false, true, false, false, true, false, false],
    shaker: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
    rhodesC: [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
  },
  trap: {
    kick808: [true, false, false, false, false, false, false, true, false, false, true, false, false, false, false, false],
    snare: [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
    hihatClosed: [true, true, true, true, true, false, true, true, true, true, true, true, true, true, true, false],
    subBass: [true, false, false, false, false, false, false, true, false, false, true, false, false, false, false, false],
    pluck: [true, false, false, true, false, false, true, false, false, false, true, false, false, false, false, false],
  },
  house: {
    kick808: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    hihatOpen: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
    subBass: [true, false, false, true, false, false, true, false, true, false, false, true, false, false, true, false],
    rhodesG: [true, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false],
  },
  lofi: {
    kick808: [true, false, false, false, false, false, false, true, false, false, true, false, false, false, false, false],
    snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    shaker: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
    rhodesF: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
  },
};

const SEQUENCER_LANES: { id: DrumPadId; label: string }[] = [
  { id: 'kick808', label: '808 Kick' },
  { id: 'snare', label: 'Snare' },
  { id: 'clap', label: 'Clap' },
  { id: 'hihatClosed', label: 'Closed Hat' },
  { id: 'logDrum', label: 'Afro Log' },
  { id: 'rimshot', label: 'Rimshot' },
  { id: 'shaker', label: 'Shaker' },
  { id: 'subBass', label: 'Sub Bass' },
];

export function MusicCreationTab({
  user,
  projects,
  padAssignments,
  padSampleBuffers,
  discoverCustomSamples,
  onAssignSampleToPad,
  onRemovePadAssignment,
  onOpenAuth,
  onActiveTrackChange,
  initialBpm,
  onBpmChange,
  onOpen3DStage,
}: MusicCreationTabProps) {
  // Lyrics AI state
  const [genre, setGenre] = useState('Afrobeats');
  const [mood, setMood] = useState('Confident & nocturnal');
  const [bpm, setBpm] = useState(initialBpm ?? 112);
  const [topic, setTopic] = useState('Turning midnight studio sessions into a global anthem');
  const [lyricsData, setLyricsData] = useState<GeneratedLyrics | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);

  // Beat Pads & Sequencer state
  const [kitPreset, setKitPreset] = useState<'afrobeats' | 'trap' | 'house' | 'lofi'>('afrobeats');
  const [pattern, setPattern] = useState<Record<string, boolean[]>>(PRESET_PATTERNS.afrobeats);
  const [isPlayingSeq, setIsPlayingSeq] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [activePad, setActivePad] = useState<DrumPadId | null>(null);
  const [swingPct, setSwingPct] = useState(8);
  const [masterVol, setMasterVol] = useState(0.85);
  const [exportingWav, setExportingWav] = useState(false);

  // Discover sample mapper controls inside Music Creation
  const [mapperPadId, setMapperPadId] = useState<DrumPadId>('pluck');
  const [mapperSampleKey, setMapperSampleKey] = useState<string>(DISCOVER_CATALOG_TRACKS[0].id);
  const [mapperSliceSec, setMapperSliceSec] = useState<number>(0);
  const [assigningPad, setAssigningPad] = useState(false);

  // Voice Alignment AI Assistant state
  const [isRecordingVocal, setIsRecordingVocal] = useState(false);
  const [vocalBuffer, setVocalBuffer] = useState<AudioBuffer | null>(null);
  const [vocalTakeLabel, setVocalTakeLabel] = useState('Hook Vocal Take 1');
  const [vocalOnsetsMs, setVocalOnsetsMs] = useState<number[]>([]);
  const [vocalOffsetMs, setVocalOffsetMs] = useState(0);
  const [alignLoading, setAlignLoading] = useState(false);
  const [alignmentResult, setAlignmentResult] = useState<AlignmentResult | null>(null);
  const [auditioningMix, setAuditioningMix] = useState(false);

  // Lyria Music Generation state
  const [lyriaPrompt, setLyriaPrompt] = useState('Warm nocturnal Afrobeats groove with deep sub bass, rimshot pocket, and shimmering Rhodes chords');
  const [lyriaMode, setLyriaMode] = useState<'clip' | 'pro'>('clip');
  const [lyriaImagePreview, setLyriaImagePreview] = useState<string | null>(null);
  const [lyriaImageBase64, setLyriaImageBase64] = useState<string | null>(null);
  const [lyriaImageMime, setLyriaImageMime] = useState<string | null>(null);
  const [lyriaLoading, setLyriaLoading] = useState(false);
  const [lyriaAudioUrl, setLyriaAudioUrl] = useState<string | null>(null);
  const [lyriaLyrics, setLyriaLyrics] = useState<string>('');
  const [lyriaModelUsed, setLyriaModelUsed] = useState<string>('');
  const [lyriaPadTarget, setLyriaPadTarget] = useState<DrumPadId>('scratch');

  const [savingProject, setSavingProject] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const seqTimerRef = useRef<number | null>(null);
  const alignCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lyriaAudioElRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof initialBpm === 'number') {
      setBpm((prev) => (prev !== initialBpm ? initialBpm : prev));
    }
  }, [initialBpm]);

  useEffect(() => {
    onBpmChange?.(bpm);
  }, [bpm, onBpmChange]);

  const assignmentByPad = new Map<string, PadSampleAssignment>(
    padAssignments.map((a) => [a.padId, a])
  );

  // Keyboard shortcuts for 16 pads
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      const key = e.key.toUpperCase();
      const pad = DRUM_PADS.find((p) => p.keyBind === key);
      if (pad) {
        handleTriggerPad(pad.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [masterVol, padSampleBuffers]);

  // Step Sequencer Loop
  useEffect(() => {
    if (!isPlayingSeq) {
      if (seqTimerRef.current) window.clearTimeout(seqTimerRef.current);
      return;
    }

    let step = currentStep;
    const tick = () => {
      const ctx = getAudioContext();
      const masterDest = getStudioMasterNode(ctx);
      const activeSequencerPadIds = new Set<DrumPadId>([
        ...SEQUENCER_LANES.slice(0, 5).map((l) => l.id),
        ...padAssignments.map((a) => a.padId as DrumPadId),
      ]);

      activeSequencerPadIds.forEach((padId) => {
        if (pattern[padId]?.[step]) {
          const customBuf = padSampleBuffers[padId];
          if (customBuf) {
            triggerBufferPad(ctx, masterDest, customBuf, ctx.currentTime, masterVol, 1.8);
          } else {
            triggerSynthPad(ctx, masterDest, padId, ctx.currentTime, masterVol);
          }
        }
      });

      // Also trigger melodic chords if present in preset and not already triggered above
      for (const chordId of ['rhodesC', 'rhodesF', 'rhodesG', 'pluck'] as DrumPadId[]) {
        if (!activeSequencerPadIds.has(chordId) && pattern[chordId]?.[step]) {
          const customBuf = padSampleBuffers[chordId];
          if (customBuf) {
            triggerBufferPad(ctx, masterDest, customBuf, ctx.currentTime, masterVol * 0.75, 1.8);
          } else {
            triggerSynthPad(ctx, masterDest, chordId, ctx.currentTime, masterVol * 0.75);
          }
        }
      }

      setCurrentStep(step);
      const baseStepMs = (60 / bpm / 4) * 1000;
      const swingOffset = step % 2 === 1 ? (baseStepMs * swingPct) / 100 : -(baseStepMs * swingPct) / 100;
      step = (step + 1) % 16;
      seqTimerRef.current = window.setTimeout(tick, Math.max(40, baseStepMs + swingOffset));
    };

    tick();
    return () => {
      if (seqTimerRef.current) window.clearTimeout(seqTimerRef.current);
    };
  }, [isPlayingSeq, bpm, pattern, swingPct, masterVol, padSampleBuffers, padAssignments]);

  // Draw Beat Grid vs Vocal Onsets Canvas
  useEffect(() => {
    const canvas = alignCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#0B0D10';
    ctx.fillRect(0, 0, w, h);

    const totalMs = Math.max(4000, vocalBuffer ? vocalBuffer.duration * 1000 : 8000);
    const beatMs = 60000 / bpm;

    // Beat Grid Lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = 1;
    for (let t = 0; t <= totalMs; t += beatMs) {
      const x = (t / totalMs) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Vocal waveform silhouette if available
    if (vocalBuffer) {
      const samples = vocalBuffer.getChannelData(0);
      const step = Math.max(1, Math.floor(samples.length / w));
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const shiftPx = (vocalOffsetMs / totalMs) * w;
      for (let x = 0; x < w; x++) {
        const srcX = Math.max(0, Math.min(w - 1, Math.round(x - shiftPx)));
        const idx = srcX * step;
        let peak = 0;
        for (let k = 0; k < step && idx + k < samples.length; k++) {
          const val = Math.abs(samples[idx + k]);
          if (val > peak) peak = val;
        }
        const yTop = h * 0.5 - peak * (h * 0.42);
        const yBot = h * 0.5 + peak * (h * 0.42);
        ctx.moveTo(x, yTop);
        ctx.lineTo(x, yBot);
      }
      ctx.stroke();
    }

    // Vocal onset markers
    ctx.fillStyle = '#F59E0B';
    vocalOnsetsMs.forEach((ms) => {
      const shiftedMs = ms + vocalOffsetMs;
      const x = (shiftedMs / totalMs) * w;
      if (x >= 0 && x <= w) {
        ctx.fillRect(x - 1.5, 6, 3, 14);
      }
    });
  }, [bpm, vocalBuffer, vocalOnsetsMs, vocalOffsetMs]);

  const handleTriggerPad = (padId: DrumPadId) => {
    const ctx = getAudioContext();
    const masterDest = getStudioMasterNode(ctx);
    const customBuf = padSampleBuffers[padId];
    if (customBuf) {
      triggerBufferPad(ctx, masterDest, customBuf, ctx.currentTime, masterVol, 2.2);
    } else {
      triggerSynthPad(ctx, masterDest, padId, ctx.currentTime, masterVol);
    }
    setActivePad(padId);
    setTimeout(() => setActivePad((prev) => (prev === padId ? null : prev)), 130);
  };

  const handleAssignDiscoverSampleHere = async () => {
    setAssigningPad(true);
    setErrorMsg(null);
    setStatusMessage(null);
    try {
      const customSample = discoverCustomSamples.find((s) => s.id === mapperSampleKey);
      const catalogTrack = DISCOVER_CATALOG_TRACKS.find((t) => t.id === mapperSampleKey);
      if (!customSample && !catalogTrack) return;

      const { savedToCloud } = await onAssignSampleToPad({
        padId: mapperPadId,
        sampleName: customSample ? customSample.title : catalogTrack!.title,
        sourceType: customSample ? 'custom_audio' : 'catalog',
        sourceTrackId: customSample ? customSample.id : catalogTrack!.id,
        grooveStyle: catalogTrack ? catalogTrack.grooveStyle : 'afro',
        bpm: catalogTrack ? catalogTrack.bpm : bpm,
        sliceStartSec: mapperSliceSec,
        sliceDurationSec: 1.5,
        rawBuffer: customSample?.buffer,
      });

      const padInfo = DRUM_PADS.find((p) => p.id === mapperPadId);
      setStatusMessage(
        savedToCloud
          ? `Assigned "${customSample ? customSample.title : catalogTrack!.title}" to pad [${padInfo?.keyBind}] ${padInfo?.label} and saved to Firestore.`
          : `Assigned "${customSample ? customSample.title : catalogTrack!.title}" to pad [${padInfo?.keyBind}] ${padInfo?.label} for this session. Sign in to persist in Firestore.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to assign Discover sample.');
    } finally {
      setAssigningPad(false);
    }
  };

  const toggleStep = (laneId: string, idx: number) => {
    setPattern((prev) => {
      const row = prev[laneId] ? [...prev[laneId]] : Array(16).fill(false);
      row[idx] = !row[idx];
      return { ...prev, [laneId]: row };
    });
  };

  const handleLoadPreset = (preset: 'afrobeats' | 'trap' | 'house' | 'lofi') => {
    setKitPreset(preset);
    setPattern(PRESET_PATTERNS[preset]);
    const presetBpm = { afrobeats: 112, trap: 140, house: 124, lofi: 86 }[preset];
    setBpm(presetBpm);
  };

  const handleExportBeatWav = async () => {
    setExportingWav(true);
    try {
      const buffer = await renderPatternToBuffer(pattern, bpm, 2, padSampleBuffers);
      const blob = audioBufferToWavBlob(buffer);
      triggerBlobDownload(blob, `sounddeck-${kitPreset}-${bpm}bpm.wav`);
    } finally {
      setExportingWav(false);
    }
  };

  const handleGenerateLyrics = async () => {
    setLyricsLoading(true);
    setErrorMsg(null);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/gemini/lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          genre,
          mood,
          bpm,
          topic,
          structure: 'Intro, Verse 1, Chorus, Verse 2, Bridge, Chorus',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate lyrics');
      setLyricsData(data);
      if (data.title) onActiveTrackChange(data.title);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lyrics AI error.');
    } finally {
      setLyricsLoading(false);
    }
  };

  const handleStartVocalRecord = async () => {
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        const arrayBuf = await blob.arrayBuffer();
        const ctx = getAudioContext();
        const decoded = await ctx.decodeAudioData(arrayBuf);
        setVocalBuffer(decoded);
        setVocalOnsetsMs(detectVocalOnsetsMs(decoded));
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecordingVocal(true);
    } catch {
      setErrorMsg('Microphone permission is required to record vocals. You can also upload a .wav/.mp3 vocal take.');
    }
  };

  const handleStopVocalRecord = () => {
    mediaRecorderRef.current?.stop();
    setIsRecordingVocal(false);
  };

  const handleUploadVocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const arrayBuf = await file.arrayBuffer();
      const ctx = getAudioContext();
      const decoded = await ctx.decodeAudioData(arrayBuf);
      setVocalBuffer(decoded);
      setVocalTakeLabel(file.name.replace(/\.[^/.]+$/, ''));
      setVocalOnsetsMs(detectVocalOnsetsMs(decoded));
    } catch {
      setErrorMsg('Could not decode audio file. Try a standard .wav or .mp3 vocal clip.');
    }
  };

  const handleAnalyzeAlignment = async () => {
    setAlignLoading(true);
    setErrorMsg(null);
    try {
      const lyricsSnippet = lyricsData
        ? lyricsData.sections
            .slice(0, 2)
            .map((s) => `${s.name}: ${s.bars.map((b) => b.line).join(' / ')}`)
            .join('\n')
        : '';

      const res = await fetch('/api/gemini/voice-align', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bpm,
          genre,
          durationSec: vocalBuffer ? Number(vocalBuffer.duration.toFixed(2)) : 8,
          peakOnsetsMs: vocalOnsetsMs.length > 0 ? vocalOnsetsMs : [140, 690, 1210, 1760, 2320],
          lyricsSnippet,
          vocalTakeLabel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Voice alignment failed');
      setAlignmentResult(data);
      if (typeof data.recommendedOffsetMs === 'number') {
        setVocalOffsetMs(data.recommendedOffsetMs);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Alignment analysis failed.');
    } finally {
      setAlignLoading(false);
    }
  };

  const handleAuditionAlignedMix = async () => {
    if (!vocalBuffer) return;
    setAuditioningMix(true);
    const ctx = getAudioContext();
    const beatBuf = await renderPatternToBuffer(pattern, bpm, 2, padSampleBuffers);

    const beatSrc = ctx.createBufferSource();
    beatSrc.buffer = beatBuf;
    const beatGain = ctx.createGain();
    beatGain.gain.value = 0.75;
    beatSrc.connect(beatGain).connect(ctx.destination);

    const voxSrc = ctx.createBufferSource();
    voxSrc.buffer = vocalBuffer;
    const voxGain = ctx.createGain();
    voxGain.gain.value = 0.95;
    voxSrc.connect(voxGain).connect(ctx.destination);

    const startTime = ctx.currentTime + 0.08;
    const offsetSec = vocalOffsetMs / 1000;
    beatSrc.start(startTime);
    if (offsetSec >= 0) {
      voxSrc.start(startTime + offsetSec);
    } else {
      voxSrc.start(startTime, Math.min(vocalBuffer.duration - 0.1, Math.abs(offsetSec)));
    }

    setTimeout(() => setAuditioningMix(false), Math.min(8000, Math.round(beatBuf.duration * 1000)));
  };

  const handleSaveProject = async () => {
    if (!user) {
      onOpenAuth();
      return;
    }
    setSavingProject(true);
    setErrorMsg(null);
    setStatusMessage(null);
    try {
      const lyricsText = lyricsData
        ? lyricsData.sections
            .map((s) => `[${s.name}]\n${s.bars.map((b) => b.line).join('\n')}`)
            .join('\n\n')
        : '';

      await saveMusicProject(user.uid, {
        title: lyricsData?.title || `${genre} Session (${bpm} BPM)`,
        genre,
        bpm,
        lyrics: lyricsText,
        alignmentNotes: alignmentResult
          ? `${alignmentResult.pocketDiagnosis} (Offset: ${vocalOffsetMs}ms)`
          : '',
        kitName: kitPreset,
      });
      setStatusMessage('Music creation session saved to your cloud studio.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save session.');
    } finally {
      setSavingProject(false);
    }
  };

  const handleLyriaImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      if (commaIdx > -1) {
        setLyriaImagePreview(result);
        setLyriaImageBase64(result.slice(commaIdx + 1));
        setLyriaImageMime(file.type || 'image/jpeg');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateLyriaMusic = async () => {
    setLyriaLoading(true);
    setErrorMsg(null);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/gemini/music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: lyriaPrompt,
          mode: lyriaMode,
          genre,
          mood,
          bpm,
          imageBase64: lyriaImageBase64,
          imageMimeType: lyriaImageMime,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Lyria music generation failed.');
      }
      setLyriaAudioUrl(data.audioDataUrl);
      setLyriaLyrics(data.lyrics || '');
      setLyriaModelUsed(data.modelUsed || (lyriaMode === 'pro' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview'));
      onActiveTrackChange(`Lyria ${genre} (${bpm} BPM)`);
      setStatusMessage(`Generated ${lyriaMode === 'pro' ? 'full-length track' : '30s clip'} with ${data.modelUsed}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to generate music with Lyria.');
    } finally {
      setLyriaLoading(false);
    }
  };

  const handleSendLyriaToBeatPad = async () => {
    if (!lyriaAudioUrl) return;
    setErrorMsg(null);
    try {
      const res = await fetch(lyriaAudioUrl);
      const arrBuf = await res.arrayBuffer();
      const ctx = getAudioContext();
      const decoded = await ctx.decodeAudioData(arrBuf);
      const { savedToCloud } = await onAssignSampleToPad({
        padId: lyriaPadTarget,
        sampleName: `Lyria ${genre}`,
        sourceType: 'custom_audio',
        sourceTrackId: `lyria_${Date.now()}`,
        grooveStyle: 'afro',
        bpm,
        sliceStartSec: 0,
        sliceDurationSec: 1.6,
        rawBuffer: decoded,
      });
      const padInfo = DRUM_PADS.find((p) => p.id === lyriaPadTarget);
      setStatusMessage(
        savedToCloud
          ? `Chopped Lyria track onto pad [${padInfo?.keyBind}] ${padInfo?.label} and saved to Firestore.`
          : `Chopped Lyria track onto pad [${padInfo?.keyBind}] ${padInfo?.label} for this session.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to decode Lyria audio for pad mapping.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#232833] pb-5">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-100">
            Music Creation Studio
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            AI lyricist, 16-pad Web Audio beat sequencer with WAV export, and vocal-to-beat alignment assistant.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSaveProject}
          disabled={savingProject}
          className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center gap-2 transition-colors whitespace-nowrap disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{user ? (savingProject ? 'Saving...' : 'Save Studio Project') : 'Sign In to Save'}</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-950/50 border border-red-800/60 text-xs text-red-200">
          {errorMsg}
        </div>
      )}
      {statusMessage && (
        <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-800/60 text-xs text-emerald-200">
          {statusMessage}
        </div>
      )}

      {/* Section 1: Music Lyrics AI Generator + Beats & Instrumental Pads */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Lyrics AI Generator */}
        <div className="xl:col-span-5 rounded-xl bg-[#13161B] border border-[#232833] p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-slate-100">
                Music Lyrics AI Generator
              </h3>
              <span className="text-xs font-mono text-slate-400 tabular-nums">{bpm} BPM</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Genre</label>
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D10] border border-[#232833] text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option>Afrobeats</option>
                  <option>Amapiano</option>
                  <option>Hip-Hop / Trap</option>
                  <option>R&B Soul</option>
                  <option>House / Afro-Tech</option>
                  <option>Dancehall</option>
                  <option>Pop</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Mood / Energy</label>
                <input
                  type="text"
                  value={mood}
                  onChange={(e) => setMood(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D10] border border-[#232833] text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Song Concept & Hook Prompt</label>
              <textarea
                rows={2}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0B0D10] border border-[#232833] text-xs text-slate-100 focus:outline-none focus:border-amber-500"
              />
            </div>

            <button
              type="button"
              onClick={handleGenerateLyrics}
              disabled={lyricsLoading}
              className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>{lyricsLoading ? 'Composing Lyrics & Cadence...' : 'Generate Rhythm-Locked Lyrics'}</span>
            </button>
          </div>

          {/* Generated Lyrics Display */}
          <div className="rounded-lg bg-[#0B0D10] border border-[#232833] p-4 min-h-[260px] max-h-[340px] overflow-y-auto">
            {lyricsLoading ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 w-1/2 bg-[#1B2028] rounded" />
                <div className="h-3 w-full bg-[#1B2028] rounded" />
                <div className="h-3 w-5/6 bg-[#1B2028] rounded" />
                <div className="h-3 w-3/4 bg-[#1B2028] rounded" />
              </div>
            ) : lyricsData ? (
              <div className="space-y-4">
                <div className="border-b border-[#232833] pb-2">
                  <div className="font-display text-sm font-bold text-slate-100">
                    {lyricsData.title}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {lyricsData.keySignature} · {lyricsData.hookSummary}
                  </div>
                </div>
                {lyricsData.sections.map((sec, sIdx) => (
                  <div key={sIdx} className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono text-amber-400">
                      <span>{sec.name}</span>
                      <span className="text-slate-500">{sec.deliveryTip}</span>
                    </div>
                    {sec.bars.map((bar, bIdx) => (
                      <div key={bIdx} className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="text-slate-200 leading-relaxed">{bar.line}</span>
                        <span className="text-[10px] font-mono text-slate-500 shrink-0 tabular-nums">
                          {bar.syllables}syl · {bar.beatCue}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center py-12 text-xs text-slate-500">
                <p>Enter your genre, tempo, and story to generate syllable-mapped verses and choruses.</p>
              </div>
            )}
          </div>
        </div>

        {/* Beats & Instrumental Pads + Step Sequencer */}
        <div className="xl:col-span-7 rounded-xl bg-[#13161B] border border-[#232833] p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-100">
                Beats & Instrumental Pads
              </h3>
              <p className="text-xs text-slate-400">
                Tap pads or press keyboard keys (1–4, Q–R, A–F, Z–V) · Toggle 16-step groove grid
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0B0D10] border border-[#232833]">
                {(['afrobeats', 'trap', 'house', 'lofi'] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleLoadPreset(preset)}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium capitalize transition-colors ${
                      kitPreset === preset
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Transport & Tempo Controls */}
          <div className="flex flex-wrap items-center gap-4 p-3 rounded-lg bg-[#0B0D10] border border-[#232833]">
            <button
              type="button"
              onClick={() => setIsPlayingSeq((p) => !p)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                isPlayingSeq
                  ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                  : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
              }`}
            >
              {isPlayingSeq ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPlayingSeq ? 'Stop Beat' : 'Play Loop'}</span>
            </button>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">BPM</span>
              <input
                type="range"
                min={50}
                max={200}
                value={Math.max(50, Math.min(200, bpm))}
                onChange={(e) => setBpm(Number(e.target.value))}
                className="studio-slider w-24"
              />
              <span className="font-mono text-amber-400 w-8 tabular-nums">{bpm}</span>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Swing</span>
              <input
                type="range"
                min={0}
                max={25}
                value={swingPct}
                onChange={(e) => setSwingPct(Number(e.target.value))}
                className="studio-slider w-20"
              />
              <span className="font-mono text-slate-300 w-8 tabular-nums">{swingPct}%</span>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Gain</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={masterVol}
                onChange={(e) => setMasterVol(Number(e.target.value))}
                className="studio-slider w-20"
              />
            </div>

            <button
              type="button"
              onClick={handleExportBeatWav}
              disabled={exportingWav}
              className="ml-auto px-3 py-2 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-slate-100 text-xs font-medium border border-[#2A313E] flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>{exportingWav ? 'Rendering...' : 'Export .WAV'}</span>
            </button>
          </div>

          {/* Discover Custom Sample Pad Mapper */}
          <div className="p-3.5 rounded-lg bg-[#0B0D10] border border-[#232833] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Music2 className="w-3.5 h-3.5 text-amber-400" />
                <span>Discover Pad Sampler</span>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {padAssignments.length} custom pad{padAssignments.length === 1 ? '' : 's'} active
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={mapperSampleKey}
                onChange={(e) => setMapperSampleKey(e.target.value)}
                aria-label="Choose Discover sample"
                className="flex-1 min-w-[160px] px-2.5 py-1.5 rounded bg-[#13161B] border border-[#232833] text-xs text-slate-100"
              >
                {DISCOVER_CATALOG_TRACKS.map((t) => (
                  <option key={t.id} value={t.id}>
                    Discover: {t.title} ({t.bpm} BPM)
                  </option>
                ))}
                {discoverCustomSamples.map((s) => (
                  <option key={s.id} value={s.id}>
                    Uploaded: {s.title}
                  </option>
                ))}
              </select>

              <select
                value={mapperPadId}
                onChange={(e) => setMapperPadId(e.target.value as DrumPadId)}
                aria-label="Target beat pad"
                className="px-2.5 py-1.5 rounded bg-[#13161B] border border-[#232833] text-xs text-slate-100"
              >
                {DRUM_PADS.map((p) => (
                  <option key={p.id} value={p.id}>
                    Pad [{p.keyBind}] {p.label}
                  </option>
                ))}
              </select>

              <select
                value={mapperSliceSec}
                onChange={(e) => setMapperSliceSec(Number(e.target.value))}
                aria-label="Sample chop start offset"
                className="px-2.5 py-1.5 rounded bg-[#13161B] border border-[#232833] text-xs text-slate-100 font-mono"
              >
                <option value={0}>0.0s</option>
                <option value={0.5}>0.5s</option>
                <option value={1.0}>1.0s</option>
                <option value={1.5}>1.5s</option>
              </select>

              <button
                type="button"
                onClick={handleAssignDiscoverSampleHere}
                disabled={assigningPad}
                className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold whitespace-nowrap disabled:opacity-50"
              >
                {assigningPad ? 'Mapping...' : 'Assign Sample'}
              </button>
            </div>

            {padAssignments.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {padAssignments.map((assignment) => {
                  const padInfo = DRUM_PADS.find((p) => p.id === assignment.padId);
                  return (
                    <div
                      key={assignment.padId}
                      className="flex items-center gap-2 px-2.5 py-1 rounded bg-[#13161B] border border-amber-500/35 text-[11px]"
                    >
                      <button
                        type="button"
                        onClick={() => handleTriggerPad(assignment.padId as DrumPadId)}
                        className="text-amber-300 hover:text-amber-200 font-medium truncate max-w-[180px]"
                      >
                        [{padInfo?.keyBind}] {assignment.sampleName} ({assignment.sliceStartSec.toFixed(1)}s)
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemovePadAssignment(assignment.padId as DrumPadId)}
                        className="text-slate-500 hover:text-red-400"
                        aria-label={`Restore default ${padInfo?.label} synth`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 16 MPC Drum & Synth Pads */}
          <div className="grid grid-cols-4 gap-2.5">
            {DRUM_PADS.map((pad) => {
              const isLit = activePad === pad.id;
              const assigned = assignmentByPad.get(pad.id);
              return (
                <button
                  key={pad.id}
                  type="button"
                  onMouseDown={() => handleTriggerPad(pad.id)}
                  className={`p-3 rounded-lg border text-left transition-transform active:scale-95 ${
                    isLit
                      ? 'bg-amber-500 text-slate-950 border-amber-300'
                      : assigned
                      ? 'bg-[#171C25] hover:bg-[#1F2632] border-amber-500/50 text-slate-100'
                      : 'bg-[#0B0D10] hover:bg-[#1B2028] border-[#232833] text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-mono opacity-75">
                    <span>{assigned ? 'sample' : pad.category}</span>
                    <span>[{pad.keyBind}]</span>
                  </div>
                  <div className="text-xs font-semibold mt-1 truncate">
                    {assigned ? assigned.sampleName : pad.label}
                  </div>
                </button>
              );
            })}
          </div>

          {/* 16-Step Pattern Grid */}
          <div className="space-y-1.5 overflow-x-auto pt-1">
            {[
              ...SEQUENCER_LANES.slice(0, 5),
              ...padAssignments
                .filter((a) => !SEQUENCER_LANES.slice(0, 5).some((l) => l.id === a.padId))
                .map((a) => ({
                  id: a.padId as DrumPadId,
                  label: a.sampleName,
                })),
            ].map((lane) => {
              const row = pattern[lane.id] || Array(16).fill(false);
              const assigned = assignmentByPad.get(lane.id);
              return (
                <div key={lane.id} className="flex items-center gap-2 min-w-[540px]">
                  <span className="w-24 text-[11px] font-mono text-slate-400 truncate shrink-0">
                    {assigned ? assigned.sampleName : lane.label}
                  </span>
                  <div className="grid grid-cols-16 gap-1 flex-1">
                    {row.map((active, stepIdx) => {
                      const isCurrent = isPlayingSeq && currentStep === stepIdx;
                      return (
                        <button
                          key={stepIdx}
                          type="button"
                          onClick={() => toggleStep(lane.id, stepIdx)}
                          aria-label={`${lane.label} step ${stepIdx + 1}`}
                          className={`h-6 rounded-sm border transition-colors ${
                            active
                              ? isCurrent
                                ? 'bg-amber-300 border-white'
                                : 'bg-amber-500 border-amber-400'
                              : isCurrent
                              ? 'bg-[#252B36] border-amber-500/60'
                              : stepIdx % 4 === 0
                              ? 'bg-[#161B23] border-[#262D3A]'
                              : 'bg-[#0B0D10] border-[#1F242F]'
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Section 2: Voice Alignment AI Assistant */}
      <div className="rounded-xl bg-[#13161B] border border-[#232833] p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-100">
              Voice Alignment AI Assistant
            </h3>
            <p className="text-xs text-slate-400">
              Record vocals over your beat or upload a vocal take to analyze rhythmic pocket drift and apply millisecond beat-grid alignment.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isRecordingVocal ? (
              <button
                type="button"
                onClick={handleStartVocalRecord}
                className="px-3.5 py-2 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-slate-100 text-xs font-medium border border-[#2A313E] flex items-center gap-1.5"
              >
                <Mic className="w-3.5 h-3.5 text-amber-400" />
                <span>Record Vocal Take</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopVocalRecord}
                className="px-3.5 py-2 rounded-lg bg-red-500/20 text-red-200 border border-red-500/50 text-xs font-semibold flex items-center gap-1.5"
              >
                <MicOff className="w-3.5 h-3.5" />
                <span>Stop Recording</span>
              </button>
            )}

            <label className="px-3.5 py-2 rounded-lg bg-[#0B0D10] hover:bg-[#1B2028] text-slate-300 text-xs font-medium border border-[#232833] flex items-center gap-1.5 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Vocal</span>
              <input type="file" accept="audio/*" onChange={handleUploadVocalFile} className="hidden" />
            </label>

            <button
              type="button"
              onClick={handleAnalyzeAlignment}
              disabled={alignLoading}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{alignLoading ? 'Analyzing Pocket...' : 'Run AI Beat Alignment'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-7 space-y-3">
            <canvas
              ref={alignCanvasRef}
              width={720}
              height={120}
              className="w-full h-28 rounded-lg border border-[#232833] bg-[#0B0D10]"
            />
            <div className="flex flex-wrap items-center justify-between gap-4 p-3 rounded-lg bg-[#0B0D10] border border-[#232833]">
              <div className="flex items-center gap-3 text-xs">
                <span className="text-slate-400">Timing Nudge:</span>
                <input
                  type="range"
                  min={-250}
                  max={250}
                  step={5}
                  value={vocalOffsetMs}
                  onChange={(e) => setVocalOffsetMs(Number(e.target.value))}
                  className="studio-slider w-36"
                />
                <span className="font-mono text-amber-400 w-16 tabular-nums">
                  {vocalOffsetMs > 0 ? `+${vocalOffsetMs}` : vocalOffsetMs} ms
                </span>
              </div>

              <button
                type="button"
                onClick={handleAuditionAlignedMix}
                disabled={!vocalBuffer || auditioningMix}
                className="px-3.5 py-1.5 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-slate-100 text-xs font-medium border border-[#2A313E] flex items-center gap-1.5 disabled:opacity-40"
              >
                <Play className="w-3.5 h-3.5 text-amber-400" />
                <span>{auditioningMix ? 'Playing Aligned Mix...' : 'Audition Beat + Vocal'}</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-lg bg-[#0B0D10] border border-[#232833] p-4 space-y-3 min-h-[168px]">
            {alignmentResult ? (
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-amber-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>AI Alignment Report</span>
                  </span>
                  <span className="font-mono text-slate-300 tabular-nums">
                    Nudge: {alignmentResult.recommendedOffsetMs} ms
                  </span>
                </div>
                <p className="text-slate-300 leading-relaxed">{alignmentResult.pocketDiagnosis}</p>
                <ul className="space-y-1 text-slate-400 list-disc pl-4">
                  {alignmentResult.cadenceTips.slice(0, 3).map((tip, idx) => (
                    <li key={idx}>{tip}</li>
                  ))}
                </ul>
                <div className="pt-2 border-t border-[#232833] text-[11px] font-mono text-slate-400">
                  Chain: HPF {alignmentResult.mixingChain.highPassHz}Hz · EQ {alignmentResult.mixingChain.presenceBoostDb} · Comp {alignmentResult.mixingChain.compressorRatio} · Verb {alignmentResult.mixingChain.reverbDecaySec}
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col justify-center text-xs text-slate-500 space-y-1">
                <p className="text-slate-300 font-medium">Ready for vocal timing inspection</p>
                <p>
                  Record or upload a vocal take, then run AI Beat Alignment to snap vocal phrasing to the {bpm} BPM grid.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 3: AI Music Generator (Lyria 3 Clip & Pro) */}
      <div className="rounded-xl bg-[#13161B] border border-[#232833] p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>AI Music Generator (Lyria)</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Synthesize 30-second hooks (<span className="font-mono text-slate-300">lyria-3-clip-preview</span>) or full-length tracks (<span className="font-mono text-slate-300">lyria-3-pro-preview</span>) from text or cover art.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0B0D10] border border-[#232833]">
              <button
                type="button"
                onClick={() => setLyriaMode('clip')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  lyriaMode === 'clip'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                30s Clip (Lyria Clip)
              </button>
              <button
                type="button"
                onClick={() => setLyriaMode('pro')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  lyriaMode === 'pro'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Full Track (Lyria Pro)
              </button>
            </div>
            {onOpen3DStage && (
              <button
                type="button"
                onClick={onOpen3DStage}
                className="px-3 py-2 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-slate-100 text-xs font-medium border border-[#2A313E] flex items-center gap-1.5"
              >
                <Box className="w-3.5 h-3.5 text-amber-400" />
                <span>Visualize in 3D Stage</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-6 space-y-3">
            <textarea
              rows={3}
              value={lyriaPrompt}
              onChange={(e) => setLyriaPrompt(e.target.value)}
              placeholder="Describe instruments, groove, vocal style, drop energy, and atmosphere..."
              className="w-full px-3 py-2.5 rounded-lg bg-[#0B0D10] border border-[#232833] text-xs text-slate-100 focus:outline-none focus:border-amber-500"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="px-3 py-2 rounded-lg bg-[#0B0D10] hover:bg-[#1B2028] text-slate-300 text-xs font-medium border border-[#232833] flex items-center gap-1.5 cursor-pointer">
                <ImagePlus className="w-3.5 h-3.5 text-amber-400" />
                <span>{lyriaImagePreview ? 'Change Cover Art' : 'Optional Inspiration Image'}</span>
                <input type="file" accept="image/*" onChange={handleLyriaImageSelect} className="hidden" />
              </label>

              {lyriaImagePreview && (
                <button
                  type="button"
                  onClick={() => {
                    setLyriaImagePreview(null);
                    setLyriaImageBase64(null);
                    setLyriaImageMime(null);
                  }}
                  className="text-xs text-slate-400 hover:text-red-400"
                >
                  Remove image
                </button>
              )}

              <button
                type="button"
                onClick={handleGenerateLyriaMusic}
                disabled={lyriaLoading}
                className="ml-auto px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {lyriaLoading
                    ? `Synthesizing (${lyriaMode === 'pro' ? 'Lyria Pro' : '30s Clip'})...`
                    : `Generate ${lyriaMode === 'pro' ? 'Full Track' : '30s Music Clip'}`}
                </span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-6 rounded-lg bg-[#0B0D10] border border-[#232833] p-4 space-y-3 min-h-[146px]">
            {lyriaAudioUrl ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-amber-400">
                    Ready · {lyriaModelUsed}
                  </span>
                  <a
                    href={lyriaAudioUrl}
                    download={`sounddeck-lyria-${lyriaMode}-${bpm}bpm.mp3`}
                    className="text-slate-300 hover:text-amber-300 flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download MP3</span>
                  </a>
                </div>
                <audio
                  ref={lyriaAudioElRef}
                  src={lyriaAudioUrl}
                  controls
                  onPlay={() => attachMediaElementToAnalyser(lyriaAudioElRef.current)}
                  className="w-full h-9"
                />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <select
                    value={lyriaPadTarget}
                    onChange={(e) => setLyriaPadTarget(e.target.value as DrumPadId)}
                    aria-label="Target pad for Lyria chop"
                    className="px-2.5 py-1.5 rounded bg-[#13161B] border border-[#232833] text-xs text-slate-100"
                  >
                    {DRUM_PADS.map((p) => (
                      <option key={p.id} value={p.id}>
                        Pad [{p.keyBind}] {p.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleSendLyriaToBeatPad}
                    className="px-3 py-1.5 rounded bg-[#1B2028] hover:bg-[#252B36] text-amber-300 text-xs font-medium border border-amber-500/35"
                  >
                    Chop First 1.6s to Beat Pad
                  </button>
                </div>
                {lyriaLyrics && (
                  <div className="p-2.5 rounded bg-[#13161B] border border-[#232833] text-[11px] text-slate-300 max-h-28 overflow-y-auto whitespace-pre-wrap">
                    {lyriaLyrics}
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col justify-center text-xs text-slate-500 space-y-1 py-4">
                <p className="text-slate-300 font-medium">No generated track yet</p>
                <p>
                  Enter your production prompt and choose 30s Clip or Full Track. Output streams straight into an audio player and can be chopped onto any beat pad.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Saved Studio Sessions */}
      {projects.length > 0 && (
        <div className="rounded-xl bg-[#13161B] border border-[#232833] p-5 space-y-3">
          <h3 className="font-display text-sm font-semibold text-slate-100">
            Saved Studio Sessions ({projects.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {projects.map((proj) => (
              <div
                key={proj.id}
                className="p-3.5 rounded-lg bg-[#0B0D10] border border-[#232833] flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-100 truncate">{proj.title}</div>
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5 tabular-nums">
                    {proj.genre} · {proj.bpm} BPM
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeMusicProject(proj.id)}
                  className="p-1.5 rounded text-slate-500 hover:text-red-400 transition-colors"
                  aria-label={`Delete ${proj.title}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
