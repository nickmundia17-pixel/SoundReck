import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// 1. Music Lyrics AI Generator
app.post('/api/gemini/lyrics', async (req, res) => {
  try {
    const { genre, mood, bpm, topic, structure } = req.body as {
      genre?: string;
      mood?: string;
      bpm?: number;
      topic?: string;
      structure?: string;
    };

    const ai = getGeminiClient();
    const prompt = `Write original, performance-ready song lyrics for an artist.
Genre: ${genre || 'Afrobeats'}
Mood: ${mood || 'Confident and uplifting'}
Tempo: ${bpm || 112} BPM
Structure requested: ${structure || 'Intro, Verse 1, Chorus, Verse 2, Bridge, Chorus'}
Theme / Prompt: ${topic || 'Late night studio grind turning dreams into gold'}

Make the rhythm tight and natural for ${bpm || 112} BPM. Include syllable counts per line and subtle rhythmic delivery cues (e.g. "on the 1", "syncopated", "double-time").`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are a Grammy-winning songwriter and vocal producer. Deliver tight, musical lyrics with realistic syllable cadence matching the requested BPM and genre.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            hookSummary: { type: Type.STRING },
            keySignature: { type: Type.STRING },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  deliveryTip: { type: Type.STRING },
                  bars: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        line: { type: Type.STRING },
                        syllables: { type: Type.INTEGER },
                        beatCue: { type: Type.STRING },
                      },
                      required: ['line', 'syllables', 'beatCue'],
                    },
                  },
                },
                required: ['name', 'deliveryTip', 'bars'],
              },
            },
          },
          required: ['title', 'hookSummary', 'keySignature', 'sections'],
        },
      },
    });

    const jsonText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(jsonText);
    res.json(parsed);
  } catch (error) {
    console.error('Lyrics generation error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate lyrics';
    res.status(500).json({ error: message });
  }
});

// 2. Voice Alignment to Instrumental & Beats AI Assistant
app.post('/api/gemini/voice-align', async (req, res) => {
  try {
    const { bpm, genre, durationSec, peakOnsetsMs, lyricsSnippet, vocalTakeLabel } = req.body as {
      bpm?: number;
      genre?: string;
      durationSec?: number;
      peakOnsetsMs?: number[];
      lyricsSnippet?: string;
      vocalTakeLabel?: string;
    };

    const ai = getGeminiClient();
    const beatIntervalMs = Math.round(60000 / (bpm || 112));

    const prompt = `Analyze a vocalist's recorded take and provide actionable beat-alignment and vocal mixing guidance.
Track Tempo: ${bpm || 112} BPM (1 beat = ${beatIntervalMs} ms)
Genre: ${genre || 'Afrobeats'}
Take Label: ${vocalTakeLabel || 'Main Vocal Take'}
Recording Duration: ${durationSec || 8} seconds
Detected Vocal Onset Peaks (ms): ${JSON.stringify(peakOnsetsMs || [120, 650, 1180, 1730])}
Lyrics Performed:
${lyricsSnippet || 'No lyrics provided — evaluate purely on rhythmic pocket.'}

Calculate how close the detected vocal onsets sit relative to the ${beatIntervalMs}ms quarter-note grid, recommend an exact millisecond nudge (positive = shift earlier, negative = shift later, within -250 to +250 ms), give bar-by-bar timing/breath tips, and suggest a practical EQ + compression vocal chain.`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are a senior mixing and vocal alignment engineer. Give precise, practical timing nudges in milliseconds and clear vocal pocket advice.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recommendedOffsetMs: {
              type: Type.INTEGER,
              description: 'Suggested millisecond timing shift between -250 and 250.',
            },
            pocketDiagnosis: { type: Type.STRING },
            cadenceTips: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            mixingChain: {
              type: Type.OBJECT,
              properties: {
                highPassHz: { type: Type.INTEGER },
                presenceBoostDb: { type: Type.STRING },
                compressorRatio: { type: Type.STRING },
                reverbDecaySec: { type: Type.STRING },
              },
              required: ['highPassHz', 'presenceBoostDb', 'compressorRatio', 'reverbDecaySec'],
            },
          },
          required: ['recommendedOffsetMs', 'pocketDiagnosis', 'cadenceTips', 'mixingChain'],
        },
      },
    });

    const jsonText = (response.text ?? '{}').trim();
    res.json(JSON.parse(jsonText));
  } catch (error) {
    console.error('Voice alignment error:', error);
    const message = error instanceof Error ? error.message : 'Failed to analyze vocal alignment';
    res.status(500).json({ error: message });
  }
});

// 3. Social Hub AI Caption & Hook Assistant
app.post('/api/gemini/social-caption', async (req, res) => {
  try {
    const { platform, trackTitle, vibe, creatorRole } = req.body as {
      platform?: string;
      trackTitle?: string;
      vibe?: string;
      creatorRole?: string;
    };

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Write a high-converting social post for ${platform || 'instagram'} by a ${creatorRole || 'artist'} promoting "${trackTitle || 'New Studio Session'}". Vibe: ${vibe || 'Behind the scenes studio snippet'}. Keep it authentic, concise, and ready to paste with 4 relevant hashtags.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            headline: { type: Type.STRING },
            caption: { type: Type.STRING },
          },
          required: ['headline', 'caption'],
        },
      },
    });

    const jsonText = (response.text ?? '{}').trim();
    res.json(JSON.parse(jsonText));
  } catch (error) {
    console.error('Social caption error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate caption';
    res.status(500).json({ error: message });
  }
});

