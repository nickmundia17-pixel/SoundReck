import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw,
  Play,
  Pause,
  Heart,
  MessageCircle,
  Send,
  Link2,
  Plus,
  CupSoda,
  CheckCheck,
  Code2,
  Music2,
  Volume2,
} from 'lucide-react';
import { type SavedSocialCampaign } from '../../firebase';

export type FeedPlatform = 'instagram' | 'tiktok' | 'whatsapp';
export type FeedFilter = 'all' | FeedPlatform;
export type FeedGrooveStyle = 'afro' | 'house' | 'trap';

export interface DynamicFeedItem {
  id: string;
  platform: FeedPlatform;
  author: string;
  displayName: string;
  title: string;
  caption: string;
  permalink: string;
  embedId: string;
  embedKind?: 'p' | 'reel' | 'tv';
  thumbnailUrl?: string;
  grooveStyle: FeedGrooveStyle;
  fetchedLive: boolean;
  publishedAt: string;
  metrics: {
    likes: number;
    comments: number;
    shares: number;
  };
  likedByMe?: boolean;
  localReplies?: { id: string; author: string; text: string; time: string }[];
}

interface EmbeddedSocialFeedProps {
  igHandle: string;
  tiktokHandle: string;
  waNumber: string;
  trackTitle: string;
  studioBpm: number;
  campaigns: SavedSocialCampaign[];
  playingItemId: string | null;
  onToggleAudio: (itemId: string, style: FeedGrooveStyle) => void;
  onLoadIntoStudio: (item: {
    platform: FeedPlatform;
    headline: string;
    caption: string;
    trackTitle: string;
  }) => void;
  onSupportCreator?: (recipient?: string) => void;
}

declare global {
  interface Window {
    instgrm?: {
      Embeds?: {
        process: () => void;
      };
    };
    tiktokEmbed?: {
      lib?: {
        render: (elements?: HTMLElement[]) => void;
      };
    };
  }
}

