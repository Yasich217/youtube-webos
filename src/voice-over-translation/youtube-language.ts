import { FetchRegistry } from '../hooks';
import {
  getYouTubeAudioPlayer,
  inspectYouTubeAudioTracks,
  type YouTubeAudioPlayerElement,
  YOUTUBE_PLAYBACK_AUDIO_CHANGE_EVENT,
  YOUTUBE_VIDEO_DATA_CHANGE_EVENT
} from './youtube-audio-track';

export const YOUTUBE_LANGUAGE_EVENT = 'ytaf-vot-language-metadata';

const UNKNOWN_LANGUAGE_IDS = new Set(['', 'und', 'zxx', 'mul']);
const MAX_CACHED_VIDEOS = 32;

type UnknownRecord = Record<string, unknown>;

export type YouTubeLanguageSource =
  | 'current-audio'
  | 'default-audio'
  | 'adaptive-audio'
  | 'linked-caption'
  | 'asr-caption'
  | 'player-default';

export interface YouTubeLanguageMetadata {
  readonly videoId: string;
  readonly currentLanguage: string | null;
  readonly currentAudioIsDefault: boolean | null;
  readonly currentAudioIsAutoDubbed: boolean | null;
  readonly originalLanguage: string | null;
  readonly effectiveLanguage: string | null;
  readonly source: YouTubeLanguageSource | null;
  readonly updatedAt: number;
}

export interface YouTubeLanguageMetadataOptions {
  readonly preferOriginalForAutoDub?: boolean;
}

interface CachedPlayerLanguage {
  videoId: string;
  originalLanguage: string | null;
  source: Exclude<YouTubeLanguageSource, 'current-audio'> | null;
  updatedAt: number;
}

const playerLanguageCache = new Map<string, CachedPlayerLanguage>();
let responseHookInstalled = false;
let audioTrackHookInstalled = false;
let listenedAudioPlayer: YouTubeAudioPlayerElement | null = null;
const pendingLanguageEvents = new Set<string>();

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getRecord(
  root: UnknownRecord | null,
  key: string
): UnknownRecord | null {
  return root ? asRecord(root[key]) : null;
}

function finiteIndex(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeYouTubeLanguage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^a\./, '')
    .replace(/^\./, '');
  if (!normalized) return null;
  const match = normalized.match(/^([a-z]{2,3})(?:[-_.]|$)/);
  const primary = match?.[1];
  if (!primary) return null;
  return UNKNOWN_LANGUAGE_IDS.has(primary) ? null : primary;
}

function languageFromTrack(track: UnknownRecord | null): string | null {
  if (!track) return null;
  for (const key of [
    'languageCode',
    'language',
    'audioTrackId',
    'id',
    'vssId'
  ]) {
    const language = normalizeYouTubeLanguage(track[key]);
    if (language) return language;
  }
  return null;
}

function parseEmbeddedPlayerResponse(value: unknown): UnknownRecord | null {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return asRecord(value);
}

function unwrapPlayerResponse(value: unknown): UnknownRecord | null {
  const root = asRecord(value);
  if (!root) return null;
  const embedded = parseEmbeddedPlayerResponse(root.playerResponse);
  return embedded ?? root;
}

function getCaptionRenderer(response: UnknownRecord): UnknownRecord | null {
  return getRecord(
    getRecord(response, 'captions'),
    'playerCaptionsTracklistRenderer'
  );
}

function getDefaultAudioTrack(
  renderer: UnknownRecord | null
): UnknownRecord | null {
  if (!renderer) return null;
  const audioTracks = asArray(renderer.audioTracks).map(asRecord);
  const configuredIndex = finiteIndex(renderer.defaultAudioTrackIndex);
  if (configuredIndex !== null && audioTracks[configuredIndex]) {
    return audioTracks[configuredIndex];
  }
  return (
    audioTracks.find(
      (track) => track?.isDefault === true || track?.audioIsDefault === true
    ) ??
    (audioTracks.length === 1 ? audioTracks[0] : null) ??
    null
  );
}

function getLinkedCaptionLanguage(
  renderer: UnknownRecord | null,
  audioTrack: UnknownRecord | null
): string | null {
  if (!renderer || !audioTrack) return null;
  const captionTracks = asArray(renderer.captionTracks).map(asRecord);
  const defaultCaptionIndex = finiteIndex(audioTrack.defaultCaptionTrackIndex);
  if (defaultCaptionIndex !== null) {
    const language = languageFromTrack(
      captionTracks[defaultCaptionIndex] ?? null
    );
    if (language) return language;
  }
  for (const indexValue of asArray(audioTrack.captionTrackIndices)) {
    const index = finiteIndex(indexValue);
    if (index === null) continue;
    const language = languageFromTrack(captionTracks[index] ?? null);
    if (language) return language;
  }
  return null;
}

