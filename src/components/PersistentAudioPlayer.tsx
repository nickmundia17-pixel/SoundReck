import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  X,
  Disc3,
  Radio,
  Tv,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { attachMediaElementToAnalyser } from '../audio/studioAudio';
import { type PersistentPlayerState } from '../types/discoverPlayer';

interface PersistentAudioPlayerProps {
  playerState: PersistentPlayerState | null;
  activeTab: string;
  onSwitchMode: (mode: 'preview' | 'full') => void;
  onSelectYoutubeVersion: (videoId: string) => void;
  onOpenDiscover: () => void;
  onClose: () => void;
}

function formatSec(sec: number): string {
  if (!sec || !Number.isFinite(sec)) return '0:00';
  const whole = Math.max(0, Math.floor(sec));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function PersistentAudioPlayer({
  playerState,
  activeTab,
  onSwitchMode,
  onSelectYoutubeVersion,
  onOpenDiscover,
  onClose,
}: PersistentAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytIframeRef = useRef<HTMLIFrameElement | null>(null);
  const scIframeRef = useRef<HTMLIFrameElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(30);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [videoExpanded, setVideoExpanded] = useState(false);

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);

  const track = playerState?.track ?? null;
  const mode = playerState?.mode ?? 'preview';
  const activeYoutubeVideoId = playerState?.activeYoutubeVideoId ?? null;
  const activeSoundCloudPermalink = playerState?.activeSoundCloudPermalink ?? null;
  const youtubeVersions = playerState?.youtubeVersions ?? [];
  const loadingFullStream = playerState?.loadingFullStream ?? false;

  const isSoundCloudWidgetMode = Boolean(
    track && mode === 'full' && !track.fullAudioUrl && activeSoundCloudPermalink
  );
  const isNativeAudioMode = Boolean(
    track &&
      !isSoundCloudWidgetMode &&
      (mode === 'preview' || Boolean(track.fullAudioUrl) || track.source === 'catalog')
  );
  const isYoutubeFullMode = Boolean(track && !isNativeAudioMode && !isSoundCloudWidgetMode);

  const sendScCommand = useCallback((method: string, value?: unknown) => {
    const win = scIframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      JSON.stringify(value !== undefined ? { method, value } : { method }),
      '*'
    );
  }, []);

  const sendYtCommand = useCallback((func: string, args: unknown[] = []) => {
    const win = ytIframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      JSON.stringify({
        event: 'command',
        func,
        args,
      }),
      '*'
    );
  }, []);

  // Load & play native HTML5 <audio> when in Preview, Audius Full Audio, or Catalog WAV mode
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    if (!track || !isNativeAudioMode) {
      el.pause();
      return;
    }

    const rawUrl =
      mode === 'full' && track.fullAudioUrl ? track.fullAudioUrl : track.previewUrl;
    if (!rawUrl) {
      el.pause();
      setIsPlaying(false);
      return;
    }

    const isLocalBlob = rawUrl.startsWith('blob:') || rawUrl.startsWith('data:');
    const resolvedSrc = isLocalBlob
      ? rawUrl
      : `/api/discover/preview-proxy?url=${encodeURIComponent(rawUrl)}`;

    setCurrentTime(0);
    setDuration(
      mode === 'full' && track.durationSec > 0 ? track.durationSec : 30
    );

    if (el.src !== `${window.location.origin}${resolvedSrc}` && el.src !== resolvedSrc) {
      el.src = resolvedSrc;
    }

    el.volume = muted ? 0 : volume;
    if (!isLocalBlob) {
      attachMediaElementToAnalyser(el);
    }

    el.play()
      .then(() => setIsPlaying(true))
      .catch(() => {
        if (!isLocalBlob && el.src !== rawUrl) {
          el.src = rawUrl;
          el.play()
            .then(() => setIsPlaying(true))
            .catch(() => setIsPlaying(false));
        } else {
          setIsPlaying(false);
        }
      });
  }, [track?.id, track?.previewUrl, track?.fullAudioUrl, track?.source, mode, isNativeAudioMode]);

  // Keep native audio, YouTube & SoundCloud volume/mute synced
  useEffect(() => {
    const el = audioRef.current;
    if (el) {
      el.volume = muted ? 0 : volume;
    }
    if (isYoutubeFullMode && activeYoutubeVideoId) {
      sendYtCommand(muted ? 'mute' : 'unMute');
      sendYtCommand('setVolume', [Math.round((muted ? 0 : volume) * 100)]);
    }
    if (isSoundCloudWidgetMode && activeSoundCloudPermalink) {
      sendScCommand('setVolume', Math.round((muted ? 0 : volume) * 100));
    }
  }, [
    volume,
    muted,
    isYoutubeFullMode,
    activeYoutubeVideoId,
    isSoundCloudWidgetMode,
    activeSoundCloudPermalink,
    sendYtCommand,
    sendScCommand,
  ]);

  // Listen to SoundCloud Widget postMessage events
  useEffect(() => {
    if (!isSoundCloudWidgetMode || !activeSoundCloudPermalink) return;
    setCurrentTime(0);
    setDuration(track?.durationSec && track.durationSec > 0 ? track.durationSec : 180);
    setIsPlaying(true);

    const onScMessage = (e: MessageEvent) => {
      if (typeof e.origin === 'string' && !e.origin.includes('soundcloud.com')) return;
      if (typeof e.data !== 'string') return;
      try {
        const msg = JSON.parse(e.data) as {
          method?: string;
          value?: { currentPosition?: number } | number;
        };
        if (msg.method === 'playProgress' && typeof msg.value === 'object' && msg.value) {
          if (typeof msg.value.currentPosition === 'number' && !isScrubbing) {
            setCurrentTime(msg.value.currentPosition / 1000);
          }
        } else if (msg.method === 'getDuration' && typeof msg.value === 'number' && msg.value > 0) {
          setDuration(msg.value / 1000);
        } else if (msg.method === 'play') {
          setIsPlaying(true);
        } else if (msg.method === 'pause' || msg.method === 'finish') {
          setIsPlaying(false);
        }
      } catch {
        // ignore non-JSON widget messages
      }
    };

    window.addEventListener('message', onScMessage);
    return () => window.removeEventListener('message', onScMessage);
  }, [isSoundCloudWidgetMode, activeSoundCloudPermalink, track?.durationSec, isScrubbing]);

  // Listen to YouTube IFrame API postMessage events for real-time timecode, duration & play state
  useEffect(() => {
    if (!isYoutubeFullMode || !activeYoutubeVideoId) return;

    setCurrentTime(0);
    setDuration(track?.durationSec && track.durationSec > 0 ? track.durationSec : 180);
    setIsPlaying(true);

    const onMessage = (e: MessageEvent) => {
      if (
        typeof e.origin === 'string' &&
        !e.origin.includes('youtube.com') &&
        !e.origin.includes('youtube-nocookie.com')
      ) {
        return;
      }
      if (typeof e.data !== 'string') return;
      try {
        const parsed = JSON.parse(e.data) as {
          event?: string;
          info?: {
            currentTime?: number;
            duration?: number;
            playerState?: number;
          };
        };
        if (parsed.event === 'infoDelivery' && parsed.info) {
          if (typeof parsed.info.currentTime === 'number' && !isScrubbing) {
            setCurrentTime(parsed.info.currentTime);
          }
          if (typeof parsed.info.duration === 'number' && parsed.info.duration > 0) {
            setDuration(parsed.info.duration);
          }
          if (typeof parsed.info.playerState === 'number') {
            if (parsed.info.playerState === 1) setIsPlaying(true);
            else if (parsed.info.playerState === 2 || parsed.info.playerState === 0) {
              setIsPlaying(false);
            }
          }
        }
      } catch {
        // Ignore non-JSON iframe messages
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isYoutubeFullMode, activeYoutubeVideoId, track?.durationSec, isScrubbing]);

  const handleTogglePlayPause = () => {
    if (!track) return;
    if (isNativeAudioMode) {
      const el = audioRef.current;
      if (!el) return;
      if (isPlaying) {
        el.pause();
        setIsPlaying(false);
      } else {
        if (!track.previewUrl.startsWith('blob:')) {
          attachMediaElementToAnalyser(el);
        }
        el.play()
          .then(() => setIsPlaying(true))
          .catch(() => setIsPlaying(false));
      }
    } else if (isYoutubeFullMode) {
      if (isPlaying) {
        sendYtCommand('pauseVideo');
        setIsPlaying(false);
      } else {
        sendYtCommand('playVideo');
        setIsPlaying(true);
      }
    } else if (isSoundCloudWidgetMode) {
      if (isPlaying) {
        sendScCommand('pause');
        setIsPlaying(false);
      } else {
        sendScCommand('play');
        setIsPlaying(true);
      }
    }
  };

  const commitSeek = (targetSec: number) => {
    setCurrentTime(targetSec);
    if (isNativeAudioMode && audioRef.current) {
      audioRef.current.currentTime = targetSec;
    } else if (isYoutubeFullMode) {
      sendYtCommand('seekTo', [targetSec, true]);
    } else if (isSoundCloudWidgetMode) {
      sendScCommand('seekTo', Math.round(targetSec * 1000));
    }
  };

  if (!playerState || !track) {
    return (
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        className="hidden"
      />
    );
  }

  const displayedTime = isScrubbing ? scrubTime : currentTime;
  const maxDuration = Math.max(1, duration);
  const canSwitchPreview = Boolean(track.previewUrl || track.fullAudioUrl);

  return (
    <>
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        onTimeUpdate={(e) => {
          if (!isScrubbing) setCurrentTime(e.currentTarget.currentTime);
        }}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) {
            setDuration(e.currentTarget.duration);
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        className="hidden"
      />

      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] max-w-[1220px]">
        {/* Persistent Expandable Full-Song Stream Drawer (kept mounted while in YouTube Full mode so audio never stops across tabs) */}
        {isYoutubeFullMode && activeYoutubeVideoId && (
          <div
            className={
              videoExpanded
                ? 'mb-2 rounded-xl bg-[#13161B] border border-[#2A313E] shadow-2xl p-3 grid grid-cols-1 md:grid-cols-12 gap-3'
                : 'w-0 h-0 overflow-hidden opacity-0 pointer-events-none absolute'
            }
          >
            <div className="md:col-span-6 aspect-video rounded-lg overflow-hidden bg-black border border-[#232833]">
              <iframe
                ref={ytIframeRef}
                key={activeYoutubeVideoId}
                title={`${track.title} persistent stream`}
                src={`https://www.youtube.com/embed/${activeYoutubeVideoId}?autoplay=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(
                  window.location.origin
                )}`}
                onLoad={() => {
                  ytIframeRef.current?.contentWindow?.postMessage(
                    JSON.stringify({ event: 'listening', id: 1 }),
                    '*'
                  );
                  sendYtCommand(muted ? 'mute' : 'unMute');
                  sendYtCommand('setVolume', [Math.round((muted ? 0 : volume) * 100)]);
                }}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>

            {videoExpanded && (
              <div className="md:col-span-6 flex flex-col justify-between gap-2 max-h-[200px] overflow-y-auto">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-slate-400 uppercase">
                    Full Song Streams · Switch Version
                  </span>
                  <button
                    type="button"
                    onClick={() => setVideoExpanded(false)}
                    className="text-xs text-slate-400 hover:text-slate-100 flex items-center gap-1"
                  >
                    <span>Minimize</span>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  {youtubeVersions.map((ver) => {
                    const selected = ver.videoId === activeYoutubeVideoId;
                    return (
                      <button
                        key={ver.videoId}
                        type="button"
                        onClick={() => onSelectYoutubeVersion(ver.videoId)}
                        className={`w-full text-left px-2.5 py-1.5 rounded border text-xs transition-colors ${
                          selected
                            ? 'bg-[#1B2028] border-emerald-500/50 text-emerald-200'
                            : 'bg-[#0B0D10] border-[#232833] text-slate-300 hover:border-amber-500/40'
                        }`}
                      >
                        <div className="font-medium truncate">{ver.title}</div>
                        <div className="text-[10px] font-mono text-slate-500 flex justify-between">
                          <span className="truncate">{ver.channel}</span>
                          <span>{ver.durationLabel}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Persistent SoundCloud Widget Stream Drawer */}
        {isSoundCloudWidgetMode && activeSoundCloudPermalink && (
          <div
            className={
              videoExpanded
                ? 'mb-2 rounded-xl bg-[#13161B] border border-[#2A313E] shadow-2xl p-3 space-y-2'
                : 'w-0 h-0 overflow-hidden opacity-0 pointer-events-none absolute'
            }
          >
            {videoExpanded && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-amber-400 uppercase">
                  SoundCloud Stream Player
                </span>
                <button
                  type="button"
                  onClick={() => setVideoExpanded(false)}
                  className="text-xs text-slate-400 hover:text-slate-100 flex items-center gap-1"
                >
                  <span>Minimize</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <iframe
              ref={scIframeRef}
              key={activeSoundCloudPermalink}
              title={`${track.title} SoundCloud stream`}
              height={166}
              allow="autoplay"
              src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(
                activeSoundCloudPermalink
              )}&color=%23f59e0b&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false`}
              onLoad={() => {
                sendScCommand('addEventListener', 'playProgress');
                sendScCommand('addEventListener', 'play');
                sendScCommand('addEventListener', 'pause');
                sendScCommand('addEventListener', 'finish');
                sendScCommand('getDuration');
                sendScCommand('setVolume', Math.round((muted ? 0 : volume) * 100));
              }}
              className="w-full rounded-lg border border-[#232833] bg-[#0B0D10]"
            />
          </div>
        )}

        {/* Floating Bottom Console Player Bar */}
        <div className="rounded-xl bg-[#13161B]/95 backdrop-blur-md border border-[#2A313E] shadow-2xl px-3.5 py-2.5 flex flex-col md:flex-row md:items-center gap-3">
          {/* Left: Cover Art & Track Info */}
          <div className="flex items-center gap-3 min-w-0 md:w-[270px] shrink-0">
            <div className="w-11 h-11 rounded-lg bg-[#0B0D10] border border-[#232833] overflow-hidden shrink-0 flex items-center justify-center">
              {track.coverUrl ? (
                <img
                  src={track.coverUrl}
                  alt={track.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <Disc3 className="w-5 h-5 text-amber-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-display font-bold text-slate-100 truncate">
                  {track.title}
                </span>
                {activeTab !== 'discover' && (
                  <button
                    type="button"
                    onClick={onOpenDiscover}
                    title="Return to Discover tab"
                    className="text-[10px] font-mono text-amber-400 hover:underline shrink-0 flex items-center gap-0.5"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {track.artist} ·{' '}
                <span className={mode === 'full' ? 'text-emerald-400' : 'text-amber-400'}>
                  {isSoundCloudWidgetMode
                    ? 'SoundCloud'
                    : mode === 'full'
                    ? 'Full Song'
                    : '30s Preview'}
                </span>
              </div>
            </div>
          </div>

          {/* Center: Play/Pause + Scrub Bar + Mode Toggle */}
          <div className="flex-1 flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={handleTogglePlayPause}
              disabled={loadingFullStream}
              aria-label={isPlaying ? 'Pause floating player' : 'Play floating player'}
              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 disabled:opacity-50 ${
                mode === 'full'
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                  : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
              }`}
            >
              {loadingFullStream ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4 ml-0.5" />
              )}
            </button>

            <div className="flex-1 flex items-center gap-2.5 min-w-0">
              <span className="font-mono text-[11px] text-slate-400 tabular-nums w-10 text-right shrink-0">
                {formatSec(displayedTime)}
              </span>
              <input
                type="range"
                min={0}
                max={maxDuration}
                step={0.2}
                value={Math.min(displayedTime, maxDuration)}
                onPointerDown={() => setIsScrubbing(true)}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setScrubTime(val);
                  if (!isScrubbing) {
                    commitSeek(val);
                  } else if (isNativeAudioMode && audioRef.current) {
                    audioRef.current.currentTime = val;
                    setCurrentTime(val);
                  }
                }}
                onPointerUp={(e) => {
                  const val = Number((e.currentTarget as HTMLInputElement).value);
                  setIsScrubbing(false);
                  commitSeek(val);
                }}
                onKeyUp={(e) => {
                  const val = Number((e.currentTarget as HTMLInputElement).value);
                  setIsScrubbing(false);
                  commitSeek(val);
                }}
                aria-label="Scrub track position"
                className="studio-slider flex-1 min-w-0"
              />
              <span className="font-mono text-[11px] text-slate-400 tabular-nums w-10 shrink-0">
                {formatSec(maxDuration)}
              </span>
            </div>

            {track.source !== 'catalog' && (
              <div className="hidden sm:flex items-center rounded-lg bg-[#0B0D10] border border-[#232833] p-0.5 text-[11px] shrink-0">
                <button
                  type="button"
                  onClick={() => onSwitchMode('preview')}
                  disabled={!canSwitchPreview}
                  className={`px-2 py-1 rounded transition-colors disabled:opacity-35 ${
                    mode === 'preview'
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => onSwitchMode('full')}
                  className={`px-2 py-1 rounded transition-colors flex items-center gap-1 ${
                    mode === 'full'
                      ? 'bg-emerald-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  <Radio className="w-3 h-3" />
                  <span>Full</span>
                </button>
              </div>
            )}
          </div>

          {/* Right: Volume + Video Drawer Toggle + Dismiss */}
          <div className="flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute player' : 'Mute player'}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#1B2028] transition-colors"
            >
              {muted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-rose-400" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                if (v > 0 && muted) setMuted(false);
              }}
              aria-label="Player volume"
              className="studio-slider w-16 hidden sm:block"
            />

            {((isYoutubeFullMode && activeYoutubeVideoId) ||
              (isSoundCloudWidgetMode && activeSoundCloudPermalink)) && (
              <button
                type="button"
                onClick={() => setVideoExpanded((v) => !v)}
                className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition-colors ${
                  videoExpanded
                    ? 'bg-[#1B2028] border-emerald-500/50 text-emerald-300'
                    : 'bg-[#0B0D10] border-[#232833] text-slate-300 hover:text-white'
                }`}
                title="Show or hide stream drawer"
              >
                <Tv className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Stream</span>
                {videoExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronUp className="w-3 h-3" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (audioRef.current) audioRef.current.pause();
                setIsPlaying(false);
                setVideoExpanded(false);
                onClose();
              }}
              aria-label="Close persistent audio player"
              title="Stop & close player"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-[#1B2028] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