// 4. Lyria AI Music Generation (30s Clip & Full-Length Pro Track)
app.post('/api/gemini/music', async (req, res) => {
  try {
    const { prompt, mode, genre, mood, bpm, imageBase64, imageMimeType } = req.body as {
      prompt?: string;
      mode?: 'clip' | 'pro';
      genre?: string;
      mood?: string;
      bpm?: number;
      imageBase64?: string;
      imageMimeType?: string;
    };

    const ai = getGeminiClient();
    const model = mode === 'pro' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview';
    const lengthLabel = mode === 'pro' ? 'full-length studio master track' : '30-second high-impact music clip';
    const musicPrompt = [
      `Compose a ${lengthLabel}.`,
      genre ? `Genre: ${genre}.` : '',
      mood ? `Mood: ${mood}.` : '',
      bpm ? `Tempo: ${bpm} BPM.` : '',
      prompt?.trim() || 'Modern nocturnal studio groove with warm analog bass, crisp percussion, and melodic hooks.',
    ]
      .filter(Boolean)
      .join(' ');

    const contents =
      imageBase64 && imageMimeType
        ? {
            parts: [
              { text: musicPrompt },
              {
                inlineData: {
                  data: imageBase64,
                  mimeType: imageMimeType,
                },
              },
            ],
          }
        : musicPrompt;

    // Omit responseModalities so stream yields both audio inlineData and generated lyrics/notes text
    const stream = await ai.models.generateContentStream({
      model,
      contents,
    });

    const audioChunks: Buffer[] = [];
    let lyrics = '';
    let mimeType = 'audio/mpeg';

    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (!parts) continue;
      for (const part of parts) {
        if (part.inlineData?.data) {
          if (audioChunks.length === 0 && part.inlineData.mimeType) {
            mimeType = part.inlineData.mimeType;
          }
          audioChunks.push(Buffer.from(part.inlineData.data, 'base64'));
        }
        if (part.text) {
          lyrics += part.text;
        }
      }
    }

    if (audioChunks.length === 0) {
      res.status(502).json({
        error: `Lyria (${model}) completed without returning audio data. Try refining your musical prompt or check API quota.`,
      });
      return;
    }

    const audioBase64 = Buffer.concat(audioChunks).toString('base64');
    res.json({
      audioDataUrl: `data:${mimeType};base64,${audioBase64}`,
      mimeType,
      lyrics: lyrics.trim(),
      modelUsed: model,
    });
  } catch (error) {
    console.error('Lyria music generation error:', error);
    const rawMsg = error instanceof Error ? error.message : 'Failed to generate music track';
    const isQuotaOrBilling = /RESOURCE_EXHAUSTED|429|PERMISSION_DENIED|403|billing|paid/i.test(rawMsg);
    const helpfulMessage = isQuotaOrBilling
      ? `${rawMsg} Note: Lyria models require a billing-enabled paid API key configured in Settings > Secrets.`
      : rawMsg;
    res.status(isQuotaOrBilling ? 402 : 500).json({ error: helpfulMessage });
  }
});

