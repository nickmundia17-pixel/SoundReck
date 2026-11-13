import { useCallback, useEffect, useState } from 'react';
import {
  Search,
  ExternalLink,
  Play,
  Download,
  CupSoda,
  Video,
  Music2,
  Upload,
  Sliders,
  ArrowRight,
  Radio,
  Disc3,
  Loader2,
  Users,
  CheckCircle2,
  X,
} from 'lucide-react';
import { type User } from 'firebase/auth';
import {
  DRUM_PADS,
  type DrumPadId,
  getAudioContext,
  renderGrooveBuffer,
  audioBufferToWavBlob,
  triggerBlobDownload,
} from '../../audio/studioAudio';
import {
  DISCOVER_CATALOG_TRACKS,
  type DiscoverCatalogTrack,
} from '../../audio/discoverCatalog';
import { type PadSampleAssignment } from '../../firebase';
import {
  type GlobalSearchTrack,
  type YoutubeMatchItem,
  type SoundCloudArtistProfile,
  type PersistentPlayerState,
} from '../../types/discoverPlayer';

interface DiscoverTabProps {
  user: User | null;
  padAssignments: PadSampleAssignment[];
  persistentPlayer: PersistentPlayerState | null;
  onPlayGlobalTrack: (
    track: GlobalSearchTrack,
    mode: 'preview' | 'full',
    cachedVersions?: YoutubeMatchItem[]
  ) => void;
  onPlayCatalogTrack: (track: DiscoverCatalogTrack) => void;
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
  onRegisterCustomSample: (sample: { id: string; title: string; buffer: AudioBuffer }) => void;
  onNavigateToCreation: () => void;
  onOpenAuth: () => void;
  onSupportCreator: (recipient: {
    handle: string;
    name: string;
    role: 'artist' | 'creator' | 'dj' | 'owner';
  }) => void;
}

const QUICK_GLOBAL_SEARCHES = [
  'Time Toxic Lyrikali',
  'Water Tyla',
  'Last Last Burna Boy',
  'Birds of a Feather Billie Eilish',
  'Not Like Us Kendrick Lamar',
];

function extractYouTubeId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

