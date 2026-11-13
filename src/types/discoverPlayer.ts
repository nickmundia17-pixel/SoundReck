export interface GlobalSearchTrack {
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
  source: 'deezer' | 'itunes' | 'audius' | 'youtube' | 'soundcloud' | 'catalog';
  score: number;
}

export interface SoundCloudArtistProfile {
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

export interface YoutubeMatchItem {
  videoId: string;
  title: string;
  channel: string;
  durationLabel: string;
  views: string;
  thumbnailUrl: string;
}

export interface PersistentPlayerState {
  track: GlobalSearchTrack;
  mode: 'preview' | 'full';
  youtubeVersions: YoutubeMatchItem[];
  activeYoutubeVideoId: string | null;
  activeSoundCloudPermalink?: string | null;
  loadingFullStream: boolean;
}