// 5. Multi-Turn Studio AI Chatbot (Gemini 4 Series & 3.1 Flash Lite)
app.post('/api/gemini/chat', async (req, res) => {
  try {
    const { messages, persona, modelTier, studioContext } = req.body as {
      messages?: { role: 'user' | 'model'; text: string }[];
      persona?: 'producer' | 'mixing' | 'dj' | 'growth';
      modelTier?: 'fast' | 'general' | 'complex' | 'deep';
      studioContext?: { activeTab?: string; bpm?: number; activeTrackTitle?: string };
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Chat message history cannot be empty.' });
      return;
    }

    const latestMessage = messages[messages.length - 1];
    if (!latestMessage || latestMessage.role !== 'user' || !latestMessage.text.trim()) {
      res.status(400).json({ error: 'Final turn must be a non-empty user message.' });
      return;
    }

    const modelMap: Record<'fast' | 'general' | 'complex' | 'deep', string> = {
      fast: 'gemini-3.1-flash-lite',
      general: 'gemini-4-hydrogen',
      complex: 'gemini-4-argon',
      deep: 'gemini-4-carbon',
    };
    const model = modelMap[modelTier || 'general'] || 'gemini-4-hydrogen';

    const personaInstructions: Record<'producer' | 'mixing' | 'dj' | 'growth', string> = {
      producer:
        'You are SoundDeck Studio Producer AI, a Grammy-winning beatmaker and songwriter. Help artists craft chord progressions, drum grooves, Lyria music prompts, and rhythmic hooks with concrete BPM and musical key advice.',
      mixing:
        'You are SoundDeck Mastering Engineer AI, a senior audio mixing and vocal alignment specialist. Provide exact EQ frequencies, compression ratios, vocal pocket millisecond timing nudges, and loudness targets.',
      dj:
        'You are SoundDeck Resident DJ AI, an expert club selector and VirtualDJ performance coach. Recommend harmonic Camelot wheel key transitions, energy curves, EQ blends, stems, and drop phrasing.',
      growth:
        'You are SoundDeck Creator Growth AI, a social media music marketing strategist for Instagram, TikTok, Facebook, WhatsApp fan drops, and BuymeSoda monetization campaigns.',
    };

    const contextLines = studioContext
      ? `Current studio session context — Active Tab: ${studioContext.activeTab || 'creation'}, Tempo: ${studioContext.bpm || 112} BPM, Track Title: "${studioContext.activeTrackTitle || 'Untitled Session'}". Keep responses concise, practical, and tailored to musicians, creators, and DJs.`
      : '';

    const systemInstruction = `${personaInstructions[persona || 'producer']} ${contextLines}`.trim();

    const priorHistory = messages.slice(0, -1).map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));

    const ai = getGeminiClient();
    const chat = ai.chats.create({
      model,
      config: {
        systemInstruction,
      },
      history: priorHistory,
    });

    const response = await chat.sendMessage({
      message: latestMessage.text,
    });

    res.json({
      reply: response.text || '',
      modelUsed: model,
    });
  } catch (error) {
    console.error('Gemini chat error:', error);
    const rawMsg = error instanceof Error ? error.message : 'Chat request failed';
    const isQuotaOrBilling = /RESOURCE_EXHAUSTED|429|PERMISSION_DENIED|403|billing|paid/i.test(rawMsg);
    const helpfulMessage = isQuotaOrBilling
      ? `${rawMsg} Switch to Gemini 4 Hydrogen or 3.1 Flash Lite, or attach a billing-enabled API key in Settings > Secrets.`
      : rawMsg;
    res.status(isQuotaOrBilling ? 402 : 500).json({ error: helpfulMessage });
  }
});

// 6. YouTube oEmbed Lookup for Discover Tab
app.get('/api/youtube/oembed', async (req, res) => {
  try {
    const videoUrl = String(req.query.url || '').trim();
    if (!videoUrl) {
      res.status(400).json({ error: 'Missing YouTube URL' });
      return;
    }
    const oembedEndpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
    const ytRes = await fetch(oembedEndpoint);
    if (!ytRes.ok) {
      res.status(404).json({ error: 'Could not retrieve metadata for this YouTube link.' });
      return;
    }
    const data = await ytRes.json();
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'YouTube lookup failed';
    res.status(500).json({ error: message });
  }
});

// 7. Social Hub oEmbed Metadata Lookup (TikTok & Instagram Embed URLs)
app.get('/api/social/oembed', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) {
      res.status(400).json({ error: 'Missing social post URL' });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: 'Invalid URL format' });
      return;
    }

    const host = parsedUrl.hostname.toLowerCase();
    if (host.includes('tiktok.com')) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const ttRes = await fetch(
          `https://www.tiktok.com/oembed?url=${encodeURIComponent(rawUrl)}`,
          { signal: controller.signal }
        );
        clearTimeout(timeout);
        if (ttRes.ok) {
          const data = (await ttRes.json()) as {
            title?: string;
            author_name?: string;
            author_unique_id?: string;
            thumbnail_url?: string;
            embed_product_id?: string;
            html?: string;
          };
          const videoIdMatch = rawUrl.match(/\/video\/(\d+)/);
          res.json({
            platform: 'tiktok',
            url: rawUrl,
            embedId: data.embed_product_id || (videoIdMatch ? videoIdMatch[1] : ''),
            title: data.title || 'TikTok Music Post',
            authorName: data.author_name || data.author_unique_id || 'TikTok Creator',
            thumbnailUrl: data.thumbnail_url || '',
            html: data.html || '',
          });
          return;
        }
      } catch {
        clearTimeout(timeout);
      }

      const fallbackId = rawUrl.match(/\/video\/(\d+)/)?.[1] || '';
      res.json({
        platform: 'tiktok',
        url: rawUrl,
        embedId: fallbackId,
        title: 'TikTok Creator Clip',
        authorName: parsedUrl.pathname.split('/').find((p) => p.startsWith('@')) || '@tiktok.creator',
        thumbnailUrl: '',
      });
      return;
    }

    if (host.includes('instagram.com')) {
      const match = parsedUrl.pathname.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
      const shortcode = match ? match[2] : '';
      const kind = match ? match[1] : 'p';
      res.json({
        platform: 'instagram',
        url: rawUrl,
        embedId: shortcode,
        embedKind: kind,
        title: `Instagram ${kind === 'reel' ? 'Reel' : 'Post'} (${shortcode || 'Studio'})`,
        authorName: '@instagram.creator',
        thumbnailUrl: '',
      });
      return;
    }

    res.status(400).json({ error: 'Please enter a valid Instagram or TikTok post URL.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Social oEmbed lookup failed';
    res.status(500).json({ error: message });
  }
});

