import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { CupSoda, UserCircle2, Music, Disc3, Box, Clock4 } from 'lucide-react';
import {
  auth,
  getCreatorProfile,
  getPrivateInfo,
  subscribeUserProjects,
  subscribeUserCampaigns,
  subscribePublicCreators,
  subscribeMySodaSupports,
  subscribeUserPadAssignments,
  savePadSampleAssignment,
  removePadSampleAssignment,
  type CreatorProfile,
  type CreatorPrivateInfo,
  type SavedMusicProject,
  type SavedSocialCampaign,
  type SodaSupportRecord,
  type PadSampleAssignment,
} from './firebase';
import {
  type DrumPadId,
  type BeatSignature,
  BEAT_SIGNATURE_CONFIG,
  getAudioContext,
  getStudioMasterNode,
  triggerMetronomeClick,
  renderDiscoverSampleSlice,
  renderGrooveBuffer,
  audioBufferToWavBlob,
  sliceAudioBuffer,
  encodeAudioBufferSliceToBase64Wav,
  decodeBase64WavToBuffer,
} from './audio/studioAudio';
import { type DiscoverCatalogTrack } from './audio/discoverCatalog';
import {
  type GlobalSearchTrack,
  type YoutubeMatchItem,
  type PersistentPlayerState,
} from './types/discoverPlayer';
import { SplashScreen } from './components/SplashScreen';
import { AuthModal } from './components/AuthModal';
import { BuyMeSodaModal } from './components/BuyMeSodaModal';
import { SocialHubTab } from './components/tabs/SocialHubTab';
import { MusicCreationTab } from './components/tabs/MusicCreationTab';
import { DawTab } from './components/tabs/DawTab';
import { VirtualDjTab } from './components/tabs/VirtualDjTab';
import { DiscoverTab } from './components/tabs/DiscoverTab';
import { StudioStage3D } from './components/StudioStage3D';
import { StudioChatBot } from './components/StudioChatBot';
import { PersistentAudioPlayer } from './components/PersistentAudioPlayer';

type TabId = 'social' | 'creation' | 'daw' | 'vdj' | 'discover';

const TABS: { id: TabId; label: string }[] = [
  { id: 'social', label: 'Social Hub' },
  { id: 'creation', label: 'Music Creation' },
  { id: 'daw', label: 'DAW' },
  { id: 'vdj', label: 'Virtual DJ' },
  { id: 'discover', label: 'Discover' },
];