function getAdaptiveAudioLanguage(response: UnknownRecord): string | null {
  const streamingData = getRecord(response, 'streamingData');
  if (!streamingData) return null;
  const formats = [
    ...asArray(streamingData.adaptiveFormats),
    ...asArray(streamingData.formats)
  ];
  const audioTracks = formats
    .map(asRecord)
    .map((format) => getRecord(format, 'audioTrack'))
    .filter((track): track is UnknownRecord => Boolean(track))
    .filter((track) => track.isAutoDubbed !== true);
  const preferred =
    audioTracks.find((track) => track.audioIsDefault === true) ??
    audioTracks[0] ??
    null;
  return languageFromTrack(preferred);
}

export function extractPlayerResponseLanguage(
  value: unknown,
  fallbackVideoId: string | null = null
): CachedPlayerLanguage | null {
  const response = unwrapPlayerResponse(value);
  if (!response) return null;
  const videoDetails = getRecord(response, 'videoDetails');
  const videoIdValue = videoDetails?.videoId;
  const videoId =
    typeof videoIdValue === 'string' && videoIdValue
      ? videoIdValue
      : fallbackVideoId;
  if (!videoId) return null;

  const renderer = getCaptionRenderer(response);
  const defaultAudioTrack = getDefaultAudioTrack(renderer);
  const defaultAudioLanguage = languageFromTrack(defaultAudioTrack);
  if (defaultAudioLanguage) {
    return {
      videoId,
      originalLanguage: defaultAudioLanguage,
      source: 'default-audio',
      updatedAt: Date.now()
    };
  }

  const adaptiveAudioLanguage = getAdaptiveAudioLanguage(response);
  if (adaptiveAudioLanguage) {
    return {
      videoId,
      originalLanguage: adaptiveAudioLanguage,
      source: 'adaptive-audio',
      updatedAt: Date.now()
    };
  }

  const linkedCaptionLanguage = getLinkedCaptionLanguage(
    renderer,
    defaultAudioTrack
  );
  if (linkedCaptionLanguage) {
    return {
      videoId,
      originalLanguage: linkedCaptionLanguage,
      source: 'linked-caption',
      updatedAt: Date.now()
    };
  }

  const captionTracks = asArray(renderer?.captionTracks).map(asRecord);
  const asrLanguage = languageFromTrack(
    captionTracks.find((track) => track?.kind === 'asr') ?? null
  );
  if (asrLanguage) {
    return {
      videoId,
      originalLanguage: asrLanguage,
      source: 'asr-caption',
      updatedAt: Date.now()
    };
  }

  const microformat = getRecord(
    getRecord(response, 'microformat'),
    'playerMicroformatRenderer'
  );
  const optionalDefaultLanguage = normalizeYouTubeLanguage(
    videoDetails?.defaultAudioLanguage ?? microformat?.defaultAudioLanguage
  );
  return {
    videoId,
    originalLanguage: optionalDefaultLanguage,
    source: optionalDefaultLanguage ? 'player-default' : null,
    updatedAt: Date.now()
  };
}

function queueLanguageEvent(videoId: string): void {
  if (pendingLanguageEvents.has(videoId)) return;
  pendingLanguageEvents.add(videoId);
  window.setTimeout(() => {
    pendingLanguageEvents.delete(videoId);
    const cached = playerLanguageCache.get(videoId);
    window.dispatchEvent(
      new CustomEvent(YOUTUBE_LANGUAGE_EVENT, {
        detail: cached
          ? { ...cached }
          : {
              videoId,
              originalLanguage: null,
              source: null,
              updatedAt: Date.now()
            }
      })
    );
  }, 0);
}

function rememberPlayerLanguage(metadata: CachedPlayerLanguage): void {
  const previous = playerLanguageCache.get(metadata.videoId);
  if (
    previous?.originalLanguage === metadata.originalLanguage &&
    previous.source === metadata.source
  ) {
    playerLanguageCache.set(metadata.videoId, metadata);
    return;
  }
  playerLanguageCache.delete(metadata.videoId);
  playerLanguageCache.set(metadata.videoId, metadata);
  while (playerLanguageCache.size > MAX_CACHED_VIDEOS) {
    const oldestVideoId = playerLanguageCache.keys().next().value;
    if (typeof oldestVideoId !== 'string') break;
    playerLanguageCache.delete(oldestVideoId);
  }
  queueLanguageEvent(metadata.videoId);
}