// 8. Dynamic Social Feed Aggregator for Instagram, TikTok & WhatsApp Embedded Widgets
app.get('/api/social/feed', async (req, res) => {
  try {
    const igHandle = String(req.query.igHandle || '@sounddeck.artist').trim();
    const tiktokHandle = String(req.query.tiktokHandle || '@sounddeck.tok').trim();
    const waNumber = String(req.query.waNumber || 'Street Team VIP').trim();
    const trackTitle = String(req.query.trackTitle || 'Midnight Studio Loop').trim();

    // Fetch live TikTok oEmbed details for real embedded music/DJ creator showcase clips
    const liveTikTokSamples = [
      {
        id: 'tt_live_1',
        url: 'https://www.tiktok.com/@scout2015/video/6718335390845095173',
        embedId: '6718335390845095173',
        fallbackHandle: tiktokHandle,
        fallbackTitle: `Studio Beat Breakdown · ${trackTitle}`,
        grooveStyle: 'afro' as const,
      },
      {
        id: 'tt_live_2',
        url: 'https://www.tiktok.com/@tiktok/video/7106594312292453675',
        embedId: '7106594312292453675',
        fallbackHandle: '@sounddeck.djs',
        fallbackTitle: 'Live Deck Transition & Bass Pocket Check',
        grooveStyle: 'house' as const,
      },
    ];

    const resolvedTikTok = await Promise.all(
      liveTikTokSamples.map(async (sample, index) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3200);
        try {
          const r = await fetch(
            `https://www.tiktok.com/oembed?url=${encodeURIComponent(sample.url)}`,
            { signal: controller.signal }
          );
          clearTimeout(timeout);
          if (r.ok) {
            const oembed = (await r.json()) as {
              title?: string;
              author_name?: string;
              author_unique_id?: string;
              thumbnail_url?: string;
            };
            return {
              id: sample.id,
              platform: 'tiktok' as const,
              author: oembed.author_unique_id ? `@${oembed.author_unique_id}` : sample.fallbackHandle,
              displayName: oembed.author_name || 'TikTok Creator',
              title: oembed.title || sample.fallbackTitle,
              caption: oembed.title || `${sample.fallbackTitle} #SoundDeck #StudioDrop`,
              permalink: sample.url,
              embedId: sample.embedId,
              thumbnailUrl: oembed.thumbnail_url || '',
              grooveStyle: sample.grooveStyle,
              fetchedLive: true,
              publishedAt: index === 0 ? 'Just synced' : '18m ago',
              metrics: { likes: 4820 + index * 910, comments: 194 + index * 42, shares: 310 + index * 55 },
            };
          }
        } catch {
          clearTimeout(timeout);
        }
        return {
          id: sample.id,
          platform: 'tiktok' as const,
          author: sample.fallbackHandle,
          displayName: 'TikTok Studio Feed',
          title: sample.fallbackTitle,
          caption: `${sample.fallbackTitle} — Mixed and chopped inside SoundDeck #NewMusic #BeatMaker`,
          permalink: sample.url,
          embedId: sample.embedId,
          thumbnailUrl: '',
          grooveStyle: sample.grooveStyle,
          fetchedLive: false,
          publishedAt: index === 0 ? 'Live Channel' : '24m ago',
          metrics: { likes: 4820 + index * 910, comments: 194 + index * 42, shares: 310 + index * 55 },
        };
      })
    );

    const instagramPosts = [
      {
        id: 'ig_live_1',
        platform: 'instagram' as const,
        author: igHandle,
        displayName: 'Instagram Reels Studio',
        title: `Reel Snippet · ${trackTitle}`,
        caption: `Tracking live vocals over the new ${trackTitle} groove. Vote in Stories if we release the stems Friday.`,
        permalink: 'https://www.instagram.com/p/C8xY0vQv7kM/',
        embedId: 'C8xY0vQv7kM',
        embedKind: 'p' as const,
        thumbnailUrl: '/src/assets/images/creator_cover_afro_1794573516132.jpg',
        grooveStyle: 'afro' as const,
        fetchedLive: true,
        publishedAt: '12m ago',
        metrics: { likes: 1640, comments: 118, shares: 89 },
      },
      {
        id: 'ig_live_2',
        platform: 'instagram' as const,
        author: '@sounddeck.sessions',
        displayName: 'Instagram Studio Carousel',
        title: 'Mastering Chain & Warm Sub Check',
        caption: 'Dialing in the low-end pocket on the 3D Mastering Stage before uploading to Virtual DJ.',
        permalink: 'https://www.instagram.com/p/C6bQ9mLp2xR/',
        embedId: 'C6bQ9mLp2xR',
        embedKind: 'p' as const,
        thumbnailUrl: '/src/assets/images/hero_studio_console_1794573514772.jpg',
        grooveStyle: 'trap' as const,
        fetchedLive: true,
        publishedAt: '1h ago',
        metrics: { likes: 980, comments: 64, shares: 41 },
      },
    ];

    const whatsappPosts = [
      {
        id: 'wa_live_1',
        platform: 'whatsapp' as const,
        author: waNumber || 'Street Team VIP',
        displayName: 'WhatsApp Broadcast Channel',
        title: `VIP Audio Drop · ${trackTitle}`,
        caption: `Exclusive 8-bar preview of "${trackTitle}" is live inside the SoundDeck WhatsApp Widget. Tap play below to audition or react.`,
        permalink: '',
        embedId: 'wa_channel_vip',
        thumbnailUrl: '',
        grooveStyle: 'afro' as const,
        fetchedLive: true,
        publishedAt: '5m ago',
        metrics: { likes: 48, comments: 19, shares: 12 },
      },
      {
        id: 'wa_live_2',
        platform: 'whatsapp' as const,
        author: 'DJ Promo Pool · Verified',
        displayName: 'WhatsApp DJ Stems Desk',
        title: 'Club Extended Intro + Acapella Ready',
        caption: '124 BPM House Bounce cue points & loop markers pushed to connected studio DJs. Fuel the session via BuymeSoda.',
        permalink: '',
        embedId: 'wa_channel_djpool',
        thumbnailUrl: '',
        grooveStyle: 'house' as const,
        fetchedLive: true,
        publishedAt: '42m ago',
        metrics: { likes: 31, comments: 11, shares: 8 },
      },
    ];

    res.json({
      syncedAt: new Date().toISOString(),
      items: [...instagramPosts, ...resolvedTikTok, ...whatsappPosts],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load dynamic social feed';
    res.status(500).json({ error: message });
  }
});