const HERO_IMG = '/src/assets/images/studio_hero_backdrop_1794573516682.jpg';

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('creation');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [sodaModalOpen, setSodaModalOpen] = useState(false);
  const [sodaRecipient, setSodaRecipient] = useState<{
    handle: string;
    name: string;
    role: 'artist' | 'creator' | 'dj' | 'owner';
  }>({
    handle: 'sounddeck-owner',
    name: 'Webapp Owner',
    role: 'owner',
  });

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [privateInfo, setPrivateInfo] = useState<CreatorPrivateInfo | null>(null);
  const [projects, setProjects] = useState<SavedMusicProject[]>([]);
  const [campaigns, setCampaigns] = useState<SavedSocialCampaign[]>([]);
  const [creators, setCreators] = useState<CreatorProfile[]>([]);
  const [mySodaSupports, setMySodaSupports] = useState<SodaSupportRecord[]>([]);
  const [padAssignments, setPadAssignments] = useState<PadSampleAssignment[]>([]);
  const [padSampleBuffers, setPadSampleBuffers] = useState<Partial<Record<DrumPadId, AudioBuffer>>>({});
  const [discoverCustomSamples, setDiscoverCustomSamples] = useState<
    { id: string; title: string; buffer: AudioBuffer }[]
  >([]);
  const [activeTrackTitle, setActiveTrackTitle] = useState('Midnight Studio Loop');
  const [studioBpm, setStudioBpm] = useState(112);
  const [stage3DOpen, setStage3DOpen] = useState(false);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [beatSignature, setBeatSignature] = useState<BeatSignature>('4/4');
  const [metronomeBeat, setMetronomeBeat] = useState(0);
  const [metronomePulse, setMetronomePulse] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const [tapFlash, setTapFlash] = useState(false);
  const [persistentPlayer, setPersistentPlayer] = useState<PersistentPlayerState | null>(null);
  const studioBpmRef = useRef(112);
  const tapTimestampsRef = useRef<number[]>([]);
  const tapResetTimerRef = useRef<number | null>(null);
  const catalogBlobUrlRef = useRef<string | null>(null);
  studioBpmRef.current = studioBpm;

  useEffect(() => {
    return () => {
      if (catalogBlobUrlRef.current) {
        URL.revokeObjectURL(catalogBlobUrlRef.current);
      }
    };
  }, []);

  const resolveAndPlayFullStream = async (
    track: GlobalSearchTrack,
    cachedVersions?: YoutubeMatchItem[]
  ) => {
    if (track.source === 'soundcloud' && track.soundcloudPermalink) {
      setPersistentPlayer({
        track,
        mode: 'full',
        youtubeVersions: [],
        activeYoutubeVideoId: null,
        activeSoundCloudPermalink: track.soundcloudPermalink,
        loadingFullStream: Boolean(track.soundcloudTrackId),
      });

      if (track.soundcloudTrackId) {
        try {
          const res = await fetch(
            `/api/discover/soundcloud-stream?trackId=${encodeURIComponent(
              String(track.soundcloudTrackId)
            )}`
          );
          const data = (await res.json()) as { streamUrl?: string | null };
          setPersistentPlayer((prev) => {
            if (!prev || prev.track.id !== track.id) return prev;
            if (data.streamUrl) {
              return {
                ...prev,
                track: { ...prev.track, fullAudioUrl: data.streamUrl },
                activeSoundCloudPermalink: null,
                loadingFullStream: false,
              };
            }
            return { ...prev, loadingFullStream: false };
          });
        } catch {
          setPersistentPlayer((prev) =>
            prev && prev.track.id === track.id ? { ...prev, loadingFullStream: false } : prev
          );
        }
      }
      return;
    }

    if (track.youtubeVideoId) {
      setPersistentPlayer({
        track,
        mode: 'full',
        youtubeVersions: cachedVersions || [],
        activeYoutubeVideoId: track.youtubeVideoId,
        activeSoundCloudPermalink: null,
        loadingFullStream: false,
      });
      return;
    }

    setPersistentPlayer({
      track,
      mode: 'full',
      youtubeVersions: cachedVersions || [],
      activeYoutubeVideoId: cachedVersions?.[0]?.videoId || null,
      activeSoundCloudPermalink: null,
      loadingFullStream: true,
    });

    try {
      const q = `${track.artist} ${track.title} audio`;
      const res = await fetch(`/api/discover/full-track?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { versions?: YoutubeMatchItem[] };
      const versions = data.versions || [];
      setPersistentPlayer((prev) =>
        prev && prev.track.id === track.id
          ? {
              ...prev,
              youtubeVersions: versions,
              activeYoutubeVideoId: versions[0]?.videoId || null,
              loadingFullStream: false,
            }
          : prev
      );
    } catch {
      setPersistentPlayer((prev) =>
        prev && prev.track.id === track.id ? { ...prev, loadingFullStream: false } : prev
      );
    }
  };

  const handlePlayDiscoverTrack = (
    track: GlobalSearchTrack,
    requestedMode: 'preview' | 'full',
    cachedVersions?: YoutubeMatchItem[]
  ) => {
    const effectiveMode: 'preview' | 'full' =
      requestedMode === 'preview' && !track.previewUrl && !track.fullAudioUrl
        ? 'full'
        : requestedMode;

    if (effectiveMode === 'preview' || track.fullAudioUrl) {
      setPersistentPlayer({
        track,
        mode: effectiveMode,
        youtubeVersions: cachedVersions || [],
        activeYoutubeVideoId: track.youtubeVideoId || cachedVersions?.[0]?.videoId || null,
        activeSoundCloudPermalink: null,
        loadingFullStream: false,
      });
      return;
    }

    resolveAndPlayFullStream(track, cachedVersions);
  };

  const handlePlayCatalogTrack = async (catalogTrack: DiscoverCatalogTrack) => {
    const buf = await renderGrooveBuffer(catalogTrack.grooveStyle, catalogTrack.bpm, 4);
    const wavBlob = audioBufferToWavBlob(buf);
    if (catalogBlobUrlRef.current) {
      URL.revokeObjectURL(catalogBlobUrlRef.current);
    }
    const blobUrl = URL.createObjectURL(wavBlob);
    catalogBlobUrlRef.current = blobUrl;

    const syntheticTrack: GlobalSearchTrack = {
      id: catalogTrack.id,
      title: catalogTrack.title,
      artist: catalogTrack.artist,
      album: `${catalogTrack.genre} · ${catalogTrack.bpm} BPM`,
      genre: catalogTrack.genre,
      durationSec: Math.round(buf.duration),
      coverUrl: catalogTrack.coverUrl,
      previewUrl: blobUrl,
      source: 'catalog',
      score: 100,
    };

    setPersistentPlayer({
      track: syntheticTrack,
      mode: 'preview',
      youtubeVersions: [],
      activeYoutubeVideoId: null,
      loadingFullStream: false,
    });
  };

  const handleTapTempo = () => {
    const now = performance.now();
    const prevTaps = tapTimestampsRef.current;
    const isFreshSequence = prevTaps.length > 0 && now - prevTaps[prevTaps.length - 1] > 2000;
    const nextTaps = isFreshSequence ? [now] : [...prevTaps, now].slice(-4);
    tapTimestampsRef.current = nextTaps;
    setTapCount(nextTaps.length);

    if (nextTaps.length >= 2) {
      const totalElapsedMs = nextTaps[nextTaps.length - 1] - nextTaps[0];
      const avgIntervalMs = totalElapsedMs / (nextTaps.length - 1);
      if (avgIntervalMs > 0) {
        const computedBpm = Math.round(60000 / avgIntervalMs);
        const clampedBpm = Math.max(40, Math.min(240, computedBpm));
        setStudioBpm(clampedBpm);
      }
    }

    setTapFlash(true);
    window.setTimeout(() => setTapFlash(false), 110);

    if (tapResetTimerRef.current) {
      window.clearTimeout(tapResetTimerRef.current);
    }
    tapResetTimerRef.current = window.setTimeout(() => {
      tapTimestampsRef.current = [];
      setTapCount(0);
    }, 2200);
  };

  useEffect(() => {
    return () => {
      if (tapResetTimerRef.current) {
        window.clearTimeout(tapResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!metronomeOn) {
      setMetronomeBeat(0);
      setMetronomePulse(false);
      return;
    }

    const { beatsPerMeasure, subdivisionFactor } = BEAT_SIGNATURE_CONFIG[beatSignature];
    const ctx = getAudioContext();
    const masterDest = getStudioMasterNode(ctx);
    let nextNoteTime = ctx.currentTime + 0.04;
    let beatIndex = 0;
    const lookaheadMs = 25;
    const scheduleAheadSec = 0.1;
    const uiTimers: number[] = [];

    const scheduler = window.setInterval(() => {
      const currentBpm = Math.max(40, Math.min(240, studioBpmRef.current || 112));
      const secondsPerBeat = (60 / currentBpm) * subdivisionFactor;

      while (nextNoteTime < ctx.currentTime + scheduleAheadSec) {
        const beatInBar = beatIndex % beatsPerMeasure;
        const isFirstBeat = beatInBar === 0;
        triggerMetronomeClick(ctx, masterDest, nextNoteTime, isFirstBeat, 0.55);

        const delayMs = Math.max(0, (nextNoteTime - ctx.currentTime) * 1000);
        const capturedBeat = beatInBar + 1;
        const pulseMs = Math.min(130, Math.max(55, Math.round(secondsPerBeat * 320)));
        const tId = window.setTimeout(() => {
          setMetronomeBeat(capturedBeat);
          setMetronomePulse(true);
          const offId = window.setTimeout(() => {
            setMetronomePulse(false);
          }, pulseMs);
          uiTimers.push(offId);
        }, delayMs);
        uiTimers.push(tId);

        nextNoteTime += secondsPerBeat;
        beatIndex += 1;
      }
    }, lookaheadMs);

    return () => {
      window.clearInterval(scheduler);
      uiTimers.forEach((id) => window.clearTimeout(id));
    };
  }, [metronomeOn, beatSignature]);

  const refreshProfileData = async (uid: string) => {
    try {
      const [prof, priv] = await Promise.all([getCreatorProfile(uid), getPrivateInfo(uid)]);
      setProfile(prof);
      setPrivateInfo(priv);
    } catch {
      // Handled via structured error logger in firebase.ts
    }
  };

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      if (currentUser) {
        refreshProfileData(currentUser.uid);
      } else {
        setProfile(null);
        setPrivateInfo(null);
        setProjects([]);
        setCampaigns([]);
        setCreators([]);
        setMySodaSupports([]);
        setPadAssignments([]);
        setPadSampleBuffers({});
      }
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
    const unsubProj = subscribeUserProjects(user.uid, setProjects);
    const unsubCamp = subscribeUserCampaigns(user.uid, setCampaigns);
    const unsubCreators = subscribePublicCreators(setCreators);
    const unsubSoda = subscribeMySodaSupports(user.uid, setMySodaSupports);
    const unsubPads = subscribeUserPadAssignments(user.uid, setPadAssignments);
    return () => {
      unsubProj();
      unsubCamp();
      unsubCreators();
      unsubSoda();
      unsubPads();
    };
  }, [authReady, user]);

  // Hydrate AudioBuffers whenever Firestore padAssignments sync
  useEffect(() => {
    let cancelled = false;
    async function hydrateBuffers() {
      const nextMap: Partial<Record<DrumPadId, AudioBuffer>> = {};
      const ctx = getAudioContext();
      await Promise.all(
        padAssignments.map(async (item) => {
          try {
            if (item.sourceType === 'custom_audio' && item.audioBase64) {
              nextMap[item.padId as DrumPadId] = await decodeBase64WavToBuffer(ctx, item.audioBase64);
            } else {
              nextMap[item.padId as DrumPadId] = await renderDiscoverSampleSlice(
                item.grooveStyle,
                item.bpm,
                item.sliceStartSec,
                item.sliceDurationSec
              );
            }
          } catch {
            // Skip malformed buffer without crashing hydration
          }
        })
      );
      if (!cancelled) {
        setPadSampleBuffers(nextMap);
      }
    }
    hydrateBuffers();
    return () => {
      cancelled = true;
    };
  }, [padAssignments]);

  const handleAssignSampleToPad = async (params: {
    padId: DrumPadId;
    sampleName: string;
    sourceType: 'catalog' | 'custom_audio';
    sourceTrackId: string;
    grooveStyle: 'afro' | 'house' | 'trap';
    bpm: number;
    sliceStartSec: number;
    sliceDurationSec: number;
    rawBuffer?: AudioBuffer;
  }): Promise<{ savedToCloud: boolean }> => {
    let hydratedBuffer: AudioBuffer;
    let audioBase64: string | undefined;

    if (params.sourceType === 'custom_audio' && params.rawBuffer) {
      hydratedBuffer = await sliceAudioBuffer(
        params.rawBuffer,
        params.sliceStartSec,
        params.sliceDurationSec
      );
      audioBase64 = await encodeAudioBufferSliceToBase64Wav(
        params.rawBuffer,
        params.sliceStartSec,
        Math.min(1.8, params.sliceDurationSec)
      );
    } else {
      hydratedBuffer = await renderDiscoverSampleSlice(
        params.grooveStyle,
        params.bpm,
        params.sliceStartSec,
        params.sliceDurationSec
      );
    }

    setPadSampleBuffers((prev) => ({ ...prev, [params.padId]: hydratedBuffer }));

    if (user) {
      await savePadSampleAssignment(user.uid, {
        padId: params.padId,
        sampleName: params.sampleName,
        sourceType: params.sourceType,
        sourceTrackId: params.sourceTrackId,
        grooveStyle: params.grooveStyle,
        bpm: params.bpm,
        sliceStartSec: params.sliceStartSec,
        sliceDurationSec: params.sliceDurationSec,
        audioBase64,
      });
      return { savedToCloud: true };
    }

    // Session-local assignment when signed out
    setPadAssignments((prev) => {
      const filtered = prev.filter((a) => a.padId !== params.padId);
      return [
        {
          id: `local_${params.padId}`,
          ownerId: 'local',
          padId: params.padId,
          sampleName: params.sampleName,
          sourceType: params.sourceType,
          sourceTrackId: params.sourceTrackId,
          grooveStyle: params.grooveStyle,
          bpm: params.bpm,
          sliceStartSec: params.sliceStartSec,
          sliceDurationSec: params.sliceDurationSec,
          audioBase64,
        },
        ...filtered,
      ];
    });
    return { savedToCloud: false };
  };

  const handleRemovePadAssignment = async (padId: DrumPadId) => {
    setPadSampleBuffers((prev) => {
      const copy = { ...prev };
      delete copy[padId];
      return copy;
    });
    if (user) {
      await removePadSampleAssignment(user.uid, padId);
    } else {
      setPadAssignments((prev) => prev.filter((a) => a.padId !== padId));
    }
  };

  const openSodaSupport = (recipient?: {
    handle: string;
    name: string;
    role: 'artist' | 'creator' | 'dj' | 'owner';
  }) => {
    if (recipient) {
      setSodaRecipient(recipient);
    } else {
      setSodaRecipient({
        handle: 'sounddeck-owner',
        name: 'Webapp Owner',
        role: 'owner',
      });
    }
    setSodaModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#0B0D10] text-slate-100 flex flex-col">
      {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}

      {/* 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-[#0B0D10]/95 backdrop-blur-md border-b border-[#232833]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single text wordmark */}
          <a
            href="#music-page"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('creation');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
          >
            SoundDeck Studio
          </a>

          {/* Zone 2: 5 concise single-line workspace tabs */}
          <nav className="hidden lg:flex items-center gap-6" aria-label="Music studio workspaces">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'border-amber-500 text-amber-400'
                      : 'border-transparent text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Global Metronome + Beat Signature + Tap Tempo + Primary Account CTA */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center rounded-lg border border-[#232833] bg-[#13161B] shrink-0">
              <button
                type="button"
                onClick={() => setMetronomeOn((prev) => !prev)}
                aria-pressed={metronomeOn}
                aria-label={`Toggle global metronome at ${studioBpm} BPM in ${beatSignature}`}
                className={`px-2.5 sm:px-3 py-2 rounded-l-lg text-xs font-medium border flex items-center gap-1.5 transition-all duration-100 ease-out motion-reduce:transform-none whitespace-nowrap shrink-0 tabular-nums ${
                  metronomeOn
                    ? metronomePulse
                      ? metronomeBeat === 1
                        ? 'scale-110 bg-amber-500/30 border-amber-300 text-amber-100 shadow-[0_0_16px_rgba(245,158,11,0.38)]'
                        : 'scale-105 bg-amber-500/25 border-amber-400 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.22)]'
                      : 'scale-100 bg-amber-500/15 border-amber-500/50 text-amber-300'
                    : 'scale-100 bg-[#13161B] hover:bg-[#1B2028] border-transparent text-slate-300'
                }`}
              >
                <Clock4
                  className={`w-3.5 h-3.5 transition-transform duration-100 ${
                    metronomeOn
                      ? metronomePulse
                        ? 'text-amber-200 scale-115'
                        : 'text-amber-400 scale-100'
                      : 'text-slate-400 scale-100'
                  }`}
                />
                <span>
                  {metronomeOn
                    ? `Click ${metronomeBeat || 1}/${BEAT_SIGNATURE_CONFIG[beatSignature].beatsPerMeasure}`
                    : 'Click'}
                </span>
                <span className="font-mono text-[11px] opacity-80">{studioBpm} BPM</span>
              </button>

              <select
                value={beatSignature}
                onChange={(e) => setBeatSignature(e.target.value as BeatSignature)}
                aria-label="Beat signature"
                title="Change metronome beat signature"
                className="px-2 py-2 bg-[#0F1217] hover:bg-[#1B2028] border-l border-[#232833] text-[11px] font-mono font-semibold text-amber-300 focus:outline-none focus:bg-[#1B2028] cursor-pointer shrink-0 tabular-nums"
              >
                {(Object.keys(BEAT_SIGNATURE_CONFIG) as BeatSignature[]).map((sig) => (
                  <option key={sig} value={sig} className="bg-[#13161B] text-slate-100">
                    {sig}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleTapTempo}
                aria-label="Tap tempo to set studio BPM from last 4 clicks"
                title="Tap at a steady pace to set BPM from the last 4 clicks"
                className={`px-2.5 py-2 rounded-r-lg border-l border-[#232833] text-[11px] font-mono font-semibold transition-all duration-100 whitespace-nowrap shrink-0 tabular-nums ${
                  tapFlash
                    ? 'bg-amber-500 text-slate-950 scale-95'
                    : tapCount > 0
                    ? 'bg-[#1B2028] text-amber-300 hover:bg-[#252B36]'
                    : 'bg-[#0F1217] text-slate-400 hover:text-slate-100 hover:bg-[#1B2028]'
                }`}
              >
                {tapCount > 0 ? `Tap ${tapCount}/4` : 'Tap'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <UserCircle2 className="w-4 h-4" />
              <span>
                {user
                  ? profile?.displayName || user.displayName || 'Studio Profile'
                  : 'Register / Sign In'}
              </span>
            </button>
          </div>
        </div>

        {/* Mobile/Tablet compact tab bar */}
        <nav
          className="lg:hidden flex items-center gap-2 px-4 py-2 border-t border-[#232833] overflow-x-auto"
          aria-label="Mobile studio navigation"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                activeTab === tab.id
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-100 bg-[#13161B]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Main Music Page Workspace */}
      <main id="music-page" className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Studio Hero & BuymeSoda Support Strip */}
        <section className="relative rounded-xl overflow-hidden border border-[#232833] bg-[#13161B]">
          <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
            <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between space-y-5">
              <div className="space-y-2">
                <div className="text-xs font-mono text-amber-400">
                  {profile?.role ? `${profile.role.toUpperCase()} WORKSPACE` : 'MUSIC PAGE'} · 5 INTEGRATED STUDIOS
                </div>
                <h1 className="font-display text-2xl sm:text-4xl font-bold text-slate-100 leading-tight max-w-xl">
                  Produce, Remix, Spin, and Share Your Sound
                </h1>
                <p className="text-sm text-slate-400 max-w-xl leading-relaxed">
                  Built for artists, content creators, and DJs — craft AI lyrics and beats, mix in the DAW and Virtual DJ booth, connect Social Hub &amp; Discover, and support creators via BuymeSoda.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => openSodaSupport()}
                  className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center gap-2 transition-colors whitespace-nowrap"
                >
                  <CupSoda className="w-4 h-4" />
                  <span>Support on BuymeSoda</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('vdj')}
                  className="px-4 py-2.5 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-slate-100 text-xs font-medium border border-[#2A313E] flex items-center gap-2 transition-colors whitespace-nowrap"
                >
                  <Disc3 className="w-4 h-4 text-amber-400" />
                  <span>Open DJ Console</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('creation')}
                  className="px-4 py-2.5 rounded-lg bg-[#0B0D10] hover:bg-[#1B2028] text-slate-300 text-xs font-medium border border-[#232833] flex items-center gap-2 transition-colors whitespace-nowrap"
                >
                  <Music className="w-4 h-4 text-amber-400" />
                  <span>AI Lyrics &amp; Beat Pads</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStage3DOpen(true)}
                  className="px-4 py-2.5 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-amber-300 text-xs font-semibold border border-amber-500/40 flex items-center gap-2 transition-colors whitespace-nowrap"
                >
                  <Box className="w-4 h-4 text-amber-400" />
                  <span>3D Mastering Stage</span>
                </button>
              </div>
            </div>

            <div className="lg:col-span-5 relative min-h-[220px] bg-[#0B0D10]">
              <img
                src={HERO_IMG}
                alt="SoundDeck Studio mastering console"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover lg:absolute lg:inset-0"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#13161B] via-[#13161B]/35 to-transparent lg:block hidden" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#13161B] via-transparent to-transparent lg:hidden" />
            </div>
          </div>
        </section>

        {/* Active Workspace Tab Viewport */}
        <section aria-live="polite">
          {activeTab === 'social' && (
            <SocialHubTab
              user={user}
              privateInfo={privateInfo}
              campaigns={campaigns}
              activeTrackTitle={activeTrackTitle}
              studioBpm={studioBpm}
              onOpenAuth={() => setAuthModalOpen(true)}
              onPrivateInfoSaved={() => user && refreshProfileData(user.uid)}
              onSupportCreator={(recipientName) =>
                openSodaSupport(
                  recipientName
                    ? {
                        handle: recipientName,
                        name: recipientName,
                        role: profile?.role || 'creator',
                      }
                    : undefined
                )
              }
            />
          )}

          {activeTab === 'creation' && (
            <MusicCreationTab
              user={user}
              projects={projects}
              padAssignments={padAssignments}
              padSampleBuffers={padSampleBuffers}
              discoverCustomSamples={discoverCustomSamples}
              onAssignSampleToPad={handleAssignSampleToPad}
              onRemovePadAssignment={handleRemovePadAssignment}
              onOpenAuth={() => setAuthModalOpen(true)}
              onActiveTrackChange={(t) => setActiveTrackTitle(t)}
              initialBpm={studioBpm}
              onBpmChange={(nextBpm) => setStudioBpm(nextBpm)}
              onOpen3DStage={() => setStage3DOpen(true)}
            />
          )}

          {activeTab === 'daw' && <DawTab />}

          {activeTab === 'vdj' && <VirtualDjTab userRole={profile?.role} />}

          {activeTab === 'discover' && (
            <DiscoverTab
              user={user}
              padAssignments={padAssignments}
              persistentPlayer={persistentPlayer}
              onPlayGlobalTrack={handlePlayDiscoverTrack}
              onPlayCatalogTrack={handlePlayCatalogTrack}
              onAssignSampleToPad={handleAssignSampleToPad}
              onRegisterCustomSample={(sample) =>
                setDiscoverCustomSamples((prev) => [
                  sample,
                  ...prev.filter((s) => s.id !== sample.id),
                ])
              }
              onNavigateToCreation={() => setActiveTab('creation')}
              onOpenAuth={() => setAuthModalOpen(true)}
              onSupportCreator={(recipient) => openSodaSupport(recipient)}
            />
          )}
        </section>

        {/* BuymeSoda Community & Owner Support Ledger */}
        <section className="rounded-xl bg-[#13161B] border border-[#232833] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-display text-base font-semibold text-slate-100 flex items-center gap-2">
              <CupSoda className="w-4 h-4 text-amber-400" />
              <span>BuymeSoda Creator &amp; Webapp Owner Support</span>
            </h3>
            <p className="text-xs text-slate-400">
              {mySodaSupports.length > 0
                ? `You have logged ${mySodaSupports.length} soda support pledge${mySodaSupports.length > 1 ? 's' : ''} in SoundDeck Studio.`
                : 'Tip your favorite artists, content creators, DJs, or buy the webapp owner a soda to keep the studio growing.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {creators.slice(0, 2).map((c) =>
              c.buyMeSodaHandle ? (
                <button
                  key={c.uid}
                  type="button"
                  onClick={() =>
                    openSodaSupport({
                      handle: c.buyMeSodaHandle!,
                      name: c.displayName,
                      role: c.role,
                    })
                  }
                  className="px-3.5 py-2 rounded-lg bg-[#0B0D10] hover:bg-[#1B2028] text-slate-200 text-xs border border-[#232833] transition-colors whitespace-nowrap"
                >
                  Tip {c.displayName}
                </button>
              ) : null
            )}
            <button
              type="button"
              onClick={() => openSodaSupport()}
              className="px-4 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs font-semibold border border-amber-500/40 whitespace-nowrap"
            >
              Buy Owner a Soda
            </button>
          </div>
        </section>
      </main>

      <footer
        className={`border-t border-[#232833] bg-[#0B0D10] mt-10 ${
          persistentPlayer ? 'pb-24' : ''
        }`}
      >
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <span>SoundDeck Studio · Built for Artists, Content Creators, and DJs</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => openSodaSupport()}
              className="hover:text-amber-400 transition-colors"
            >
              BuymeSoda Support
            </button>
            <a
              href="https://www.audacityteam.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-300 transition-colors"
            >
              Audacity
            </a>
            <a
              href="https://www.virtualdj.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-300 transition-colors"
            >
              VirtualDJ
            </a>
          </div>
        </div>
      </footer>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        user={user}
        profile={profile}
        onProfileSaved={() => user && refreshProfileData(user.uid)}
      />

      <BuyMeSodaModal
        isOpen={sodaModalOpen}
        onClose={() => setSodaModalOpen(false)}
        user={user}
        creators={creators}
        initialRecipient={sodaRecipient}
        onOpenAuth={() => {
          setSodaModalOpen(false);
          setAuthModalOpen(true);
        }}
      />

      <StudioStage3D
        isOpen={stage3DOpen}
        onClose={() => setStage3DOpen(false)}
        activeTrackTitle={activeTrackTitle}
        bpm={studioBpm}
      />

      <PersistentAudioPlayer
        playerState={persistentPlayer}
        activeTab={activeTab}
        onSwitchMode={(nextMode) => {
          if (!persistentPlayer) return;
          handlePlayDiscoverTrack(
            persistentPlayer.track,
            nextMode,
            persistentPlayer.youtubeVersions
          );
        }}
        onSelectYoutubeVersion={(videoId) =>
          setPersistentPlayer((prev) =>
            prev ? { ...prev, activeYoutubeVideoId: videoId } : prev
          )
        }
        onOpenDiscover={() => setActiveTab('discover')}
        onClose={() => setPersistentPlayer(null)}
      />

      <StudioChatBot
        activeTab={activeTab}
        bpm={studioBpm}
        activeTrackTitle={activeTrackTitle}
        hidden={stage3DOpen}
        hasFloatingPlayer={Boolean(persistentPlayer)}
      />
    </div>
  );
}