export function EmbeddedSocialFeed({
  igHandle,
  tiktokHandle,
  waNumber,
  trackTitle,
  studioBpm,
  campaigns,
  playingItemId,
  onToggleAudio,
  onLoadIntoStudio,
  onSupportCreator,
}: EmbeddedSocialFeedProps) {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [feedItems, setFeedItems] = useState<DynamicFeedItem[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  // Per-card official SDK iframe/blockquote vs interactive studio widget mode
  const [sdkModeById, setSdkModeById] = useState<Record<string, 'sdk' | 'interactive'>>({});
  const [igSdkReady, setIgSdkReady] = useState(false);
  const [ttSdkReady, setTtSdkReady] = useState(false);

  // Embed URL injector state
  const [customUrl, setCustomUrl] = useState('');
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  // WhatsApp / inline reply drafts keyed by feed item id
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  // Load Instagram & TikTok official embed SDK scripts once without navigating away
  useEffect(() => {
    const existingIg = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.instagram.com/embed.js"]'
    );
    if (!existingIg) {
      const igScript = document.createElement('script');
      igScript.src = 'https://www.instagram.com/embed.js';
      igScript.async = true;
      igScript.onload = () => {
        setIgSdkReady(true);
        window.instgrm?.Embeds?.process();
      };
      document.body.appendChild(igScript);
    } else {
      setIgSdkReady(true);
      window.instgrm?.Embeds?.process();
    }

    const existingTt = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.tiktok.com/embed.js"]'
    );
    if (!existingTt) {
      const ttScript = document.createElement('script');
      ttScript.src = 'https://www.tiktok.com/embed.js';
      ttScript.async = true;
      ttScript.onload = () => {
        setTtSdkReady(true);
      };
      document.body.appendChild(ttScript);
    } else {
      setTtSdkReady(true);
    }
  }, []);

  // Re-process Instagram & TikTok SDK widgets whenever items or mode switches change
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.instgrm?.Embeds?.process();
      } catch {
        // Ignore if blocked by strict privacy extensions
      }
      try {
        window.tiktokEmbed?.lib?.render();
      } catch {
        // Ignore
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [feedItems, sdkModeById, filter, igSdkReady, ttSdkReady]);

  const fetchDynamicFeed = useCallback(async () => {
    setLoadingFeed(true);
    setFeedError(null);
    try {
      const params = new URLSearchParams({
        igHandle: igHandle.trim() || '@sounddeck.artist',
        tiktokHandle: tiktokHandle.trim() || '@sounddeck.tok',
        waNumber: waNumber.trim() || 'Street Team VIP',
        trackTitle: trackTitle.trim() || 'Midnight Studio Loop',
      });
      const res = await fetch(`/api/social/feed?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not sync social feeds.');
      setFeedItems((prev) => {
        const customInjected = prev.filter((p) => p.id.startsWith('custom_'));
        const nextList: DynamicFeedItem[] = Array.isArray(data.items) ? data.items : [];
        return [...customInjected, ...nextList];
      });
      setSyncedAt(data.syncedAt || new Date().toISOString());
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : 'Unable to fetch social feeds.');
    } finally {
      setLoadingFeed(false);
    }
  }, [igHandle, tiktokHandle, waNumber, trackTitle]);

  useEffect(() => {
    fetchDynamicFeed();
  }, [fetchDynamicFeed]);

  const handleEmbedCustomUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl.trim()) return;
    setResolvingUrl(true);
    setUrlError(null);
    try {
      const res = await fetch(
        `/api/social/oembed?url=${encodeURIComponent(customUrl.trim())}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve post URL.');

      const newItem: DynamicFeedItem = {
        id: `custom_${Date.now()}`,
        platform: data.platform,
        author: data.authorName || '@creator',
        displayName:
          data.platform === 'tiktok'
            ? 'Embedded TikTok Post'
            : 'Embedded Instagram Post',
        title: data.title || 'Live Embedded Post',
        caption: data.title || 'Loaded live inside SoundDeck Social Feed.',
        permalink: data.url,
        embedId: data.embedId || '',
        embedKind: data.embedKind || 'p',
        thumbnailUrl: data.thumbnailUrl || '',
        grooveStyle: data.platform === 'tiktok' ? 'house' : 'afro',
        fetchedLive: true,
        publishedAt: 'Embedded now',
        metrics: { likes: 128, comments: 14, shares: 9 },
      };

      setFeedItems((prev) => [newItem, ...prev]);
      setSdkModeById((prev) => ({ ...prev, [newItem.id]: 'sdk' }));
      setCustomUrl('');
      if (filter !== 'all' && filter !== data.platform) {
        setFilter(data.platform);
      }
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'Could not embed URL.');
    } finally {
      setResolvingUrl(false);
    }
  };

  const handleLikeFeedItem = (id: string) => {
    setFeedItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const nextLiked = !item.likedByMe;
        return {
          ...item,
          likedByMe: nextLiked,
          metrics: {
            ...item.metrics,
            likes: nextLiked ? item.metrics.likes + 1 : Math.max(0, item.metrics.likes - 1),
          },
        };
      })
    );
  };

  const handleSubmitInlineReply = (e: React.FormEvent, itemId: string) => {
    e.preventDefault();
    const text = (replyDrafts[itemId] || '').trim();
    if (!text) return;
    setFeedItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              metrics: { ...item.metrics, comments: item.metrics.comments + 1 },
              localReplies: [
                ...(item.localReplies || []),
                {
                  id: `rep_${Date.now()}`,
                  author: item.platform === 'whatsapp' ? 'You · Studio' : igHandle || '@studio.creator',
                  text,
                  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                },
              ],
            }
          : item
      )
    );
    setReplyDrafts((prev) => ({ ...prev, [itemId]: '' }));
  };

  // Merge Firestore saved campaigns from Instagram/TikTok/WhatsApp as live feed entries if not duplicated
  const campaignFeedItems: DynamicFeedItem[] = campaigns
    .filter(
      (c): c is SavedSocialCampaign & { platform: FeedPlatform } =>
        c.platform === 'instagram' || c.platform === 'tiktok' || c.platform === 'whatsapp'
    )
    .slice(0, 3)
    .map((c) => ({
      id: `fs_${c.id}`,
      platform: c.platform,
      author:
        c.platform === 'instagram'
          ? igHandle || '@sounddeck.artist'
          : c.platform === 'tiktok'
          ? tiktokHandle || '@sounddeck.tok'
          : waNumber || 'WhatsApp VIP',
      displayName: 'Synced Studio Campaign',
      title: c.headline,
      caption: c.caption,
      permalink: '',
      embedId: c.id,
      grooveStyle: c.platform === 'tiktok' ? 'trap' : 'afro',
      fetchedLive: true,
      publishedAt: 'Vault Synced',
      metrics: { likes: 24, comments: 4, shares: 3 },
    }));

  const combinedItems = [...campaignFeedItems, ...feedItems];
  const visibleItems =
    filter === 'all'
      ? combinedItems
      : combinedItems.filter((item) => item.platform === filter);

  return (
    <section
      aria-labelledby="dynamic-social-feed-heading"
      className="rounded-xl bg-[#13161B] border border-[#232833] p-5 space-y-5"
    >
      {/* Top Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#232833] pb-4">
        <div>
          <h3
            id="dynamic-social-feed-heading"
            className="font-display text-lg font-semibold text-slate-100"
          >
            Dynamic Embedded Social Feed
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Live posts from Instagram, TikTok, and WhatsApp rendered inside embedded SDK widgets without leaving SoundDeck
            {syncedAt ? ` · Synced ${new Date(syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0B0D10] border border-[#232833]">
            {(
              [
                { id: 'all', label: 'All Channels' },
                { id: 'instagram', label: 'Instagram' },
                { id: 'tiktok', label: 'TikTok' },
                { id: 'whatsapp', label: 'WhatsApp' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  filter === tab.id
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={fetchDynamicFeed}
            disabled={loadingFeed}
            className="px-3.5 py-2 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-slate-100 text-xs font-medium border border-[#2A313E] flex items-center gap-1.5 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${loadingFeed ? 'animate-spin' : ''}`} />
            <span>{loadingFeed ? 'Syncing...' : 'Refresh Feed'}</span>
          </button>
        </div>
      </div>

      {/* Live Post URL Embed Bar */}
      <form
        onSubmit={handleEmbedCustomUrl}
        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 p-3 rounded-lg bg-[#0B0D10] border border-[#232833]"
      >
        <div className="flex items-center gap-2 text-xs text-slate-400 shrink-0">
          <Link2 className="w-4 h-4 text-amber-400" />
          <span className="font-medium text-slate-200">Embed Live URL:</span>
        </div>
        <input
          type="url"
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          placeholder="Paste any Instagram Post/Reel or TikTok video URL to embed right here..."
          className="flex-1 px-3 py-2 rounded-md bg-[#13161B] border border-[#232833] text-xs text-slate-100 focus:outline-none focus:border-amber-500"
        />
        <button
          type="submit"
          disabled={resolvingUrl || !customUrl.trim()}
          className="px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{resolvingUrl ? 'Embedding...' : 'Embed in Feed'}</span>
        </button>
      </form>

      {urlError && (
        <div className="p-2.5 rounded-lg bg-red-950/50 border border-red-800/60 text-xs text-red-200">
          {urlError}
        </div>
      )}
      {feedError && (
        <div className="p-2.5 rounded-lg bg-red-950/50 border border-red-800/60 text-xs text-red-200">
          {feedError}
        </div>
      )}

      {/* Feed Grid */}
      {loadingFeed && feedItems.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((slot) => (
            <div
              key={slot}
              className="h-80 rounded-xl bg-[#0B0D10] border border-[#232833] p-4 flex flex-col justify-between"
            >
              <div className="h-4 w-32 rounded bg-[#1B2028]" />
              <div className="h-40 w-full rounded-lg bg-[#13161B]" />
              <div className="h-8 w-full rounded bg-[#1B2028]" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleItems.map((item) => {
            const hasRealExternalEmbed = Boolean(item.permalink && item.embedId);
            const activeMode =
              sdkModeById[item.id] ||
              (item.id.startsWith('custom_') && hasRealExternalEmbed ? 'sdk' : 'interactive');
            const isPlaying = playingItemId === item.id;

            return (
              <article
                key={item.id}
                className="rounded-xl bg-[#0B0D10] border border-[#232833] overflow-hidden flex flex-col justify-between"
              >
                {/* Card Header */}
                <div className="px-4 py-3 border-b border-[#1E232D] flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
                      <span className="text-amber-400 uppercase font-semibold">{item.platform}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{item.publishedAt}</span>
                    </div>
                    <div className="text-xs font-semibold text-slate-100 truncate mt-0.5">
                      {item.author}
                    </div>
                  </div>

                  {hasRealExternalEmbed ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSdkModeById((prev) => ({
                          ...prev,
                          [item.id]: activeMode === 'sdk' ? 'interactive' : 'sdk',
                        }))
                      }
                      className={`px-2.5 py-1 rounded text-[11px] font-medium border flex items-center gap-1 transition-colors shrink-0 ${
                        activeMode === 'sdk'
                          ? 'bg-amber-500 text-slate-950 border-amber-500 font-semibold'
                          : 'bg-[#13161B] hover:bg-[#1B2028] text-slate-300 border-[#232833]'
                      }`}
                    >
                      <Code2 className="w-3 h-3" />
                      <span>{activeMode === 'sdk' ? 'Studio Card' : 'Live Embed'}</span>
                    </button>
                  ) : (
                    <span className="text-[11px] font-mono text-emerald-400 shrink-0">
                      In-App Widget
                    </span>
                  )}
                </div>

                {/* Card Body: Official SDK Embed OR Interactive Widget */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                  {activeMode === 'sdk' && item.platform === 'instagram' && item.embedId ? (
                    <div className="space-y-2">
                      <div className="w-full h-[320px] rounded-lg overflow-hidden bg-white border border-[#232833]">
                        <iframe
                          title={item.title}
                          src={`https://www.instagram.com/${item.embedKind || 'p'}/${item.embedId}/embed/captioned/`}
                          className="w-full h-full border-0"
                          loading="lazy"
                          allow="autoplay; encrypted-media"
                        />
                      </div>
                      <p className="text-[11px] text-slate-400 leading-snug">
                        Rendered via Instagram Embedded Widget. If blocked by browser tracking rules, switch back to Studio Card above.
                      </p>
                    </div>
                  ) : activeMode === 'sdk' && item.platform === 'tiktok' && item.embedId ? (
                    <div className="space-y-2">
                      <div className="w-full h-[360px] rounded-lg overflow-hidden bg-[#13161B] border border-[#232833]">
                        <iframe
                          title={item.title}
                          src={`https://www.tiktok.com/embed/v2/${item.embedId}`}
                          className="w-full h-full border-0"
                          loading="lazy"
                          allow="autoplay; encrypted-media; fullscreen"
                        />
                      </div>
                      <p className="text-[11px] text-slate-400 leading-snug">
                        Rendered via TikTok Embedded Player v2 directly inside SoundDeck.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Rich Interactive Media / WhatsApp Channel Card */}
                      {item.platform === 'whatsapp' ? (
                        <div className="rounded-lg bg-[#0B141A] border border-emerald-800/40 p-3.5 space-y-2.5">
                          <div className="flex items-center justify-between text-[11px] font-mono text-emerald-400">
                            <span>{item.displayName}</span>
                            <CheckCheck className="w-3.5 h-3.5" />
                          </div>
                          <div className="text-xs font-semibold text-slate-100">{item.title}</div>
                          <p className="text-xs text-slate-300 leading-relaxed">{item.caption}</p>
                          <div className="p-2 rounded bg-[#151E24] flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => onToggleAudio(item.id, item.grooveStyle)}
                              className="px-2.5 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-semibold flex items-center gap-1 shrink-0"
                            >
                              {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                              <span>{isPlaying ? 'Pause Drop' : 'Play Drop'}</span>
                            </button>
                            <span className="text-[11px] font-mono text-slate-300 truncate">
                              {studioBpm} BPM · {item.grooveStyle}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          <div className="relative h-44 rounded-lg overflow-hidden bg-[#13161B] border border-[#232833] flex items-end p-3">
                            <img
                              src={
                                item.thumbnailUrl ||
                                (item.platform === 'tiktok'
                                  ? '/src/assets/images/hero_studio_console_1794573514772.jpg'
                                  : '/src/assets/images/creator_cover_afro_1794573516132.jpg')
                              }
                              alt={item.title}
                              referrerPolicy="no-referrer"
                              className="absolute inset-0 w-full h-full object-cover opacity-75"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent" />
                            <div className="relative z-10 w-full flex items-end justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-[11px] font-mono text-amber-400">
                                  {item.displayName}
                                </div>
                                <div className="text-xs font-semibold text-white line-clamp-2">
                                  {item.title}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => onToggleAudio(item.id, item.grooveStyle)}
                                aria-label={isPlaying ? 'Pause track preview' : 'Play track preview'}
                                className={`w-9 h-9 rounded-full flex items-center justify-center border shrink-0 transition-colors ${
                                  isPlaying
                                    ? 'bg-amber-500 text-slate-950 border-amber-400'
                                    : 'bg-black/75 hover:bg-amber-500 text-white hover:text-slate-950 border-white/20'
                                }`}
                              >
                                {isPlaying ? (
                                  <Pause className="w-4 h-4" />
                                ) : (
                                  <Play className="w-4 h-4 ml-0.5" />
                                )}
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                            {item.caption}
                          </p>
                        </div>
                      )}

                      {/* Inline Replies Rendered Directly Inside Card */}
                      {item.localReplies && item.localReplies.length > 0 && (
                        <div className="space-y-1.5 pt-1 border-t border-[#1E232D]">
                          {item.localReplies.slice(-2).map((rep) => (
                            <div key={rep.id} className="text-[11px] text-slate-300 flex items-baseline justify-between gap-2">
                              <span className="truncate">
                                <strong className="text-amber-400 mr-1">{rep.author}:</strong>
                                {rep.text}
                              </span>
                              <span className="text-[10px] font-mono text-slate-500 shrink-0">{rep.time}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {/* Inline Quick Reply Form */}
                  <form
                    onSubmit={(e) => handleSubmitInlineReply(e, item.id)}
                    className="flex items-center gap-1.5 pt-1"
                  >
                    <input
                      type="text"
                      value={replyDrafts[item.id] || ''}
                      onChange={(e) =>
                        setReplyDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      placeholder={
                        item.platform === 'whatsapp'
                          ? 'Reply in WhatsApp widget...'
                          : `Comment on ${item.platform} post...`
                      }
                      className="flex-1 px-2.5 py-1.5 rounded bg-[#13161B] border border-[#232833] text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                    <button
                      type="submit"
                      aria-label="Send reply"
                      className="px-2.5 py-1.5 rounded bg-[#1B2028] hover:bg-amber-500 text-amber-400 hover:text-slate-950 border border-[#2A313E] transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>

                {/* Card Footer Metrics & In-App Actions */}
                <div className="px-4 py-2.5 bg-[#101318] border-t border-[#1E232D] flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-3 tabular-nums">
                    <button
                      type="button"
                      onClick={() => handleLikeFeedItem(item.id)}
                      className="flex items-center gap-1 text-slate-300 hover:text-rose-400 transition-colors"
                    >
                      <Heart
                        className={`w-3.5 h-3.5 ${
                          item.likedByMe ? 'fill-rose-500 text-rose-500' : ''
                        }`}
                      />
                      <span className="font-mono text-[11px]">{item.metrics.likes.toLocaleString()}</span>
                    </button>

                    <span className="flex items-center gap-1 text-slate-400">
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span className="font-mono text-[11px]">{item.metrics.comments}</span>
                    </span>

                    <button
                      type="button"
                      onClick={() => onToggleAudio(item.id, item.grooveStyle)}
                      className={`flex items-center gap-1 transition-colors ${
                        isPlaying ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title="Play audio groove"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onSupportCreator?.(item.author)}
                      className="p-1.5 rounded bg-[#1B2028] hover:bg-amber-500/20 text-amber-400 border border-[#2A313E]"
                      title="Support on BuymeSoda"
                      aria-label="Support on BuymeSoda"
                    >
                      <CupSoda className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onLoadIntoStudio({
                          platform: item.platform,
                          headline: item.title,
                          caption: item.caption,
                          trackTitle: item.title,
                        })
                      }
                      className="px-2.5 py-1 rounded bg-[#1B2028] hover:bg-[#252B36] text-slate-200 text-[11px] font-medium border border-[#2A313E] flex items-center gap-1 transition-colors whitespace-nowrap"
                    >
                      <Music2 className="w-3 h-3 text-amber-400" />
                      <span>Remix in Studio</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