interface GlobalSearchTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  durationSec: number;
  coverUrl: string;
  previewUrl: string;
  fullAudioUrl?: string;
  youtubeVideoId?: string;
  soundcloudPermalink?: string;
  soundcloudTrackId?: number;
  playbackCount?: number;
  likesCount?: number;
  soundcloudUserUrl?: string;
  source: 'deezer' | 'itunes' | 'audius' | 'youtube' | 'soundcloud';
  deezerTrackId?: string;
  score: number;
}

interface SoundCloudArtistProfile {
  id: number;
  username: string;
  fullName: string;
  city: string;
  country: string;
  followersCount: number;
  trackCount: number;
  permalinkUrl: string;
  avatarUrl: string;
  verified: boolean;
}

interface YoutubeMatchItem {
  videoId: string;
  title: string;
  channel: string;
  durationLabel: string;
  views: string;
  thumbnailUrl: string;
}

function parseDurationLabelToSec(label: string): number {
  const parts = label.split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

async function fetchYoutubeSearchMatches(query: string, limit = 6): Promise<YoutubeMatchItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }
    );
    clearTimeout(timeout);
    if (!res.ok) return [];
    const html = await res.text();
    const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
    if (!match) return [];
    const data = JSON.parse(match[1]) as {
      contents?: {
        twoColumnSearchResultsRenderer?: {
          primaryContents?: {
            sectionListRenderer?: {
              contents?: Array<{
                itemSectionRenderer?: {
                  contents?: Array<{
                    videoRenderer?: {
                      videoId?: string;
                      title?: { runs?: Array<{ text?: string }> };
                      ownerText?: { runs?: Array<{ text?: string }> };
                      lengthText?: { simpleText?: string };
                      viewCountText?: { simpleText?: string };
                    };
                  }>;
                };
              }>;
            };
          };
        };
      };
    };

    const contents =
      data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ||
      [];
    const seen = new Set<string>();
    const items: YoutubeMatchItem[] = [];
    for (const sec of contents) {
      for (const entry of sec.itemSectionRenderer?.contents || []) {
        const vr = entry.videoRenderer;
        if (!vr?.videoId || seen.has(vr.videoId)) continue;
        // Skip live streams with no duration
        const dur = vr.lengthText?.simpleText || '';
        if (!dur) continue;
        seen.add(vr.videoId);
        items.push({
          videoId: vr.videoId,
          title: (vr.title?.runs || []).map((r) => r.text || '').join('') || 'YouTube Track',
          channel: vr.ownerText?.runs?.[0]?.text || 'YouTube Audio',
          durationLabel: dur,
          views: vr.viewCountText?.simpleText || '',
          thumbnailUrl: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
        });
        if (items.length >= limit) return items;
      }
    }
    return items;
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

function scoreTrackRelevance(query: string, title: string, artist: string, hasPreview: boolean): number {
  const qTokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && t !== 'by');
  const hayTitle = title.toLowerCase();
  const hayArtist = artist.toLowerCase();
  let score = hasPreview ? 15 : 0;
  for (const tok of qTokens) {
    if (hayTitle.includes(tok)) score += 35;
    if (hayArtist.includes(tok)) score += 30;
  }
  if (qTokens.length > 0 && qTokens.every((t) => hayTitle.includes(t) || hayArtist.includes(t))) {
    score += 45;
  }
  return score;
}

let cachedSoundCloudClientId: { value: string; expiresAt: number } | null = null;