function formatDurationSec(sec: number): string {
  if (!sec || !Number.isFinite(sec)) return '0:00';
  const whole = Math.max(0, Math.floor(sec));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function DiscoverTab({
  user,
  padAssignments,
  persistentPlayer,
  onPlayGlobalTrack,
  onPlayCatalogTrack,
  onAssignSampleToPad,
  onRegisterCustomSample,
  onNavigateToCreation,
  onOpenAuth,
  onSupportCreator,
}: DiscoverTabProps) {
  // Global Search State
  const [searchQuery, setSearchQuery] = useState('Time Toxic Lyrikali');
  const [searchingGlobal, setSearchingGlobal] = useState(false);
  const [globalTracks, setGlobalTracks] = useState<GlobalSearchTrack[]>([]);
  const [soundcloudTracks, setSoundcloudTracks] = useState<GlobalSearchTrack[]>([]);
  const [soundcloudArtists, setSoundcloudArtists] = useState<SoundCloudArtistProfile[]>([]);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'soundcloud' | 'catalog'>('all');
  const [selectedArtist, setSelectedArtist] = useState<SoundCloudArtistProfile | null>(null);
  const [artistTracks, setArtistTracks] = useState<GlobalSearchTrack[]>([]);
  const [loadingArtistTracks, setLoadingArtistTracks] = useState(false);
  const [cachedYtMatches, setCachedYtMatches] = useState<YoutubeMatchItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [previewLoadingSample, setPreviewLoadingSample] = useState(false);

  // Manual YouTube Link Lookup
  const [youtubeUrl, setYoutubeUrl] = useState('https://www.youtube.com/watch?v=ePCWAk4Xl8E');
  const [ytMeta, setYtMeta] = useState<{ title?: string; author_name?: string } | null>(null);
  const [ytLoading, setYtLoading] = useState(false);

  // Catalog Export & Pad Assignment
  const [customTrack, setCustomTrack] = useState<{ id: string; title: string; buffer: AudioBuffer } | null>(null);
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3' | 'ogg' | 'mp4'>('wav');
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [padTargets, setPadTargets] = useState<Record<string, DrumPadId>>({
    'trk-1': 'logDrum',
    'trk-2': 'rhodesC',
    'trk-3': 'pluck',
    custom: 'airhorn',
  });
  const [sliceOffsets, setSliceOffsets] = useState<Record<string, number>>({
    'trk-1': 0,
    'trk-2': 0,
    'trk-3': 0,
    custom: 0,
  });
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [lastAssignedPad, setLastAssignedPad] = useState<string | null>(null);

  const encodedQuery = encodeURIComponent(searchQuery.trim() || 'new music');
  const mp3JuiceSearchUrl = `https://mp3juices.cc/?q=${encodedQuery}`;
  const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${encodedQuery}`;
  const ytVideoId = extractYouTubeId(youtubeUrl);

  const runGlobalSearch = useCallback(async (rawQuery: string) => {
    const q = rawQuery.trim();
    if (!q) return;
    setSearchQuery(q);
    setSearchingGlobal(true);
    setSearchError(null);
    setSelectedArtist(null);
    setArtistTracks([]);
    try {
      const res = await fetch(`/api/discover/search?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as {
        tracks?: GlobalSearchTrack[];
        youtubeMatches?: YoutubeMatchItem[];
        soundcloudTracks?: GlobalSearchTrack[];
        soundcloudArtists?: SoundCloudArtistProfile[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || 'Global search failed');
      const tracks = data.tracks || [];
      setGlobalTracks(tracks);
      setSoundcloudTracks(data.soundcloudTracks || []);
      setSoundcloudArtists(data.soundcloudArtists || []);
      setCachedYtMatches(data.youtubeMatches || []);
      if (tracks.length === 0) {
        setSearchError(`No tracks matched "${q}". Try adding artist name or song title.`);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Unable to reach global music catalog.');
    } finally {
      setSearchingGlobal(false);
    }
  }, []);

  const handleInspectArtist = async (artist: SoundCloudArtistProfile) => {
    if (selectedArtist?.id === artist.id) {
      setSelectedArtist(null);
      setArtistTracks([]);
      return;
    }
    setSelectedArtist(artist);
    setLoadingArtistTracks(true);
    setArtistTracks([]);
    try {
      const res = await fetch(`/api/discover/soundcloud-artist?id=${artist.id}`);
      const data = (await res.json()) as { tracks?: GlobalSearchTrack[] };
      setArtistTracks(data.tracks || []);
    } catch {
      setArtistTracks([]);
    } finally {
      setLoadingArtistTracks(false);
    }
  };

  useEffect(() => {
    runGlobalSearch('Time Toxic Lyrikali');
  }, [runGlobalSearch]);

  // Decode any global track's preview audio into an editable AudioBuffer for Beat Pads or Export
  const handleLoadPreviewIntoSampler = async (track: GlobalSearchTrack) => {
    const audioUrl = track.fullAudioUrl || track.previewUrl;
    if (!audioUrl) {
      setStatusMsg(`"${track.title}" only has an embedded stream; upload an audio file below to chop onto Beat Pads.`);
      return;
    }
    setPreviewLoadingSample(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/discover/preview-proxy?url=${encodeURIComponent(audioUrl)}`);
      if (!res.ok) throw new Error('Could not fetch audio preview bytes');
      const arr = await res.arrayBuffer();
      const ctx = getAudioContext();
      const decoded = await ctx.decodeAudioData(arr);
      const label = `${track.title} · ${track.artist}`;
      const sampleId = `global_${track.id}_${Date.now()}`;
      setCustomTrack({ id: sampleId, title: label, buffer: decoded });
      onRegisterCustomSample({ id: sampleId, title: label, buffer: decoded });
      setStatusMsg(`Loaded "${label}" preview (${decoded.duration.toFixed(1)}s) into the Converter & Beat Pad Mapper below.`);
    } catch {
      setStatusMsg('Could not decode preview audio stream for chopping.');
    } finally {
      setPreviewLoadingSample(false);
    }
  };

  const handleLookupYoutube = async () => {
    setYtLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/youtube/oembed?url=${encodeURIComponent(youtubeUrl)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not inspect YouTube link');
      setYtMeta(data);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Unable to fetch YouTube info.');
    } finally {
      setYtLoading(false);
    }
  };

  const handleUploadCustomTrack = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const ab = await file.arrayBuffer();
      const ctx = getAudioContext();
      const decoded = await ctx.decodeAudioData(ab);
      const cleanTitle = file.name.replace(/\.[^/.]+$/, '');
      const sampleId = `custom_${Date.now()}`;
      setCustomTrack({ id: sampleId, title: cleanTitle, buffer: decoded });
      onRegisterCustomSample({ id: sampleId, title: cleanTitle, buffer: decoded });
      setStatusMsg(`Loaded "${file.name}" for multi-format export or beat pad assignment.`);
    } catch {
      setStatusMsg('Could not decode uploaded audio file.');
    }
  };

  const handleAssignTrackToPad = async (
    key: string,
    payload: {
      sampleName: string;
      sourceType: 'catalog' | 'custom_audio';
      sourceTrackId: string;
      grooveStyle: 'afro' | 'house' | 'trap';
      bpm: number;
      rawBuffer?: AudioBuffer;
    }
  ) => {
    const targetPadId = padTargets[key] || 'pluck';
    const sliceStart = sliceOffsets[key] || 0;
    const padConfig = DRUM_PADS.find((p) => p.id === targetPadId);

    setAssigningId(key);
    setStatusMsg(null);
    try {
      const { savedToCloud } = await onAssignSampleToPad({
        padId: targetPadId,
        sampleName: payload.sampleName,
        sourceType: payload.sourceType,
        sourceTrackId: payload.sourceTrackId,
        grooveStyle: payload.grooveStyle,
        bpm: payload.bpm,
        sliceStartSec: sliceStart,
        sliceDurationSec: 1.5,
        rawBuffer: payload.rawBuffer,
      });
      setLastAssignedPad(padConfig?.label || targetPadId);
      setStatusMsg(
        savedToCloud
          ? `Assigned "${payload.sampleName}" (${sliceStart.toFixed(1)}s chop) to pad [${padConfig?.keyBind}] ${padConfig?.label} and saved to Firestore.`
          : `Assigned "${payload.sampleName}" to pad [${padConfig?.keyBind}] ${padConfig?.label} for this session. Sign in to save in Firestore.`
      );
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Unable to assign sample to pad.');
    } finally {
      setAssigningId(null);
    }
  };

  const handleDownloadTrack = async (
    id: string,
    title: string,
    grooveStyle?: 'afro' | 'house' | 'trap',
    bpm = 120,
    existingBuffer?: AudioBuffer
  ) => {
    setExportingId(id);
    setStatusMsg(null);
    try {
      const buffer = existingBuffer || (await renderGrooveBuffer(grooveStyle || 'afro', bpm, 4));
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      if (exportFormat === 'wav') {
        const blob = audioBufferToWavBlob(buffer);
        triggerBlobDownload(blob, `${slug}.wav`);
        setStatusMsg(`Downloaded "${title}" as lossless PCM .wav.`);
      } else if (exportFormat === 'ogg' || exportFormat === 'mp3') {
        const ctx = getAudioContext();
        const dest = ctx.createMediaStreamDestination();
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(dest);
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
        const rec = new MediaRecorder(dest.stream, { mimeType });
        const chunks: Blob[] = [];
        rec.ondataavailable = (ev) => {
          if (ev.data.size > 0) chunks.push(ev.data);
        };
        const finished = new Promise<Blob>((resolve) => {
          rec.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
        });
        rec.start();
        src.start();
        const captureMs = Math.min(4500, Math.round(buffer.duration * 1000));
        setTimeout(() => {
          try {
            src.stop();
          } catch {
            // stopped
          }
          rec.stop();
        }, captureMs);
        const outBlob = await finished;
        const ext = exportFormat === 'ogg' ? 'ogg' : 'mp3';
        triggerBlobDownload(outBlob, `${slug}.${ext}`);
        setStatusMsg(`Exported "${title}" as .${ext} audio stream.`);
      } else if (exportFormat === 'mp4') {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const cCtx = canvas.getContext('2d')!;
        const stream = canvas.captureStream(24);
        const aCtx = getAudioContext();
        const dest = aCtx.createMediaStreamDestination();
        const src = aCtx.createBufferSource();
        src.buffer = buffer;
        src.connect(dest);
        dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

        const rec = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        rec.ondataavailable = (ev) => {
          if (ev.data.size > 0) chunks.push(ev.data);
        };
        const done = new Promise<Blob>((resolve) => {
          rec.onstop = () => resolve(new Blob(chunks, { type: 'video/mp4' }));
        });

        let frame = 0;
        const drawTimer = window.setInterval(() => {
          frame++;
          cCtx.fillStyle = '#0B0D10';
          cCtx.fillRect(0, 0, 640, 360);
          cCtx.fillStyle = '#F59E0B';
          cCtx.font = 'bold 24px sans-serif';
          cCtx.fillText(title, 40, 80);
          cCtx.fillStyle = '#94A3B8';
          cCtx.font = '14px monospace';
          cCtx.fillText('SoundDeck Studio · Visualizer Export', 40, 110);
          for (let i = 0; i < 32; i++) {
            const barH = 20 + Math.abs(Math.sin(frame * 0.25 + i * 0.4)) * 120;
            cCtx.fillStyle = '#F59E0B';
            cCtx.fillRect(40 + i * 18, 300 - barH, 10, barH);
          }
        }, 42);

        rec.start();
        src.start();
        setTimeout(() => {
          window.clearInterval(drawTimer);
          try {
            src.stop();
          } catch {
            // stopped
          }
          rec.stop();
        }, 3500);

        const vidBlob = await done;
        triggerBlobDownload(vidBlob, `${slug}-visualizer.mp4`);
        setStatusMsg(`Rendered "${title}" visualizer clip (.mp4).`);
      }
    } finally {
      setExportingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#232833] pb-5">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-100">
            Global Music Discovery &amp; Persistent Player
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Search any song in the world — listen in 30-second Preview or Full Song inside the floating bottom player as you work across every studio tab.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Export Format:</span>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0B0D10] border border-[#232833]">
            {(['wav', 'mp3', 'ogg', 'mp4'] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setExportFormat(fmt)}
                className={`px-2.5 py-1 rounded text-xs font-mono uppercase transition-colors ${
                  exportFormat === fmt
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                .{fmt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-800/60 text-xs text-emerald-200 flex flex-wrap items-center justify-between gap-3">
          <span>{statusMsg}</span>
          <div className="flex items-center gap-3">
            {!user && lastAssignedPad && (
              <button
                type="button"
                onClick={onOpenAuth}
                className="text-amber-300 font-semibold hover:underline"
              >
                Sign In to Persist
              </button>
            )}
            {lastAssignedPad && (
              <button
                type="button"
                onClick={onNavigateToCreation}
                className="inline-flex items-center gap-1 text-amber-400 font-semibold hover:underline"
              >
                <span>Open Beat Pads</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 1. Global Song Search Bar */}
      <div className="rounded-xl bg-[#13161B] border border-[#232833] p-5 space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runGlobalSearch(searchQuery);
          }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder='Search any global song or artist (e.g., "Time Toxic Lyrikali")...'
              className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[#0B0D10] border border-[#232833] text-sm text-slate-100 focus:outline-none focus:border-amber-500"
            />
          </div>
          <button
            type="submit"
            disabled={searchingGlobal}
            className="px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {searchingGlobal ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Searching World Catalog...</span>
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                <span>Search Global Songs</span>
              </>
            )}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">Quick try:</span>
          {QUICK_GLOBAL_SEARCHES.map((sampleQ) => (
            <button
              key={sampleQ}
              type="button"
              onClick={() => runGlobalSearch(sampleQ)}
              className="px-2.5 py-1 rounded bg-[#0B0D10] hover:bg-[#1B2028] border border-[#232833] text-slate-300 hover:text-amber-300 transition-colors"
            >
              {sampleQ}
            </button>
          ))}
        </div>

        {searchError && (
          <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded-lg px-3 py-2">
            {searchError}
          </div>
        )}
      </div>

      {/* Active Floating Player Quick Status Banner */}
      {persistentPlayer && (
        <div className="rounded-xl bg-[#13161B] border border-amber-500/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Disc3 className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-100 truncate">
                Loaded in Floating Player: {persistentPlayer.track.title} — {persistentPlayer.track.artist}
              </div>
              <div className="text-[11px] font-mono text-slate-400">
                Mode: {persistentPlayer.mode === 'full' ? 'Full Song Stream' : '30s Audio Preview'} · Continues playing across DAW, Beat Pads, Virtual DJ &amp; Social Hub
              </div>
            </div>
          </div>
          {(persistentPlayer.track.previewUrl || persistentPlayer.track.fullAudioUrl) &&
            persistentPlayer.track.source !== 'catalog' && (
              <button
                type="button"
                onClick={() => handleLoadPreviewIntoSampler(persistentPlayer.track)}
                disabled={previewLoadingSample}
                className="px-3 py-1.5 rounded-lg bg-[#1B2028] hover:bg-[#252B36] border border-[#2A313E] text-xs text-amber-300 font-medium flex items-center gap-1.5 whitespace-nowrap"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>{previewLoadingSample ? 'Loading...' : 'Sample / Export Active Track'}</span>
              </button>
            )}
        </div>
      )}

      {/* 2. Global Search Results Grid (SoundCloud + Deezer + iTunes + Audius + YouTube) */}
      {(globalTracks.length > 0 || soundcloudTracks.length > 0) && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-100">
                Global Results for "{searchQuery}"
              </h3>
              <span className="text-xs text-slate-500 font-mono">
                SoundCloud · Deezer · iTunes · Audius · YouTube Full Streams
              </span>
            </div>

            <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0B0D10] border border-[#232833] text-xs">
              <button
                type="button"
                onClick={() => setSourceFilter('all')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  sourceFilter === 'all'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                All ({globalTracks.length})
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter('soundcloud')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  sourceFilter === 'soundcloud'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                SoundCloud ({soundcloudTracks.length})
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter('catalog')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  sourceFilter === 'catalog'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                Catalog &amp; YouTube
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(sourceFilter === 'soundcloud'
              ? soundcloudTracks
              : sourceFilter === 'catalog'
              ? globalTracks.filter((t) => t.source !== 'soundcloud')
              : globalTracks
            ).map((track) => {
              const isSelected = persistentPlayer?.track.id === track.id;
              const isPreviewActive = isSelected && persistentPlayer?.mode === 'preview';
              const isFullActive = isSelected && persistentPlayer?.mode === 'full';
              return (
                <div
                  key={track.id}
                  className={`rounded-xl bg-[#13161B] border p-3.5 flex flex-col justify-between gap-3 transition-colors ${
                    isSelected ? 'border-amber-500/60 bg-[#171C24]' : 'border-[#232833]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-14 h-14 rounded-lg bg-[#0B0D10] border border-[#232833] overflow-hidden shrink-0 flex items-center justify-center">
                      {track.coverUrl ? (
                        <img
                          src={track.coverUrl}
                          alt={track.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <Music2 className="w-5 h-5 text-amber-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-display text-sm font-semibold text-slate-100 truncate">
                        {track.title}
                      </h4>
                      <p className="text-xs text-slate-300 truncate">{track.artist}</p>
                      <div className="text-[11px] font-mono text-slate-500 mt-1 flex items-center gap-2 tabular-nums">
                        <span className={track.source === 'soundcloud' ? 'uppercase text-amber-400' : 'uppercase'}>
                          {track.source}
                        </span>
                        {track.durationSec > 0 && <span>· {formatDurationSec(track.durationSec)}</span>}
                        {typeof track.playbackCount === 'number' && track.playbackCount > 0 && (
                          <span>· {track.playbackCount.toLocaleString()} plays</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {track.previewUrl && (
                      <button
                        type="button"
                        onClick={() => onPlayGlobalTrack(track, 'preview', cachedYtMatches)}
                        className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                          isPreviewActive
                            ? 'bg-amber-400 text-slate-950 ring-2 ring-amber-300/40'
                            : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                        }`}
                      >
                        <Play className="w-3 h-3" />
                        <span>Preview</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onPlayGlobalTrack(track, 'full', cachedYtMatches)}
                      className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                        isFullActive
                          ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                          : 'bg-[#1B2028] hover:bg-[#252B36] text-emerald-300 border-emerald-500/40'
                      }`}
                    >
                      <Radio className="w-3 h-3" />
                      <span>{track.source === 'soundcloud' ? 'SoundCloud' : 'Full Song'}</span>
                    </button>

                    {track.source !== 'soundcloud' && track.soundcloudPermalink && (
                      <button
                        type="button"
                        onClick={() =>
                          onPlayGlobalTrack(
                            {
                              ...track,
                              id: `sc_alt_${track.id}`,
                              source: 'soundcloud',
                            },
                            'full',
                            cachedYtMatches
                          )
                        }
                        title="Play matching SoundCloud stream"
                        className="py-1.5 px-2.5 rounded-lg bg-[#0B0D10] hover:bg-[#1B2028] border border-amber-500/35 text-amber-400 text-[11px] font-mono font-semibold"
                      >
                        SC
                      </button>
                    )}

                    {(track.previewUrl || track.fullAudioUrl) && (
                      <button
                        type="button"
                        onClick={() => handleLoadPreviewIntoSampler(track)}
                        title="Load preview audio into Converter & Beat Pads"
                        className="py-1.5 px-2.5 rounded-lg bg-[#0B0D10] hover:bg-[#1B2028] border border-[#232833] text-slate-300 text-xs flex items-center justify-center"
                      >
                        <Sliders className="w-3.5 h-3.5 text-amber-400" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2b. SoundCloud Artist Profiles & Inline Catalog */}
      {soundcloudArtists.length > 0 && (
        <div className="rounded-xl bg-[#13161B] border border-[#232833] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-base font-semibold text-slate-100 flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-400" />
              <span>SoundCloud Artist Profiles</span>
            </h3>
            <span className="text-xs text-slate-500 font-mono">
              Click any profile to browse &amp; stream their catalog
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {soundcloudArtists.map((artist) => {
              const isOpen = selectedArtist?.id === artist.id;
              return (
                <div
                  key={artist.id}
                  className={`rounded-lg border p-3 flex items-center justify-between gap-3 transition-colors ${
                    isOpen
                      ? 'bg-[#1B2028] border-amber-500/60'
                      : 'bg-[#0B0D10] border-[#232833] hover:border-amber-500/35'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleInspectArtist(artist)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    <div className="w-11 h-11 rounded-full bg-[#13161B] border border-[#232833] overflow-hidden shrink-0 flex items-center justify-center">
                      {artist.avatarUrl ? (
                        <img
                          src={artist.avatarUrl}
                          alt={artist.username}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Users className="w-4 h-4 text-amber-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-100 flex items-center gap-1 truncate">
                        <span className="truncate">{artist.username}</span>
                        {artist.verified && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                        {artist.followersCount.toLocaleString()} followers · {artist.trackCount} tracks
                      </div>
                      {(artist.city || artist.country) && (
                        <div className="text-[10px] text-slate-500 truncate">
                          {[artist.city, artist.country].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </div>
                  </button>

                  {artist.permalinkUrl && (
                    <a
                      href={artist.permalinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open SoundCloud profile"
                      className="p-1.5 rounded bg-[#13161B] hover:bg-[#252B36] border border-[#232833] text-slate-400 hover:text-amber-400 shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>

          {selectedArtist && (
            <div className="rounded-lg bg-[#0B0D10] border border-[#232833] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-amber-300">
                  {selectedArtist.username} — SoundCloud Releases
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedArtist(null);
                    setArtistTracks([]);
                  }}
                  className="text-slate-400 hover:text-slate-100"
                  aria-label="Close artist releases"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {loadingArtistTracks ? (
                <div className="text-xs text-slate-400 flex items-center gap-2 py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  <span>Loading artist tracks...</span>
                </div>
              ) : artistTracks.length === 0 ? (
                <div className="text-xs text-slate-500">
                  No public tracks listed for this SoundCloud profile.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {artistTracks.map((trk) => {
                    const isActive = persistentPlayer?.track.id === trk.id;
                    return (
                      <div
                        key={trk.id}
                        className={`rounded-lg border px-3 py-2 flex items-center justify-between gap-3 ${
                          isActive
                            ? 'bg-[#171C24] border-amber-500/50'
                            : 'bg-[#13161B] border-[#232833]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-slate-100 truncate">
                            {trk.title}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                            {formatDurationSec(trk.durationSec)}
                            {typeof trk.playbackCount === 'number' && trk.playbackCount > 0
                              ? ` · ${trk.playbackCount.toLocaleString()} plays`
                              : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onPlayGlobalTrack(trk, 'full')}
                          className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-semibold flex items-center gap-1 shrink-0"
                        >
                          <Play className="w-3 h-3" />
                          <span>Stream</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 3. Direct YouTube URL Deck & External Portals */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-xl bg-[#13161B] border border-[#232833] p-5 space-y-4">
          <h3 className="font-display text-base font-semibold text-slate-100">
            External Partner Portals (Optional)
          </h3>
          <p className="text-xs text-slate-400">
            Need raw external links for &ldquo;{searchQuery || 'new music'}&rdquo;? Open partner portals directly if needed.
          </p>

          <div className="flex flex-wrap gap-3">
            <a
              href={mp3JuiceSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2.5 px-4 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-amber-400 font-semibold text-xs border border-amber-500/35 flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              <span>MP3Juice Portal</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <a
              href={youtubeSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2.5 px-4 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-slate-100 font-medium text-xs border border-[#2A313E] flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              <Video className="w-3.5 h-3.5 text-amber-400" />
              <span>YouTube Search</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* YouTube Direct URL Previewer */}
        <div className="lg:col-span-7 rounded-xl bg-[#13161B] border border-[#232833] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-slate-100">
              Direct YouTube Link Listening Deck
            </h3>
            {ytMeta?.title && (
              <span className="text-xs text-amber-400 truncate max-w-[220px]">{ytMeta.title}</span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="Paste YouTube watch or share URL..."
              className="flex-1 px-3 py-2 rounded-lg bg-[#0B0D10] border border-[#232833] text-xs text-slate-100 focus:outline-none focus:border-amber-500"
            />
            <button
              type="button"
              onClick={handleLookupYoutube}
              disabled={ytLoading}
              className="px-3.5 py-2 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-slate-100 text-xs font-medium border border-[#2A313E] whitespace-nowrap"
            >
              {ytLoading ? 'Loading...' : 'Load Info'}
            </button>
          </div>

          {ytVideoId ? (
            <div className="aspect-video max-h-[260px] w-full rounded-lg overflow-hidden border border-[#232833] bg-black">
              <iframe
                title="YouTube studio preview"
                src={`https://www.youtube.com/embed/${ytVideoId}`}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="aspect-video max-h-[260px] w-full rounded-lg border border-[#232833] bg-[#0B0D10] flex items-center justify-center text-xs text-slate-500">
              Paste a valid YouTube link to listen inside Discover.
            </div>
          )}
        </div>
      </div>

      {/* Format Converter & Sample-to-Pad Bar */}
      <div className="rounded-xl bg-[#13161B] border border-[#232833] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-display text-sm font-semibold text-slate-100">
              Convert Local or Sampled Audio to .{exportFormat.toUpperCase()} or Assign to Beat Pad
            </h3>
            <p className="text-xs text-slate-400">
              Upload any audio clip or click the sliders icon on any searched song above to transcode or chop onto your Beat Pads.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="px-4 py-2 rounded-lg bg-[#0B0D10] hover:bg-[#1B2028] text-slate-200 text-xs font-medium border border-[#232833] flex items-center gap-2 cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-amber-400" />
              <span>Select Audio File</span>
              <input type="file" accept="audio/*" onChange={handleUploadCustomTrack} className="hidden" />
            </label>
            {customTrack && (
              <button
                type="button"
                onClick={() =>
                  handleDownloadTrack('custom', customTrack.title, undefined, 120, customTrack.buffer)
                }
                disabled={exportingId === 'custom'}
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {exportingId === 'custom'
                    ? 'Exporting...'
                    : `Download ${customTrack.title}.${exportFormat}`}
                </span>
              </button>
            )}
          </div>
        </div>

        {customTrack && (
          <div className="pt-3 border-t border-[#232833] flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-300 font-medium truncate max-w-[200px]">
              Sample: {customTrack.title}
            </span>
            <select
              value={padTargets.custom || 'airhorn'}
              onChange={(e) =>
                setPadTargets((prev) => ({ ...prev, custom: e.target.value as DrumPadId }))
              }
              className="px-2.5 py-1.5 rounded bg-[#0B0D10] border border-[#232833] text-xs text-slate-100"
            >
              {DRUM_PADS.map((p) => (
                <option key={p.id} value={p.id}>
                  Pad [{p.keyBind}] · {p.label}
                </option>
              ))}
            </select>
            <select
              value={sliceOffsets.custom || 0}
              onChange={(e) =>
                setSliceOffsets((prev) => ({ ...prev, custom: Number(e.target.value) }))
              }
              className="px-2.5 py-1.5 rounded bg-[#0B0D10] border border-[#232833] text-xs text-slate-100 font-mono"
            >
              <option value={0}>Chop 0.0s</option>
              <option value={0.5}>Chop 0.5s</option>
              <option value={1.0}>Chop 1.0s</option>
              <option value={1.5}>Chop 1.5s</option>
            </select>
            <button
              type="button"
              onClick={() =>
                handleAssignTrackToPad('custom', {
                  sampleName: customTrack.title,
                  sourceType: 'custom_audio',
                  sourceTrackId: customTrack.id,
                  grooveStyle: 'afro',
                  bpm: 120,
                  rawBuffer: customTrack.buffer,
                })
              }
              disabled={assigningId === 'custom'}
              className="px-3.5 py-1.5 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-amber-400 font-semibold border border-amber-500/40 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{assigningId === 'custom' ? 'Assigning...' : 'Assign to Beat Pad'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Curated SoundDeck Artist Releases */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-lg font-semibold text-slate-100">
            Creator Releases &amp; Instant Pad Samples
          </h3>
          {padAssignments.length > 0 && (
            <button
              type="button"
              onClick={onNavigateToCreation}
              className="text-xs font-medium text-amber-400 hover:underline inline-flex items-center gap-1"
            >
              <span>{padAssignments.length} pad sample{padAssignments.length > 1 ? 's' : ''} mapped</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {DISCOVER_CATALOG_TRACKS.map((track) => {
            const isLoaded = persistentPlayer?.track.id === track.id;
            const selectedPad = padTargets[track.id] || 'pluck';
            const selectedOffset = sliceOffsets[track.id] || 0;
            return (
              <div
                key={track.id}
                className={`rounded-xl bg-[#13161B] border overflow-hidden flex flex-col justify-between ${
                  isLoaded ? 'border-amber-500/60' : 'border-[#232833]'
                }`}
              >
                <div className="relative aspect-square bg-[#0B0D10] overflow-hidden">
                  <img
                    src={track.coverUrl}
                    alt={`${track.title} by ${track.artist}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                  <button
                    type="button"
                    onClick={() => onPlayCatalogTrack(track)}
                    aria-label={`Play ${track.title} in floating player`}
                    className="absolute bottom-3 right-3 w-11 h-11 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center shadow-lg transition-transform active:scale-95"
                  >
                    <Play className="w-4 h-4 ml-0.5" />
                  </button>
                </div>

                <div className="p-4 space-y-3">
                  <div>
                    <div className="text-xs text-slate-400 font-mono tabular-nums">
                      {track.genre} · {track.bpm} BPM · {track.durationLabel}
                    </div>
                    <h4 className="font-display text-base font-semibold text-slate-100 mt-1 flex items-center gap-1.5">
                      <Music2 className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="truncate">{track.title}</span>
                    </h4>
                    <p className="text-xs text-slate-400">{track.artist}</p>
                  </div>

                  {/* Assign Sample to Beat Pad Controls */}
                  <div className="p-2.5 rounded-lg bg-[#0B0D10] border border-[#232833] space-y-2">
                    <div className="text-[11px] font-medium text-slate-300">
                      Assign Sample to Beat Pad
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <select
                        value={selectedPad}
                        onChange={(e) =>
                          setPadTargets((prev) => ({
                            ...prev,
                            [track.id]: e.target.value as DrumPadId,
                          }))
                        }
                        aria-label={`Select beat pad for ${track.title}`}
                        className="px-2 py-1.5 rounded bg-[#13161B] border border-[#232833] text-[11px] text-slate-100"
                      >
                        {DRUM_PADS.map((p) => (
                          <option key={p.id} value={p.id}>
                            [{p.keyBind}] {p.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={selectedOffset}
                        onChange={(e) =>
                          setSliceOffsets((prev) => ({
                            ...prev,
                            [track.id]: Number(e.target.value),
                          }))
                        }
                        aria-label={`Select chop time for ${track.title}`}
                        className="px-2 py-1.5 rounded bg-[#13161B] border border-[#232833] text-[11px] text-slate-100 font-mono"
                      >
                        <option value={0}>Chop 0.0s</option>
                        <option value={0.5}>Chop 0.5s</option>
                        <option value={1.0}>Chop 1.0s</option>
                        <option value={1.5}>Chop 1.5s</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleAssignTrackToPad(track.id, {
                          sampleName: track.title,
                          sourceType: 'catalog',
                          sourceTrackId: track.id,
                          grooveStyle: track.grooveStyle,
                          bpm: track.bpm,
                        })
                      }
                      disabled={assigningId === track.id}
                      className="w-full py-1.5 px-3 rounded bg-[#1B2028] hover:bg-[#252B36] text-amber-400 text-xs font-semibold border border-amber-500/35 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>{assigningId === track.id ? 'Assigning...' : 'Send to Beat Pad'}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        handleDownloadTrack(track.id, track.title, track.grooveStyle, track.bpm)
                      }
                      disabled={exportingId === track.id}
                      className="flex-1 py-2 px-3 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-slate-100 text-xs font-medium border border-[#2A313E] flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5 text-amber-400" />
                      <span>
                        {exportingId === track.id
                          ? 'Rendering...'
                          : `Save .${exportFormat.toUpperCase()}`}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onSupportCreator({
                          handle: track.sodaHandle,
                          name: track.artist,
                          role: track.role,
                        })
                      }
                      className="py-2 px-3 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs font-medium border border-amber-500/40 flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <CupSoda className="w-3.5 h-3.5" />
                      <span>BuymeSoda</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
