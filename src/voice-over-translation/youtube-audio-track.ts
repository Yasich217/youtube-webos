import { SELECTORS } from '../utils';

export const YOUTUBE_PLAYBACK_AUDIO_CHANGE_EVENT = 'onPlaybackAudioChange';
export const YOUTUBE_VIDEO_DATA_CHANGE_EVENT = 'videodatachange';

const DEFAULT_SWITCH_TIMEOUT_MS = 8_000;
const DEFAULT_SWITCH_POLL_MS = 125;

export interface YouTubeAudioLanguageInfo {
  readonly id?: string;
  readonly name?: string;
  readonly isDefault?: boolean;
  readonly isAutoDubbed?: boolean;
  getId?: () => string;
  getName?: () => string;
  getIsDefault?: () => boolean;
  getIsAutoDubbed?: () => boolean;
}

export interface YouTubeAudioTrack {
  readonly id?: string;
  getLanguageInfo?: () => YouTubeAudioLanguageInfo;
  isAutoDubbed?: () => boolean;
}

export interface YouTubeAudioPlayerElement extends HTMLElement {
  getVideoData?: () => { video_id?: string };
  getPlayerResponse?: () => unknown;
  getAudioTrack?: () => YouTubeAudioTrack | null;
  getAvailableAudioTracks?: () => YouTubeAudioTrack[];
  setAudioTrack?: (
    track: YouTubeAudioTrack,
    preservePlaybackPosition?: boolean
  ) => boolean | void;
}

export interface YouTubeAudioTrackSnapshot {
  readonly track: YouTubeAudioTrack;
  readonly opaqueId: string | null;
  readonly languageId: string | null;
  readonly name: string | null;
  readonly isDefault: boolean | null;
  readonly isAutoDubbed: boolean | null;
}

export interface YouTubeAudioTrackInspection {
  readonly player: YouTubeAudioPlayerElement | null;
  readonly videoId: string | null;
  readonly current: YouTubeAudioTrackSnapshot | null;
  readonly original: YouTubeAudioTrackSnapshot | null;
  readonly available: readonly YouTubeAudioTrackSnapshot[];
  readonly canSwitch: boolean;
}

export interface YouTubeAudioTrackRestorePoint {
  readonly videoId: string;
  readonly previousOpaqueId: string;
  readonly forcedOpaqueId: string;
}

export type YouTubeAudioTrackSwitchStatus =
  | 'switched'
  | 'already-selected'
  | 'already-restored'
  | 'aborted'
  | 'current-track-changed'
  | 'player-unavailable'
  | 'video-unavailable'
  | 'video-changed'
  | 'track-unavailable'
  | 'switch-rejected'
  | 'timeout';

export interface YouTubeAudioTrackSwitchResult {
  readonly ok: boolean;
  readonly status: YouTubeAudioTrackSwitchStatus;
  readonly inspection: YouTubeAudioTrackInspection;
  readonly restorePoint: YouTubeAudioTrackRestorePoint | null;
}

export interface YouTubeAudioTrackSwitchOptions {
  readonly expectedVideoId?: string | null;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly signal?: AbortSignal;
}