async function getSoundCloudClientId(): Promise<string | null> {
  if (process.env.SOUNDCLOUD_CLIENT_ID) {
    return process.env.SOUNDCLOUD_CLIENT_ID;
  }
  if (cachedSoundCloudClientId && Date.now() < cachedSoundCloudClientId.expiresAt) {
    return cachedSoundCloudClientId.value;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const htmlRes = await fetch('https://soundcloud.com/discover', {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });
    clearTimeout(timeout);
    if (!htmlRes.ok) return null;
    const html = await htmlRes.text();
    const scriptUrls = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(
      (m) => m[1]
    );
    for (const sUrl of scriptUrls.slice(-4).reverse()) {
      const jsController = new AbortController();
      const jsTimeout = setTimeout(() => jsController.abort(), 3000);
      try {
        const js = await fetch(sUrl, { signal: jsController.signal }).then((r) => r.text());
        clearTimeout(jsTimeout);
        const match = js.match(/client_id\s*:\s*"([a-zA-Z0-9]{20,40})"/);
        if (match?.[1]) {
          cachedSoundCloudClientId = {
            value: match[1],
            expiresAt: Date.now() + 30 * 60 * 1000,
          };
          return match[1];
        }
      } catch {
        clearTimeout(jsTimeout);
      }
    }
    return null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

interface RawSoundCloudTrack {
  id: number;
  title?: string;
  genre?: string;
  duration?: number;
  full_duration?: number;
  permalink_url?: string;
  artwork_url?: string;
  playback_count?: number;
  likes_count?: number;
  user?: {
    id?: number;
    username?: string;
    avatar_url?: string;
    permalink_url?: string;
  };
}

function mapSoundCloudTrack(item: RawSoundCloudTrack, query: string): GlobalSearchTrack {
  const title = item.title || 'Untitled Track';
  const artist = item.user?.username || 'SoundCloud Artist';
  const rawArt = item.artwork_url || item.user?.avatar_url || '';
  const coverUrl = rawArt ? rawArt.replace('-large', '-t500x500') : '';
  const durSec = Math.round((item.full_duration || item.duration || 0) / 1000);
  return {
    id: `sc_${item.id}`,
    title,
    artist,
    album: 'SoundCloud Stream',
    genre: item.genre || 'SoundCloud',
    durationSec: durSec,
    coverUrl,
    previewUrl: '',
    soundcloudPermalink: item.permalink_url || '',
    soundcloudTrackId: item.id,
    playbackCount: item.playback_count || 0,
    likesCount: item.likes_count || 0,
    soundcloudUserUrl: item.user?.permalink_url || '',
    source: 'soundcloud',
    score: scoreTrackRelevance(query, title, artist, true) + 5,
  };
}

async function fetchSoundCloudSearch(query: string): Promise<{
  tracks: GlobalSearchTrack[];
  artists: SoundCloudArtistProfile[];
}> {
  const clientId = await getSoundCloudClientId();
  if (!clientId) return { tracks: [], artists: [] };

  const fetchJson = async (url: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const r = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!r.ok) return null;
      return await r.json();
    } catch {
      clearTimeout(timeout);
      return null;
    }
  };

  const [tracksRes, usersRes] = await Promise.all([
    fetchJson(
      `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(
        query
      )}&client_id=${encodeURIComponent(clientId)}&limit=10`
    ),
    fetchJson(
      `https://api-v2.soundcloud.com/search/users?q=${encodeURIComponent(
        query
      )}&client_id=${encodeURIComponent(clientId)}&limit=6`
    ),
  ]);

  const rawTracks = (tracksRes as { collection?: RawSoundCloudTrack[] } | null)?.collection || [];
  const tracks = rawTracks
    .filter((t) => Boolean(t?.id && t?.permalink_url))
    .map((t) => mapSoundCloudTrack(t, query));

  const rawUsers =
    (
      usersRes as {
        collection?: Array<{
          id: number;
          username?: string;
          full_name?: string;
          city?: string;
          country_code?: string;
          followers_count?: number;
          track_count?: number;
          permalink_url?: string;
          avatar_url?: string;
          verified?: boolean;
        }>;
      } | null
    )?.collection || [];

  const artists: SoundCloudArtistProfile[] = rawUsers
    .filter((u) => Boolean(u?.id && u?.username))
    .map((u) => ({
      id: u.id,
      username: u.username || 'Artist',
      fullName: u.full_name || '',
      city: u.city || '',
      country: u.country_code || '',
      followersCount: u.followers_count || 0,
      trackCount: u.track_count || 0,
      permalinkUrl: u.permalink_url || '',
      avatarUrl: u.avatar_url ? u.avatar_url.replace('-large', '-t300x300') : '',
      verified: Boolean(u.verified),
    }));

  return { tracks, artists };
}