function inspectPlayerResponse(
  value: unknown,
  fallbackVideoId: string | null
): void {
  const metadata = extractPlayerResponseLanguage(value, fallbackVideoId);
  if (metadata) rememberPlayerLanguage(metadata);
}

function handleFetchResponse(event: CustomEvent<Response>): void {
  const response = event.detail;
  let pathname = '';
  try {
    pathname = new URL(response.url).pathname;
  } catch {
    return;
  }
  if (pathname !== '/youtubei/v1/player') return;

  void response
    .clone()
    .json()
    .then((value) => inspectPlayerResponse(value, null))
    .catch((error) =>
      console.debug('[VOT] player language metadata unavailable', error)
    );
}

function getCurrentAudioLanguage(): {
  language: string | null;
  isDefault: boolean | null;
  isAutoDubbed: boolean | null;
} {
  try {
    const current = inspectYouTubeAudioTracks().current;
    return {
      language: normalizeYouTubeLanguage(current?.languageId),
      isDefault: current?.isDefault ?? null,
      isAutoDubbed: current?.isAutoDubbed ?? null
    };
  } catch (error) {
    console.debug('[VOT] current audio language unavailable', error);
    return { language: null, isDefault: null, isAutoDubbed: null };
  }
}

function inspectLivePlayerResponse(videoId: string): void {
  const player = getYouTubeAudioPlayer();
  try {
    const response = player?.getPlayerResponse?.();
    if (response) inspectPlayerResponse(response, videoId);
  } catch (error) {
    console.debug('[VOT] live player response unavailable', error);
  }
}

function handleAudioTrackMetadataChange(): void {
  const inspection = inspectYouTubeAudioTracks();
  if (!inspection.videoId) return;
  inspectLivePlayerResponse(inspection.videoId);
  queueLanguageEvent(inspection.videoId);
}

function bindAudioTrackListener(): void {
  const player = getYouTubeAudioPlayer();
  if (player === listenedAudioPlayer) return;
  listenedAudioPlayer?.removeEventListener(
    YOUTUBE_PLAYBACK_AUDIO_CHANGE_EVENT,
    handleAudioTrackMetadataChange
  );
  listenedAudioPlayer?.removeEventListener(
    YOUTUBE_VIDEO_DATA_CHANGE_EVENT,
    handleAudioTrackMetadataChange
  );
  listenedAudioPlayer = player;
  listenedAudioPlayer?.addEventListener(
    YOUTUBE_PLAYBACK_AUDIO_CHANGE_EVENT,
    handleAudioTrackMetadataChange
  );
  listenedAudioPlayer?.addEventListener(
    YOUTUBE_VIDEO_DATA_CHANGE_EVENT,
    handleAudioTrackMetadataChange
  );
}

export function getYouTubeLanguageMetadata(
  videoId: string,
  options: YouTubeLanguageMetadataOptions = {}
): YouTubeLanguageMetadata {
  bindAudioTrackListener();
  inspectLivePlayerResponse(videoId);
  const current = getCurrentAudioLanguage();
  const cached = playerLanguageCache.get(videoId) ?? null;
  const preferOriginal = Boolean(
    options.preferOriginalForAutoDub && current.isAutoDubbed === true
  );
  const effectiveLanguage = preferOriginal
    ? (cached?.originalLanguage ?? null)
    : (current.language ?? cached?.originalLanguage ?? null);
  return {
    videoId,
    currentLanguage: current.language,
    currentAudioIsDefault: current.isDefault,
    currentAudioIsAutoDubbed: current.isAutoDubbed,
    originalLanguage: cached?.originalLanguage ?? null,
    effectiveLanguage,
    source:
      !preferOriginal && current.language
        ? 'current-audio'
        : (cached?.source ?? null),
    updatedAt: Math.max(cached?.updatedAt ?? 0, Date.now())
  };
}

export function installYouTubeLanguageResponseHook(): void {
  if (responseHookInstalled) return;
  responseHookInstalled = true;
  FetchRegistry.getInstance().addEventListener('response', handleFetchResponse);
}

export function installYouTubeAudioTrackLanguageHook(): void {
  if (audioTrackHookInstalled) return;
  audioTrackHookInstalled = true;
  window.addEventListener('ytaf-page-update', bindAudioTrackListener);
  document.addEventListener('DOMContentLoaded', bindAudioTrackListener, {
    once: true
  });
  window.setTimeout(bindAudioTrackListener, 0);
}

installYouTubeLanguageResponseHook();
installYouTubeAudioTrackLanguageHook();