function safeCall<T>(callback: () => T): T | null {
  try {
    return callback();
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function readInfoString(
  info: YouTubeAudioLanguageInfo,
  property: 'id' | 'name',
  getter: 'getId' | 'getName'
): string | null {
  const method = info[getter];
  const fromGetter =
    typeof method === 'function' ? safeCall(() => method.call(info)) : null;
  return nonEmptyString(fromGetter) ?? nonEmptyString(info[property]);
}

function readInfoBoolean(
  info: YouTubeAudioLanguageInfo,
  property: 'isDefault' | 'isAutoDubbed',
  getter: 'getIsDefault' | 'getIsAutoDubbed'
): boolean | null {
  const method = info[getter];
  const fromGetter =
    typeof method === 'function' ? safeCall(() => method.call(info)) : null;
  if (typeof fromGetter === 'boolean') return fromGetter;
  const fromProperty = info[property];
  return typeof fromProperty === 'boolean' ? fromProperty : null;
}

function snapshotTrack(
  track: YouTubeAudioTrack | null | undefined
): YouTubeAudioTrackSnapshot | null {
  if (!track) return null;
  const info =
    typeof track.getLanguageInfo === 'function'
      ? safeCall(() => track.getLanguageInfo!())
      : null;
  let isAutoDubbed = info
    ? readInfoBoolean(info, 'isAutoDubbed', 'getIsAutoDubbed')
    : null;
  if (isAutoDubbed === null && typeof track.isAutoDubbed === 'function') {
    const trackValue = safeCall(() => track.isAutoDubbed!());
    if (typeof trackValue === 'boolean') isAutoDubbed = trackValue;
  }
  return Object.freeze({
    track,
    opaqueId: nonEmptyString(track.id),
    languageId: info ? readInfoString(info, 'id', 'getId') : null,
    name: info ? readInfoString(info, 'name', 'getName') : null,
    isDefault: info ? readInfoBoolean(info, 'isDefault', 'getIsDefault') : null,
    isAutoDubbed
  });
}

function readPlayerVideoId(
  player: YouTubeAudioPlayerElement | null
): string | null {
  if (!player || typeof player.getVideoData !== 'function') return null;
  return nonEmptyString(safeCall(() => player.getVideoData!())?.video_id);
}

export function getYouTubeAudioPlayer(): YouTubeAudioPlayerElement | null {
  return document.getElementById(
    SELECTORS.PLAYER_ID
  ) as YouTubeAudioPlayerElement | null;
}

export function inspectYouTubeAudioTracks(): YouTubeAudioTrackInspection {
  const player = getYouTubeAudioPlayer();
  if (!player) {
    return Object.freeze({
      player: null,
      videoId: null,
      current: null,
      original: null,
      available: Object.freeze([]),
      canSwitch: false
    });
  }

  const availableResult =
    typeof player.getAvailableAudioTracks === 'function'
      ? safeCall(() => player.getAvailableAudioTracks!())
      : [];
  const rawAvailable = Array.isArray(availableResult) ? availableResult : [];
  const available = Object.freeze(
    rawAvailable
      .map((track) => snapshotTrack(track))
      .filter((track): track is YouTubeAudioTrackSnapshot => Boolean(track))
  );
  const rawCurrent =
    typeof player.getAudioTrack === 'function'
      ? safeCall(() => player.getAudioTrack!())
      : null;
  const directCurrent = snapshotTrack(rawCurrent);
  const current = directCurrent?.opaqueId
    ? (available.find((track) => track.opaqueId === directCurrent.opaqueId) ??
      directCurrent)
    : directCurrent;
  const nonAutoDubbed = available.filter(
    (track) => track.isAutoDubbed === false
  );
  const original =
    available.find(
      (track) => track.isDefault === true && track.isAutoDubbed === false
    ) ??
    (nonAutoDubbed.length === 1 ? nonAutoDubbed[0] : null) ??
    (available.length === 1 && current?.isAutoDubbed !== true
      ? (current ?? available[0] ?? null)
      : null);

  return Object.freeze({
    player,
    videoId: readPlayerVideoId(player),
    current,
    original,
    available,
    canSwitch:
      typeof player.setAudioTrack === 'function' && available.length > 0
  });
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number
) {
  return Number.isFinite(value)
    ? Math.max(min, Math.round(value as number))
    : fallback;
}

function result(
  ok: boolean,
  status: YouTubeAudioTrackSwitchStatus,
  restorePoint: YouTubeAudioTrackRestorePoint | null = null
): YouTubeAudioTrackSwitchResult {
  return Object.freeze({
    ok,
    status,
    inspection: inspectYouTubeAudioTracks(),
    restorePoint
  });
}

function waitForSelectedTrack(
  expectedVideoId: string,
  targetOpaqueId: string,
  options: YouTubeAudioTrackSwitchOptions
): Promise<YouTubeAudioTrackSwitchStatus> {
  const timeoutMs = clampInteger(
    options.timeoutMs,
    DEFAULT_SWITCH_TIMEOUT_MS,
    250
  );
  const pollIntervalMs = clampInteger(
    options.pollIntervalMs,
    DEFAULT_SWITCH_POLL_MS,
    50
  );

  return new Promise((resolve) => {
    const listenedPlayer = getYouTubeAudioPlayer();
    let intervalId: number | null = null;
    let timeoutId: number | null = null;
    let settled = false;

    const cleanup = () => {
      if (intervalId !== null) window.clearInterval(intervalId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      listenedPlayer?.removeEventListener(
        YOUTUBE_PLAYBACK_AUDIO_CHANGE_EVENT,
        check
      );
      listenedPlayer?.removeEventListener(
        YOUTUBE_VIDEO_DATA_CHANGE_EVENT,
        check
      );
      options.signal?.removeEventListener('abort', handleAbort);
    };
    const finish = (status: YouTubeAudioTrackSwitchStatus) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(status);
    };
    const check = () => {
      if (options.signal?.aborted) {
        finish('aborted');
        return;
      }
      const inspection = inspectYouTubeAudioTracks();
      if (!inspection.player) {
        finish('player-unavailable');
        return;
      }
      if (inspection.videoId !== expectedVideoId) {
        finish('video-changed');
        return;
      }
      if (inspection.current?.opaqueId === targetOpaqueId) finish('switched');
    };
    const handleAbort = () => finish('aborted');

    listenedPlayer?.addEventListener(
      YOUTUBE_PLAYBACK_AUDIO_CHANGE_EVENT,
      check
    );
    listenedPlayer?.addEventListener(YOUTUBE_VIDEO_DATA_CHANGE_EVENT, check);
    options.signal?.addEventListener('abort', handleAbort, { once: true });
    intervalId = window.setInterval(check, pollIntervalMs);
    timeoutId = window.setTimeout(() => finish('timeout'), timeoutMs);
    check();
  });
}

async function switchToOpaqueId(
  targetOpaqueId: string,
  options: YouTubeAudioTrackSwitchOptions,
  createRestorePoint: boolean
): Promise<YouTubeAudioTrackSwitchResult> {
  if (options.signal?.aborted) return result(false, 'aborted');
  const before = inspectYouTubeAudioTracks();
  if (!before.player || typeof before.player.setAudioTrack !== 'function') {
    return result(false, 'player-unavailable');
  }
  if (!before.videoId) return result(false, 'video-unavailable');
  if (options.expectedVideoId && before.videoId !== options.expectedVideoId) {
    return result(false, 'video-changed');
  }
  if (before.current?.opaqueId === targetOpaqueId) {
    return result(true, 'already-selected');
  }

  const target = before.available.find(
    (track) => track.opaqueId === targetOpaqueId
  );
  if (!target) return result(false, 'track-unavailable');
  const previousOpaqueId = before.current?.opaqueId;
  const provisionalRestorePoint =
    createRestorePoint && previousOpaqueId
      ? Object.freeze({
          videoId: before.videoId,
          previousOpaqueId,
          forcedOpaqueId: targetOpaqueId
        })
      : null;

  let accepted: boolean | void;
  try {
    accepted = before.player.setAudioTrack(target.track, true);
  } catch {
    return result(false, 'switch-rejected');
  }
  const immediate = inspectYouTubeAudioTracks();
  if (immediate.current?.opaqueId !== targetOpaqueId && accepted === false) {
    return result(false, 'switch-rejected');
  }

  const status =
    immediate.current?.opaqueId === targetOpaqueId
      ? 'switched'
      : await waitForSelectedTrack(before.videoId, targetOpaqueId, options);
  if (status !== 'switched') {
    // setAudioTrack may already have applied the target even when the player
    // rebuilds before it can be observed. Preserve a safe recovery token; the
    // restore routine verifies both video and current opaque ID before acting.
    return result(false, status, provisionalRestorePoint);
  }

  return result(true, 'switched', provisionalRestorePoint);
}

export function switchYouTubeAudioTrack(
  targetOpaqueId: string,
  options: YouTubeAudioTrackSwitchOptions = {}
): Promise<YouTubeAudioTrackSwitchResult> {
  return switchToOpaqueId(targetOpaqueId, options, true);
}

export function switchYouTubeToOriginalAudio(
  options: YouTubeAudioTrackSwitchOptions = {}
): Promise<YouTubeAudioTrackSwitchResult> {
  const inspection = inspectYouTubeAudioTracks();
  const originalOpaqueId = inspection.original?.opaqueId;
  if (!originalOpaqueId) {
    return Promise.resolve(result(false, 'track-unavailable'));
  }
  return switchToOpaqueId(
    originalOpaqueId,
    {
      ...options,
      expectedVideoId: options.expectedVideoId ?? inspection.videoId
    },
    true
  );
}

export async function restoreYouTubeAudioTrack(
  restorePoint: YouTubeAudioTrackRestorePoint,
  options: Omit<YouTubeAudioTrackSwitchOptions, 'expectedVideoId'> = {}
): Promise<YouTubeAudioTrackSwitchResult> {
  const inspection = inspectYouTubeAudioTracks();
  if (!inspection.player) return result(false, 'player-unavailable');
  if (inspection.videoId !== restorePoint.videoId) {
    return result(false, 'video-changed');
  }
  if (inspection.current?.opaqueId === restorePoint.previousOpaqueId) {
    return result(true, 'already-restored');
  }
  if (inspection.current?.opaqueId !== restorePoint.forcedOpaqueId) {
    return result(false, 'current-track-changed');
  }
  if (
    !inspection.available.some(
      (track) => track.opaqueId === restorePoint.previousOpaqueId
    )
  ) {
    return result(false, 'track-unavailable');
  }
  return switchToOpaqueId(
    restorePoint.previousOpaqueId,
    { ...options, expectedVideoId: restorePoint.videoId },
    false
  );
}