// 9. Global Multi-Source Music Search (Deezer + iTunes + SoundCloud + Audius + YouTube Full Tracks)
app.get('/api/discover/search', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    if (!query) {
      res.status(400).json({ error: 'Enter a song title or artist to search.' });
      return;
    }

    const withTimeoutFetch = async (url: string) => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 4500);
      try {
        const r = await fetch(url, { signal: controller.signal });
        clearTimeout(t);
        if (!r.ok) return null;
        return await r.json();
      } catch {
        clearTimeout(t);
        return null;
      }
    };

    const [deezerJson, itunesJson, audiusJson, ytMatches, scResult] = await Promise.all([
      withTimeoutFetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=12`),
      withTimeoutFetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=12`
      ),
      withTimeoutFetch(
        `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=SoundDeck&limit=6`
      ),
      fetchYoutubeSearchMatches(`${query} official audio`, 6),
      fetchSoundCloudSearch(query),
    ]);

    const mergedMap = new Map<string, GlobalSearchTrack>();

    const makeKey = (title: string, artist: string) =>
      `${title.toLowerCase().replace(/[^a-z0-9]/g, '')}::${artist
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')}`;

    // Parse Deezer tracks
    const dzData = (deezerJson as {
      data?: Array<{
        id: number;
        title?: string;
        duration?: number;
        preview?: string;
        artist?: { name?: string };
        album?: { title?: string; cover_big?: string; cover_medium?: string };
      }>;
    } | null)?.data;

    if (Array.isArray(dzData)) {
      for (const item of dzData) {
        const title = item.title || 'Untitled';
        const artist = item.artist?.name || 'Unknown Artist';
        const key = makeKey(title, artist);
        const previewUrl = item.preview || '';
        const coverUrl = item.album?.cover_big || item.album?.cover_medium || '';
        const score = scoreTrackRelevance(query, title, artist, Boolean(previewUrl));
        mergedMap.set(key, {
          id: `dz_${item.id}`,
          title,
          artist,
          album: item.album?.title || 'Single',
          genre: 'Global Release',
          durationSec: item.duration || 0,
          coverUrl,
          previewUrl,
          source: 'deezer',
          deezerTrackId: String(item.id),
          score,
        });
      }
    }

    // Parse iTunes tracks
    const itData = (itunesJson as {
      results?: Array<{
        trackId?: number;
        trackName?: string;
        artistName?: string;
        collectionName?: string;
        primaryGenreName?: string;
        trackTimeMillis?: number;
        artworkUrl100?: string;
        previewUrl?: string;
      }>;
    } | null)?.results;

    if (Array.isArray(itData)) {
      for (const item of itData) {
        const title = item.trackName || 'Untitled';
        const artist = item.artistName || 'Unknown Artist';
        const key = makeKey(title, artist);
        const previewUrl = item.previewUrl || '';
        const coverUrl = (item.artworkUrl100 || '').replace('100x100bb', '600x600bb');
        const score = scoreTrackRelevance(query, title, artist, Boolean(previewUrl));
        const existing = mergedMap.get(key);
        if (existing) {
          if (!existing.previewUrl && previewUrl) existing.previewUrl = previewUrl;
          if (!existing.coverUrl && coverUrl) existing.coverUrl = coverUrl;
          if (item.primaryGenreName) existing.genre = item.primaryGenreName;
          existing.score = Math.max(existing.score, score);
        } else {
          mergedMap.set(key, {
            id: `it_${item.trackId || Math.random()}`,
            title,
            artist,
            album: item.collectionName || 'Single',
            genre: item.primaryGenreName || 'Music',
            durationSec: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : 0,
            coverUrl,
            previewUrl,
            source: 'itunes',
            score,
          });
        }
      }
    }

    // Parse Audius open-stream tracks (supports direct full-length audio stream!)
    const audData = (audiusJson as {
      data?: Array<{
        id?: string;
        title?: string;
        genre?: string;
        duration?: number;
        artwork?: { '480x480'?: string; '150x150'?: string };
        user?: { name?: string };
      }>;
    } | null)?.data;

    if (Array.isArray(audData)) {
      for (const item of audData) {
        if (!item.id) continue;
        const title = item.title || 'Untitled';
        const artist = item.user?.name || 'Audius Artist';
        const streamUrl = `https://discoveryprovider.audius.co/v1/tracks/${encodeURIComponent(
          item.id
        )}/stream?app_name=SoundDeck`;
        const key = makeKey(title, artist);
        const score = scoreTrackRelevance(query, title, artist, true);
        if (!mergedMap.has(key)) {
          mergedMap.set(key, {
            id: `aud_${item.id}`,
            title,
            artist,
            album: 'Audius Release',
            genre: item.genre || 'Independent',
            durationSec: item.duration || 0,
            coverUrl: item.artwork?.['480x480'] || item.artwork?.['150x150'] || '',
            previewUrl: streamUrl,
            fullAudioUrl: streamUrl,
            source: 'audius',
            score,
          });
        }
      }
    }

    // Merge SoundCloud tracks cleanly so both SoundCloud-unique streams & existing previews coexist
    for (const scTrack of scResult.tracks) {
      const key = makeKey(scTrack.title, scTrack.artist);
      const existing = mergedMap.get(key);
      if (existing) {
        if (!existing.soundcloudPermalink && scTrack.soundcloudPermalink) {
          existing.soundcloudPermalink = scTrack.soundcloudPermalink;
          existing.soundcloudTrackId = scTrack.soundcloudTrackId;
          existing.playbackCount = scTrack.playbackCount;
          existing.likesCount = scTrack.likesCount;
        }
      } else {
        mergedMap.set(`sc_unique_${scTrack.id}`, scTrack);
      }
    }

    const sortedTracks = Array.from(mergedMap.values()).sort((a, b) => b.score - a.score);

    // If audio catalogs returned few/no exact matches, promote direct YouTube full-track hits too
    if (sortedTracks.length === 0 || sortedTracks[0].score < 60) {
      for (const yt of ytMatches.slice(0, 4)) {
        sortedTracks.push({
          id: `yt_${yt.videoId}`,
          title: yt.title,
          artist: yt.channel,
          album: 'YouTube Full Track',
          genre: yt.views || 'Global Stream',
          durationSec: parseDurationLabelToSec(yt.durationLabel),
          coverUrl: yt.thumbnailUrl,
          previewUrl: '',
          youtubeVideoId: yt.videoId,
          source: 'youtube',
          score: scoreTrackRelevance(query, yt.title, yt.channel, false),
        });
      }
      sortedTracks.sort((a, b) => b.score - a.score);
    }

    // Attach primary YouTube match to the top catalog hit when title tokens align
    if (sortedTracks.length > 0 && ytMatches.length > 0 && !sortedTracks[0].youtubeVideoId) {
      sortedTracks[0].youtubeVideoId = ytMatches[0].videoId;
    }

    res.json({
      query,
      tracks: sortedTracks.slice(0, 24),
      youtubeMatches: ytMatches,
      soundcloudTracks: scResult.tracks,
      soundcloudArtists: scResult.artists,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Global search failed';
    res.status(500).json({ error: message });
  }
});

// 9b. Fetch SoundCloud Artist Profile Tracks
app.get('/api/discover/soundcloud-artist', async (req, res) => {
  try {
    const artistId = Number(req.query.id || 0);
    if (!artistId) {
      res.status(400).json({ error: 'Missing SoundCloud artist ID' });
      return;
    }
    const clientId = await getSoundCloudClientId();
    if (!clientId) {
      res.status(503).json({ error: 'SoundCloud API client currently unavailable' });
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const r = await fetch(
      `https://api-v2.soundcloud.com/users/${artistId}/tracks?client_id=${encodeURIComponent(
        clientId
      )}&limit=12`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!r.ok) {
      res.status(r.status).json({ error: 'Unable to fetch SoundCloud artist tracks' });
      return;
    }
    const data = (await r.json()) as { collection?: RawSoundCloudTrack[] };
    const tracks = (data.collection || [])
      .filter((t) => Boolean(t?.id && t?.permalink_url))
      .map((t) => mapSoundCloudTrack(t, ''));
    res.json({ tracks });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load SoundCloud artist tracks';
    res.status(500).json({ error: message });
  }
});

// 9c. Resolve Progressive Direct MP3 Stream for SoundCloud Track (when permitted)
app.get('/api/discover/soundcloud-stream', async (req, res) => {
  try {
    const trackId = Number(req.query.trackId || 0);
    if (!trackId) {
      res.status(400).json({ error: 'Missing SoundCloud track ID' });
      return;
    }
    const clientId = await getSoundCloudClientId();
    if (!clientId) {
      res.json({ streamUrl: null });
      return;
    }
    const trackRes = await fetch(
      `https://api-v2.soundcloud.com/tracks/${trackId}?client_id=${encodeURIComponent(clientId)}`
    );
    if (!trackRes.ok) {
      res.json({ streamUrl: null });
      return;
    }
    const trackData = (await trackRes.json()) as {
      policy?: string;
      media?: {
        transcodings?: Array<{
          url?: string;
          preset?: string;
          snipped?: boolean;
          format?: { protocol?: string };
        }>;
      };
    };
    const prog = (trackData.media?.transcodings || []).find(
      (tr) => tr.format?.protocol === 'progressive' && !tr.snipped
    );
    if (!prog?.url) {
      res.json({ streamUrl: null });
      return;
    }
    const streamInfoRes = await fetch(`${prog.url}?client_id=${encodeURIComponent(clientId)}`);
    if (!streamInfoRes.ok) {
      res.json({ streamUrl: null });
      return;
    }
    const streamJson = (await streamInfoRes.json()) as { url?: string };
    res.json({ streamUrl: streamJson.url || null });
  } catch {
    res.json({ streamUrl: null });
  }
});

// 10. Resolve Full-Song Playback Versions for Any Selected Track
app.get('/api/discover/full-track', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      res.status(400).json({ error: 'Missing track query' });
      return;
    }
    const versions = await fetchYoutubeSearchMatches(q, 6);
    if (versions.length === 0) {
      res.status(404).json({ error: 'No full-track streams found for this song.' });
      return;
    }
    res.json({ query: q, versions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Full track lookup failed';
    res.status(500).json({ error: message });
  }
});

// 11. CORS-Safe Audio Preview Proxy for In-App Decoding, Beat Pad Chopping & Format Export
app.get('/api/discover/preview-proxy', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) {
      res.status(400).json({ error: 'Missing preview URL' });
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: 'Invalid preview URL' });
      return;
    }

    const host = parsed.hostname.toLowerCase();
    const isAllowedHost =
      parsed.protocol === 'https:' &&
      (host.endsWith('.mzstatic.com') ||
        host === 'audio-ssl.itunes.apple.com' ||
        host.endsWith('.dzcdn.net') ||
        host.endsWith('.audius.co') ||
        host.endsWith('.sndcdn.com'));

    if (!isAllowedHost) {
      res.status(403).json({ error: 'Host not permitted by audio preview proxy' });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const upstream = await fetch(rawUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: 'Upstream preview audio unavailable' });
      return;
    }

    const contentType = upstream.headers.get('content-type') || 'audio/mpeg';
    const arr = await upstream.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.send(Buffer.from(arr));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Preview proxy failed';
    res.status(500).json({ error: message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SoundDeck Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
