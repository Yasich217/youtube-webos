import VOTClient from '@vot.js/core';
import { VideoService } from '@vot.js/core/types/service';
import type { VideoTranslationResponse } from '@vot.js/core/types/yandex';
import type { RequestLang, ResponseLang } from '@vot.js/shared/types/data';

import {
  configAddChangeListener,
  configRead,
  configRemoveChangeListener,
  configWrite
} from '../config';
import { getVideo, isWatchPage, SELECTORS } from '../utils';
import {
  type AudioPlaybackState,
  type AudioPositionRequest,
  type AudioServiceStatus,
  AudioServiceError,
  VOTAudioServiceClient
} from './audio-service-client';
import { isVotProxyAuthInvalidError } from './proxy-auth-contract';
import { votProxyFetch } from './proxy-fetch';
import { votPairingClient } from './pairing-client';
import { TranslationSettingsDebounce } from './settings-debounce';
import {
  inspectYouTubeAudioTracks,
  restoreYouTubeAudioTrack,
  switchYouTubeAudioTrack,
  switchYouTubeToOriginalAudio,
  type YouTubeAudioTrackRestorePoint
} from './youtube-audio-track';
import {
  getYouTubeLanguageMetadata,
  type YouTubeLanguageMetadata,
  type YouTubeLanguageSource,
  YOUTUBE_LANGUAGE_EVENT
} from './youtube-language';

const MIN_TRANSLATION_RETRY_MS = 2_000;
const DEFAULT_TRANSLATION_RETRY_MS = 5_000;
const MAX_TRANSLATION_RETRY_MS = 60_000;
const DOM_RETRY_MS = 250;
const AUDIO_STATUS_INTERVAL_MS = 3_000;
const AUDIO_DRIFT_THRESHOLD_SECONDS = 0.35;
const AUDIO_HEARTBEAT_INTERVAL_MS = 30_000;
const AUDIO_LEASE_MS = 120_000;
const AUDIO_LOAD_RETRY_DELAYS_MS = [5_000, 30_000] as const;
const SEEK_SYNC_DEBOUNCE_MS = 120;
const LANGUAGE_METADATA_WAIT_MS = 2_500;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,}$/;
const REQUEST_LANGUAGES = new Set<RequestLang>([
  'auto',
  'ru',
  'en',
  'zh',
  'ko',
  'lt',
  'lv',
  'ar',
  'fr',
  'it',
  'es',
  'de',
  'ja'
]);
const RESPONSE_LANGUAGES = new Set<ResponseLang>(['ru', 'en', 'kk']);

type VoiceOverTranslationMode = 'foreign' | 'always';

export type VoiceOverTranslationStatus =
  | 'disabled'
  | 'idle'
  | 'detecting'
  | 'skipped'
  | 'requesting'
  | 'waiting'
  | 'ready'
  | 'error';

export interface VoiceOverTranslationState {
  readonly status: VoiceOverTranslationStatus;
  readonly videoId: string | null;
  readonly videoUrl: string | null;
  readonly videoAttached: boolean;
  readonly videoPaused: boolean | null;
  readonly videoPosition: number | null;
  readonly playbackRate: number | null;
  readonly mode: VoiceOverTranslationMode;
  readonly configuredSourceLanguage: RequestLang;
  readonly targetLanguage: ResponseLang;
  readonly detectedLanguage: string | null;
  readonly originalLanguage: string | null;
  readonly languageSource: YouTubeLanguageSource | null;
  readonly languageDecision: string | null;
  readonly balance: number;
  readonly originalVideoVolume: number | null;
  readonly videoVolume: number;
  readonly translationVolume: number;
  readonly translationId: string | null;
  readonly translationStatus: number | null;
  readonly remainingTime: number | null;
  readonly audioUrl: string | null;
  readonly audioServiceStatus: AudioPlaybackState | 'unloaded' | 'stopped';
  readonly audioPosition: number | null;
  readonly error: string | null;
  readonly audioError: string | null;
  readonly updatedAt: string;
}

export const VOICE_OVER_TRANSLATION_STATE_EVENT = 'ytaf-vot-state-change';
export const VOICE_OVER_TRANSLATION_PAIRING_REQUIRED_EVENT =
  'ytaf-vot-pairing-required';

export interface VoiceOverTranslationPublicState {
  readonly status: VoiceOverTranslationStatus;
  readonly videoId: string | null;
  readonly remainingTime: number | null;
  readonly detectedLanguage: string | null;
  readonly targetLanguage: ResponseLang;
  readonly languageDecision: string | null;
  readonly audioServiceStatus: AudioPlaybackState | 'unloaded' | 'stopped';
  readonly hasError: boolean;
  readonly hasAudioError: boolean;
}

const PUBLIC_STATE_KEYS = [
  'status',
  'videoId',
  'remainingTime',
  'detectedLanguage',
  'targetLanguage',
  'languageDecision',
  'audioServiceStatus',
  'hasError',
  'hasAudioError'
] as const satisfies readonly (keyof VoiceOverTranslationPublicState)[];

function publicState(
  state: VoiceOverTranslationState
): VoiceOverTranslationPublicState {
  return {
    status: state.status,
    videoId: state.videoId,
    remainingTime: state.remainingTime,
    detectedLanguage: state.detectedLanguage,
    targetLanguage: state.targetLanguage,
    languageDecision: state.languageDecision,
    audioServiceStatus: state.audioServiceStatus,
    hasError: Boolean(state.error),
    hasAudioError: Boolean(state.audioError)
  };
}

function publicStateChanged(
  previous: VoiceOverTranslationState,
  next: VoiceOverTranslationState
): boolean {
  const previousPublic = publicState(previous);
  const nextPublic = publicState(next);
  return PUBLIC_STATE_KEYS.some(
    (key) => previousPublic[key] !== nextPublic[key]
  );
}

interface TVPlayerElement extends HTMLElement {
  getVideoData?: () => { video_id?: string };
}

interface NavigationState {
  isWatch: boolean;
  videoId: string | null;
}

interface ConfigChange {
  detail: { key?: string; newValue: unknown };
}

interface VoiceOverMix {
  balance: number;
  videoVolume: number;
  translationVolume: number;
}

interface TranslationDecision {
  action: 'wait' | 'skip' | 'translate';
  reason: string;
  requestLang: RequestLang;
  responseLang: ResponseLang;
  forceSourceLang: boolean;
  metadata: YouTubeLanguageMetadata;
}

function readTranslationMode(): VoiceOverTranslationMode {
  return configRead('voiceOverTranslationMode') === 'always'
    ? 'always'
    : 'foreign';
}

function readSourceLanguage(): RequestLang {
  const configured = configRead('voiceOverTranslationSourceLanguage');
  return REQUEST_LANGUAGES.has(configured as RequestLang)
    ? (configured as RequestLang)
    : 'auto';
}

function readTargetLanguage(): ResponseLang {
  const configured = configRead('voiceOverTranslationTargetLanguage');
  return RESPONSE_LANGUAGES.has(configured as ResponseLang)
    ? (configured as ResponseLang)
    : 'ru';
}

function getVoiceOverMix(): VoiceOverMix {
  const configuredOriginal = Number(
    configRead('voiceOverTranslationOriginalVolume')
  );
  const configuredTranslation = Number(
    configRead('voiceOverTranslationVolume')
  );
  const originalPercent = Number.isFinite(configuredOriginal)
    ? Math.min(100, Math.max(0, configuredOriginal))
    : 100;
  const translationPercent = Number.isFinite(configuredTranslation)
    ? Math.min(100, Math.max(0, configuredTranslation))
    : 50;
  return {
    balance: translationPercent,
    videoVolume: originalPercent / 100,
    translationVolume: translationPercent / 100
  };
}

function validVideoId(value: string | null | undefined): string | null {
  return value && YOUTUBE_VIDEO_ID_RE.test(value) ? value : null;
}

function getHashNavigation(): NavigationState {
  const rawHash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;

  if (!rawHash) return { isWatch: false, videoId: null };

  try {
    const url = new URL(rawHash, window.location.origin);
    return {
      isWatch: url.pathname === '/watch',
      videoId: validVideoId(url.searchParams.get('v'))
    };
  } catch (error) {
    console.warn('[VOT] could not parse TV route hash', rawHash, error);
    return { isWatch: false, videoId: null };
  }
}

function getPlayerVideoId(): string | null {
  const player = document.getElementById(
    SELECTORS.PLAYER_ID
  ) as TVPlayerElement | null;
  if (!player || typeof player.getVideoData !== 'function') return null;

  try {
    return validVideoId(player.getVideoData()?.video_id);
  } catch (error) {
    console.debug('[VOT] player video data is not ready', error);
    return null;
  }
}

export function getCurrentYouTubeTVNavigation(): NavigationState {
  const hash = getHashNavigation();
  const isWatch = hash.isWatch || isWatchPage();
  if (!isWatch) return { isWatch: false, videoId: null };

  const searchVideoId = validVideoId(
    new URLSearchParams(window.location.search).get('v')
  );
  return {
    isWatch: true,
    videoId: hash.videoId ?? searchVideoId ?? getPlayerVideoId()
  };
}

function findWatchVideo(): HTMLVideoElement | null {
  const container = document.getElementById(SELECTORS.PLAYER_CONTAINER);
  const candidate = container?.querySelector('video') ?? getVideo();
  return candidate instanceof HTMLVideoElement ? candidate : null;
}

function getTranslationRetryDelay(remainingTime: number): number {
  if (!Number.isFinite(remainingTime) || remainingTime <= 0) {
    return DEFAULT_TRANSLATION_RETRY_MS;
  }
  return Math.min(
    Math.max(Math.round(remainingTime * 1_000), MIN_TRANSLATION_RETRY_MS),
    MAX_TRANSLATION_RETRY_MS
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function textEncoderAvailable(): boolean {
  if (typeof TextEncoder !== 'function') return false;
  try {
    const bytes = new TextEncoder().encode('\u2713');
    return (
      bytes.length === 3 &&
      bytes[0] === 0xe2 &&
      bytes[1] === 0x9c &&
      bytes[2] === 0x93
    );
  } catch {
    return false;
  }
}

function translationCapabilityError(): string | null {
  const missing: string[] = [];
  if (!textEncoderAvailable()) missing.push('TextEncoder');
  if (
    typeof window.crypto !== 'object' ||
    typeof window.crypto.subtle !== 'object' ||
    typeof window.crypto.subtle.importKey !== 'function' ||
    typeof window.crypto.subtle.sign !== 'function'
  ) {
    missing.push('WebCrypto');
  }
  if (typeof AbortController !== 'function') missing.push('AbortController');
  if (
    typeof AbortSignal !== 'function' ||
    typeof AbortSignal.timeout !== 'function'
  ) {
    missing.push('AbortSignal.timeout');
  }
  return missing.length
    ? `Unsupported webOS browser capabilities: ${missing.join(', ')}`
    : null;
}

function stateForLog(state: VoiceOverTranslationState) {
  return {
    ...state,
    audioUrl: state.audioUrl ? '[available; redacted]' : null
  };
}

function initialState(
  status: VoiceOverTranslationStatus,
  videoId: string | null
): VoiceOverTranslationState {
  const mix = getVoiceOverMix();
  return Object.freeze({
    status,
    videoId,
    videoUrl: videoId ? `https://youtu.be/${videoId}` : null,
    videoAttached: false,
    videoPaused: null,
    videoPosition: null,
    playbackRate: null,
    mode: readTranslationMode(),
    configuredSourceLanguage: readSourceLanguage(),
    targetLanguage: readTargetLanguage(),
    detectedLanguage: null,
    originalLanguage: null,
    languageSource: null,
    languageDecision: null,
    balance: mix.balance,
    originalVideoVolume: null,
    videoVolume: mix.videoVolume,
    translationVolume: mix.translationVolume,
    translationId: null,
    translationStatus: null,
    remainingTime: null,
    audioUrl: null,
    audioServiceStatus: 'unloaded',
    audioPosition: null,
    error: null,
    audioError: null,
    updatedAt: new Date().toISOString()
  });
}

export class VoiceOverTranslationController {
  readonly #votClient = new VOTClient({
    host: 'https://api.browser.yandex.ru',
    fetchFn: votProxyFetch,
    requestLang: 'en',
    responseLang: 'ru'
  });

  readonly #audioClient = new VOTAudioServiceClient();
  readonly #domObserver: MutationObserver;
  #state: VoiceOverTranslationState;
  #activeVideoId: string | null = null;
  #video: HTMLVideoElement | null = null;
  #balancedVideo: HTMLVideoElement | null = null;
  #originalVideoVolume: number | null = null;
  #generation = 0;
  #translationRequestInFlight = false;
  #translationRetryTimer: number | null = null;
  #languageWaitTimer: number | null = null;
  #languageWaitExpiredVideoId: string | null = null;
  #reconcileTimer: number | null = null;
  #heartbeatTimer: number | null = null;
  #seekSyncTimer: number | null = null;
  #lastStatusCheckAt = 0;
  #statusCheckInFlight = false;
  #pauseScheduled = false;
  #mediaWaiting = false;
  #audioLoadedVideoId: string | null = null;
  #audioLoadScheduledVideoId: string | null = null;
  #audioLoadRetryTimer: number | null = null;
  #audioLoadFailureCount = 0;
  #audioLoadRetryExhaustedGeneration: number | null = null;
  #audioQueue: Promise<void> = Promise.resolve();
  #audioTrackSwitchAbortController: AbortController | null = null;
  #forcedAudioRestorePoint: YouTubeAudioTrackRestorePoint | null = null;
  #manualAudioOverrideVideoId: string | null = null;
  #audioTrackRestoreQueue: Promise<void> = Promise.resolve();
  #audioTrackRestorePending: YouTubeAudioTrackRestorePoint | null = null;
  #mixRevision = 0;
  #livelyAuthValid = false;
  #livelyAuthCheckedAt = 0;
  #destroyed = false;
  readonly #languageSettingsDebounce = new TranslationSettingsDebounce({
    onFirstChange: () => this.#resetForTranslationSettings('language changed'),
    onSettled: () => {
      if (!this.#destroyed && configRead('enableVoiceOverTranslation')) {
        this.#maybeRequestTranslation();
      }
    }
  });
  readonly #capabilityError: string | null;

  constructor() {
    this.#domObserver = new MutationObserver(this.#handleDomMutations);
    this.#capabilityError = translationCapabilityError();
    const initialVideoId = getCurrentYouTubeTVNavigation().videoId;
    const enabled = Boolean(configRead('enableVoiceOverTranslation'));
    this.#state = initialState(
      enabled && this.#capabilityError
        ? 'error'
        : enabled
          ? 'idle'
          : 'disabled',
      initialVideoId
    );
    if (enabled && this.#capabilityError) {
      this.#state = Object.freeze({
        ...this.#state,
        error: this.#capabilityError,
        updatedAt: new Date().toISOString()
      });
      console.error('[VOT] browser capability gate failed', {
        textEncoder: textEncoderAvailable(),
        webCrypto: Boolean(window.crypto?.subtle),
        abortController: typeof AbortController === 'function',
        abortTimeout:
          typeof AbortSignal === 'function' &&
          typeof AbortSignal.timeout === 'function'
      });
    }

    window.addEventListener('hashchange', this.#handleNavigation);
    window.addEventListener('popstate', this.#handleNavigation);
    window.addEventListener('pageshow', this.#handleNavigation);
    window.addEventListener('ytaf-page-update', this.#handleNavigation);
    window.addEventListener(
      YOUTUBE_LANGUAGE_EVENT,
      this.#handleLanguageMetadata
    );
    window.addEventListener('pagehide', this.#handlePageHide);
    window.addEventListener('beforeunload', this.#handleBeforeUnload);
    configAddChangeListener(
      'enableVoiceOverTranslation',
      this.#handleConfigChange
    );
    configAddChangeListener(
      'voiceOverTranslationOriginalVolume',
      this.#handleBalanceChange
    );
    configAddChangeListener(
      'voiceOverTranslationVolume',
      this.#handleBalanceChange
    );
    configAddChangeListener(
      'voiceOverTranslationMode',
      this.#handleTranslationSettingsChange
    );
    configAddChangeListener(
      'voiceOverTranslationSourceLanguage',
      this.#handleLanguageSettingsChange
    );
    configAddChangeListener(
      'voiceOverTranslationTargetLanguage',
      this.#handleLanguageSettingsChange
    );
    configAddChangeListener(
      'voiceOverTranslationForceOriginalAudio',
      this.#handleTranslationSettingsChange
    );
    configAddChangeListener(
      'enableVoiceOverTranslationLivelyVoice',
      this.#handleLivelyVoiceChange
    );

    if (document.body) this.#reconcile('initial');
    else document.addEventListener('DOMContentLoaded', this.#handleDomReady);

    console.info('[VOT] controller initialized', stateForLog(this.#state));
  }

  get state(): Readonly<VoiceOverTranslationState> {
    return this.#state;
  }

  #publish(
    patch: Partial<Omit<VoiceOverTranslationState, 'updatedAt'>>,
    log = true
  ): void {
    const previous = this.#state;
    this.#state = Object.freeze({
      ...this.#state,
      ...patch,
      updatedAt: new Date().toISOString()
    });
    if (log) console.info('[VOT] state', stateForLog(this.#state));
    this.#dispatchPublicState(previous);
  }

  #dispatchPublicState(previous: VoiceOverTranslationState): void {
    if (!publicStateChanged(previous, this.#state)) return;
    window.dispatchEvent(
      new CustomEvent<VoiceOverTranslationPublicState>(
        VOICE_OVER_TRANSLATION_STATE_EVENT,
        { detail: publicState(this.#state) }
      )
    );
  }

  #applyVideoBalance(log = false): VoiceOverMix {
    const mix = getVoiceOverMix();
    const video = this.#video;

    if (video) {
      if (this.#balancedVideo !== video) {
        this.#restoreVideoVolume('video changed');
        this.#balancedVideo = video;
        this.#originalVideoVolume = video.volume;
      }
      if (video.volume !== mix.videoVolume) video.volume = mix.videoVolume;
    }

    this.#publish(
      {
        balance: mix.balance,
        originalVideoVolume: this.#originalVideoVolume,
        videoVolume: mix.videoVolume,
        translationVolume: mix.translationVolume
      },
      log
    );
    return mix;
  }

  #restoreVideoVolume(reason: string): void {
    const video = this.#balancedVideo;
    const originalVolume = this.#originalVideoVolume;
    this.#balancedVideo = null;
    this.#originalVideoVolume = null;

    if (video && originalVolume !== null) {
      try {
        video.volume = originalVolume;
        console.info('[VOT] original video volume restored', {
          reason,
          volume: originalVolume
        });
      } catch (error) {
        console.warn('[VOT] could not restore original video volume', error);
      }
    }

    if (this.#state) {
      const mix = getVoiceOverMix();
      this.#publish(
        {
          balance: mix.balance,
          originalVideoVolume: null,
          videoVolume: mix.videoVolume,
          translationVolume: mix.translationVolume
        },
        false
      );
    }
  }

  #clearLanguageWait(resetExpired = true): void {
    if (this.#languageWaitTimer !== null) {
      window.clearTimeout(this.#languageWaitTimer);
      this.#languageWaitTimer = null;
    }
    if (resetExpired) this.#languageWaitExpiredVideoId = null;
  }

  #scheduleLanguageWait(videoId: string): void {
    if (
      this.#languageWaitTimer !== null ||
      this.#languageWaitExpiredVideoId === videoId
    ) {
      return;
    }
    this.#languageWaitTimer = window.setTimeout(() => {
      this.#languageWaitTimer = null;
      if (videoId !== this.#activeVideoId || this.#destroyed) return;
      this.#languageWaitExpiredVideoId = videoId;
      this.#maybeRequestTranslation();
    }, LANGUAGE_METADATA_WAIT_MS);
  }

  #getTranslationDecision(videoId: string): TranslationDecision {
    const mode = readTranslationMode();
    const configuredSourceLanguage = readSourceLanguage();
    const responseLang = readTargetLanguage();
    const metadata = getYouTubeLanguageMetadata(videoId, {
      preferOriginalForAutoDub: Boolean(
        configRead('voiceOverTranslationForceOriginalAudio')
      )
    });
    const forceSourceLang = configuredSourceLanguage !== 'auto';
    const detectedLanguage = forceSourceLang
      ? configuredSourceLanguage
      : metadata.effectiveLanguage;
    const supportedDetectedLanguage = REQUEST_LANGUAGES.has(
      detectedLanguage as RequestLang
    )
      ? (detectedLanguage as RequestLang)
      : null;
    const requestLang = forceSourceLang
      ? configuredSourceLanguage
      : (supportedDetectedLanguage ?? 'auto');

    if (detectedLanguage === responseLang) {
      return {
        action: 'skip',
        reason: 'source language already matches target',
        requestLang,
        responseLang,
        forceSourceLang,
        metadata
      };
    }
    if (
      mode === 'foreign' &&
      !detectedLanguage &&
      this.#languageWaitExpiredVideoId !== videoId
    ) {
      return {
        action: 'wait',
        reason: 'waiting for YouTube audio-language metadata',
        requestLang,
        responseLang,
        forceSourceLang,
        metadata
      };
    }
    if (mode === 'foreign' && !detectedLanguage) {
      return {
        action: 'skip',
        reason: 'source language is unknown in foreign-only mode',
        requestLang,
        responseLang,
        forceSourceLang,
        metadata
      };
    }
    return {
      action: 'translate',
      reason: forceSourceLang
        ? 'manual source language'
        : detectedLanguage
          ? 'YouTube language differs from target'
          : 'always mode with automatic source language',
      requestLang,
      responseLang,
      forceSourceLang,
      metadata
    };
  }

  #publishLanguageDecision(decision: TranslationDecision, log = false): void {
    this.#publish(
      {
        mode: readTranslationMode(),
        configuredSourceLanguage: readSourceLanguage(),
        targetLanguage: decision.responseLang,
        detectedLanguage: decision.metadata.effectiveLanguage,
        originalLanguage: decision.metadata.originalLanguage,
        languageSource: decision.metadata.source,
        languageDecision: decision.reason
      },
      log
    );
  }

  #clearSeekSyncTimer(): void {
    if (this.#seekSyncTimer === null) return;
    window.clearTimeout(this.#seekSyncTimer);
    this.#seekSyncTimer = null;
  }

  #scheduleFinalSeek(): void {
    this.#clearSeekSyncTimer();
    this.#seekSyncTimer = window.setTimeout(() => {
      this.#seekSyncTimer = null;
      this.#syncSeek();
    }, SEEK_SYNC_DEBOUNCE_MS);
  }

  #sampleVideo(video = this.#video): AudioPositionRequest | null {
    if (!video || !this.#activeVideoId) return null;
    const position = Number.isFinite(video.currentTime)
      ? Math.max(0, video.currentTime)
      : 0;
    const playbackRate =
      Number.isFinite(video.playbackRate) && video.playbackRate > 0
        ? video.playbackRate
        : 1;
    return {
      videoId: this.#activeVideoId,
      position,
      clientTimestampMs: Date.now(),
      playbackRate
    };
  }

  #translationShouldPlay(video = this.#video): boolean {
    return Boolean(
      video &&
      !video.paused &&
      !video.ended &&
      !video.seeking &&
      !this.#mediaWaiting &&
      getVoiceOverMix().translationVolume > 0
    );
  }

  async #pauseIfVideoStopped(
    status: AudioServiceStatus
  ): Promise<AudioServiceStatus> {
    if (status.state !== 'playing' || this.#translationShouldPlay()) {
      return status;
    }
    const snapshot = this.#sampleVideo();
    return snapshot ? this.#audioClient.pause(snapshot) : status;
  }

  #abortAudioTrackSwitch(): void {
    this.#audioTrackSwitchAbortController?.abort();
    this.#audioTrackSwitchAbortController = null;
  }

  #restoreForcedYouTubeAudio(reason: string): void {
    this.#abortAudioTrackSwitch();
    const restorePoint = this.#forcedAudioRestorePoint;
    if (!restorePoint || this.#audioTrackRestorePending === restorePoint)
      return;
    this.#audioTrackRestorePending = restorePoint;

    const restore = async (): Promise<void> => {
      const result = await restoreYouTubeAudioTrack(restorePoint, {
        timeoutMs: 4_000
      });
      console.info('[VOT] YouTube audio restore', {
        reason,
        videoId: restorePoint.videoId,
        status: result.status
      });
      if (
        result.ok ||
        result.status === 'video-changed' ||
        result.status === 'current-track-changed'
      ) {
        if (this.#forcedAudioRestorePoint === restorePoint) {
          this.#forcedAudioRestorePoint = null;
        }
      }
    };
    const queued = this.#audioTrackRestoreQueue.then(restore, restore);
    this.#audioTrackRestoreQueue = queued
      .catch((error) => {
        console.warn('[VOT] YouTube audio restore failed', error);
      })
      .finally(() => {
        if (this.#audioTrackRestorePending === restorePoint) {
          this.#audioTrackRestorePending = null;
        }
      });
  }

  async #ensureOriginalYouTubeAudio(
    generation: number,
    videoId: string
  ): Promise<void> {
    if (!configRead('voiceOverTranslationForceOriginalAudio')) return;
    if (this.#manualAudioOverrideVideoId === videoId) {
      throw new Error('YouTube audio track was changed by the user');
    }

    await this.#audioTrackRestoreQueue;
    if (generation !== this.#generation || videoId !== this.#activeVideoId) {
      throw new Error('Voice-over translation session changed');
    }

    const inspection = inspectYouTubeAudioTracks();
    if (inspection.videoId !== videoId) {
      throw new Error('YouTube player changed video during audio switch');
    }
    const restorePoint = this.#forcedAudioRestorePoint;
    if (restorePoint) {
      if (inspection.current?.opaqueId === restorePoint.forcedOpaqueId) return;
      if (inspection.current?.opaqueId === restorePoint.previousOpaqueId) {
        this.#forcedAudioRestorePoint = null;
      } else if (!inspection.current?.opaqueId) {
        const verification = await switchYouTubeAudioTrack(
          restorePoint.forcedOpaqueId,
          {
            expectedVideoId: videoId,
            timeoutMs: 4_000
          }
        );
        if (verification.ok) return;
        throw new Error(
          `Could not verify original YouTube audio: ${verification.status}`
        );
      } else {
        this.#forcedAudioRestorePoint = null;
        this.#manualAudioOverrideVideoId = videoId;
        throw new Error('YouTube audio track was changed by the user');
      }
    }
    if (inspection.current?.isAutoDubbed !== true) return;

    this.#abortAudioTrackSwitch();
    const abortController = new AbortController();
    this.#audioTrackSwitchAbortController = abortController;
    try {
      const result = await switchYouTubeToOriginalAudio({
        expectedVideoId: videoId,
        timeoutMs: 8_000,
        signal: abortController.signal
      });
      if (
        generation !== this.#generation ||
        videoId !== this.#activeVideoId ||
        abortController.signal.aborted
      ) {
        if (result.restorePoint) {
          await restoreYouTubeAudioTrack(result.restorePoint, {
            timeoutMs: 4_000
          });
        }
        throw new Error('Voice-over translation session changed');
      }
      if (!result.ok) {
        if (result.restorePoint) {
          await restoreYouTubeAudioTrack(result.restorePoint, {
            timeoutMs: 4_000
          });
        }
        throw new Error(
          `Could not select original YouTube audio: ${result.status}`
        );
      }
      this.#forcedAudioRestorePoint = result.restorePoint;
      console.info('[VOT] original YouTube audio selected', {
        videoId,
        status: result.status,
        restorable: Boolean(result.restorePoint)
      });
    } finally {
      if (this.#audioTrackSwitchAbortController === abortController) {
        this.#audioTrackSwitchAbortController = null;
      }
    }
  }

  #updateVideoSnapshot(log = false): void {
    const video = this.#video;
    this.#publish(
      {
        videoAttached: Boolean(video?.isConnected),
        videoPaused: video ? video.paused : null,
        videoPosition:
          video && Number.isFinite(video.currentTime)
            ? video.currentTime
            : null,
        playbackRate:
          video && Number.isFinite(video.playbackRate)
            ? video.playbackRate
            : null
      },
      log
    );
  }

  #invalidateTranslation(): void {
    this.#clearAudioLoadRetry();
    this.#abortAudioTrackSwitch();
    this.#generation++;
    this.#translationRequestInFlight = false;
    this.#clearLanguageWait();
    if (this.#translationRetryTimer !== null) {
      window.clearTimeout(this.#translationRetryTimer);
      this.#translationRetryTimer = null;
    }
  }

  #scheduleReconcile(delay = 0): void {
    if (this.#destroyed || this.#reconcileTimer !== null) return;
    this.#reconcileTimer = window.setTimeout(() => {
      this.#reconcileTimer = null;
      this.#reconcile('scheduled');
    }, delay);
  }

  #observeVideoDom(): void {
    this.#domObserver.disconnect();
    if (
      document.body &&
      configRead('enableVoiceOverTranslation') &&
      this.#activeVideoId
    ) {
      this.#domObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  #handleDomMutations = (records: MutationRecord[]): void => {
    if (this.#video && !this.#video.isConnected) {
      this.#scheduleReconcile();
      return;
    }

    for (const record of records) {
      for (const node of [...record.addedNodes, ...record.removedNodes]) {
        if (
          node === this.#video ||
          (node instanceof Element &&
            (node.matches('video') || Boolean(node.querySelector('video'))))
        ) {
          this.#scheduleReconcile();
          return;
        }
      }
    }

    if (!this.#video) this.#scheduleReconcile(DOM_RETRY_MS);
  };

  #reconcile(reason: string): void {
    if (this.#destroyed) return;
    const navigation = getCurrentYouTubeTVNavigation();
    const enabled = configRead('enableVoiceOverTranslation');

    if (!navigation.isWatch) {
      this.#leaveVideo(reason);
      return;
    }
    if (!navigation.videoId) {
      this.#leaveVideo(`${reason}: waiting for video id`);
      if (enabled) this.#scheduleReconcile(DOM_RETRY_MS);
      return;
    }

    if (navigation.videoId !== this.#activeVideoId) {
      this.#selectVideo(navigation.videoId, enabled, reason);
    }

    if (!enabled) {
      this.#detachVideo();
      this.#domObserver.disconnect();
      return;
    }

    this.#observeVideoDom();
    const video = findWatchVideo();
    if (video) this.#attachVideo(video);
    else {
      this.#detachVideo();
      this.#scheduleReconcile(DOM_RETRY_MS);
    }
  }

  #selectVideo(videoId: string, enabled: boolean, reason: string): void {
    this.#languageSettingsDebounce.clear();
    const previousVideoId = this.#activeVideoId;
    this.#invalidateTranslation();
    this.#detachVideo();
    this.#stopAudio(previousVideoId, `navigation: ${reason}`);
    this.#manualAudioOverrideVideoId = null;
    this.#activeVideoId = videoId;
    const previous = this.#state;
    this.#state = initialState(enabled ? 'idle' : 'disabled', videoId);
    this.#dispatchPublicState(previous);
    console.info('[VOT] video selected', {
      videoId,
      hash: window.location.hash,
      reason
    });
    console.info('[VOT] state', stateForLog(this.#state));
  }

  #leaveVideo(reason: string): void {
    if (!this.#activeVideoId && !this.#video) return;
    this.#languageSettingsDebounce.clear();
    const previousVideoId = this.#activeVideoId;
    this.#invalidateTranslation();
    this.#detachVideo();
    this.#domObserver.disconnect();
    this.#stopAudio(previousVideoId, `leave: ${reason}`);
    this.#manualAudioOverrideVideoId = null;
    this.#activeVideoId = null;
    const previous = this.#state;
    this.#state = initialState(
      configRead('enableVoiceOverTranslation') ? 'idle' : 'disabled',
      null
    );
    this.#dispatchPublicState(previous);
    console.info('[VOT] left video route', reason);
  }

  #attachVideo(video: HTMLVideoElement): void {
    if (video === this.#video) {
      this.#maybeRequestTranslation();
      if (this.#state.status === 'ready') {
        this.#ensureAudioLoaded(this.#generation);
      }
      return;
    }

    if (this.#video) {
      this.#invalidateTranslation();
      this.#detachVideo();
      this.#stopAudio(this.#activeVideoId, 'video element replaced');
    }

    this.#video = video;
    video.addEventListener('loadedmetadata', this.#handleLoadedMetadata);
    video.addEventListener('play', this.#handlePlay);
    video.addEventListener('playing', this.#handlePlaying);
    video.addEventListener('waiting', this.#handleWaiting);
    video.addEventListener('pause', this.#handlePause);
    video.addEventListener('seeking', this.#handleSeeking);
    video.addEventListener('seeked', this.#handleSeeked);
    video.addEventListener('timeupdate', this.#handleTimeUpdate);
    video.addEventListener('ratechange', this.#handleRateChange);
    video.addEventListener('ended', this.#handleEnded);
    video.addEventListener('error', this.#handleVideoError);
    this.#updateVideoSnapshot(true);

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      this.#maybeRequestTranslation();
    }
    if (this.#state.status === 'ready') {
      this.#ensureAudioLoaded(this.#generation);
    }
  }

  #detachVideo(): void {
    const video = this.#video;
    if (!video) return;
    video.removeEventListener('loadedmetadata', this.#handleLoadedMetadata);
    video.removeEventListener('play', this.#handlePlay);
    video.removeEventListener('playing', this.#handlePlaying);
    video.removeEventListener('waiting', this.#handleWaiting);
    video.removeEventListener('pause', this.#handlePause);
    video.removeEventListener('seeking', this.#handleSeeking);
    video.removeEventListener('seeked', this.#handleSeeked);
    video.removeEventListener('timeupdate', this.#handleTimeUpdate);
    video.removeEventListener('ratechange', this.#handleRateChange);
    video.removeEventListener('ended', this.#handleEnded);
    video.removeEventListener('error', this.#handleVideoError);
    this.#clearSeekSyncTimer();
    this.#pauseScheduled = false;
    this.#mediaWaiting = false;
    this.#restoreVideoVolume('video detached');
    this.#video = null;
    this.#stopHeartbeat();
    this.#updateVideoSnapshot();
  }

  #maybeRequestTranslation(): void {
    if (this.#capabilityError) {
      if (
        configRead('enableVoiceOverTranslation') &&
        (this.#state.status !== 'error' ||
          this.#state.error !== this.#capabilityError)
      ) {
        this.#publish({
          status: 'error',
          error: this.#capabilityError,
          audioError: null
        });
      }
      return;
    }
    if (
      !configRead('enableVoiceOverTranslation') ||
      !this.#activeVideoId ||
      !this.#video ||
      this.#manualAudioOverrideVideoId === this.#activeVideoId ||
      this.#translationRequestInFlight ||
      this.#translationRetryTimer !== null ||
      this.#languageSettingsDebounce.pending ||
      this.#state.status === 'ready'
    ) {
      return;
    }
    const videoId = this.#activeVideoId;
    const decision = this.#getTranslationDecision(videoId);
    this.#publishLanguageDecision(decision);
    if (decision.action === 'wait') {
      this.#scheduleLanguageWait(videoId);
      if (this.#state.status !== 'detecting') {
        this.#publish({ status: 'detecting', error: null }, true);
      }
      return;
    }
    if (decision.action === 'skip') {
      this.#clearLanguageWait(false);
      if (
        this.#state.status !== 'skipped' ||
        this.#state.languageDecision !== decision.reason
      ) {
        this.#publish({
          status: 'skipped',
          translationId: null,
          translationStatus: null,
          remainingTime: null,
          audioUrl: null,
          error: null
        });
      }
      return;
    }

    this.#clearLanguageWait();
    void this.#requestTranslation(videoId, this.#generation, decision);
  }

  #requestLivelyVoicePairing(reason: string): void {
    window.dispatchEvent(
      new CustomEvent(VOICE_OVER_TRANSLATION_PAIRING_REQUIRED_EVENT, {
        detail: { reason }
      })
    );
  }

  async #shouldUseLivelyVoice(decision: TranslationDecision): Promise<boolean> {
    if (!configRead('enableVoiceOverTranslationLivelyVoice')) return false;
    // Yandex currently exposes lively voices only for English-to-Russian VOT.
    if (decision.requestLang !== 'en' || decision.responseLang !== 'ru') {
      return false;
    }
    if (
      this.#livelyAuthValid &&
      Date.now() - this.#livelyAuthCheckedAt < 30_000
    ) {
      return true;
    }

    try {
      const status = await votPairingClient.status();
      this.#livelyAuthCheckedAt = Date.now();
      this.#livelyAuthValid = status.configured && status.valid;
      if (this.#livelyAuthValid) return true;
      configWrite('enableVoiceOverTranslationLivelyVoice', false);
      this.#requestLivelyVoicePairing('Yandex account is not connected');
      return false;
    } catch (error) {
      console.warn('[VOT] lively voice status unavailable', error);
      this.#livelyAuthCheckedAt = 0;
      this.#livelyAuthValid = false;
      configWrite('enableVoiceOverTranslationLivelyVoice', false);
      this.#requestLivelyVoicePairing('Pairing service is unavailable');
      return false;
    }
  }

  async #requestTranslation(
    videoId: string,
    generation: number,
    decision: TranslationDecision
  ): Promise<void> {
    this.#translationRequestInFlight = true;
    this.#publish({ status: 'requesting', error: null });

    const useLivelyVoice = await this.#shouldUseLivelyVoice(decision);
    if (generation !== this.#generation || videoId !== this.#activeVideoId) {
      return;
    }

    const duration = this.#video?.duration;
    const videoData = {
      url: `https://youtu.be/${videoId}`,
      videoId,
      host: VideoService.youtube,
      ...(duration && Number.isFinite(duration) && duration > 0
        ? { duration: Math.round(duration) }
        : {})
    };

    try {
      const response = await this.#votClient.translateVideo({
        videoData: {
          ...videoData,
          ...(decision.requestLang !== 'auto'
            ? { detectedLanguage: decision.requestLang }
            : {})
        },
        requestLang: decision.requestLang,
        responseLang: decision.responseLang,
        headers: useLivelyVoice ? { 'X-Yasich-VOT-Lively': '1' } : {},
        extraOpts: {
          forceSourceLang: decision.forceSourceLang,
          useLivelyVoice
        }
      });
      if (generation !== this.#generation || videoId !== this.#activeVideoId) {
        return;
      }

      this.#translationRequestInFlight = false;
      console.info('[VOT] translation response', {
        translated: response.translated,
        status: response.status,
        translationId: response.translationId,
        remainingTime: response.remainingTime,
        hasUrl: response.translated && Boolean(response.url)
      });
      this.#handleTranslationResponse(videoId, generation, response);
    } catch (error) {
      if (generation !== this.#generation || videoId !== this.#activeVideoId) {
        return;
      }

      this.#translationRequestInFlight = false;
      if (useLivelyVoice && isVotProxyAuthInvalidError(error)) {
        this.#livelyAuthValid = false;
        this.#livelyAuthCheckedAt = 0;
        // The synchronous config listener invalidates this generation and
        // immediately retries the same video with standard voices.
        configWrite('enableVoiceOverTranslationLivelyVoice', false);
        this.#requestLivelyVoicePairing('Yandex authorization expired');
        return;
      }
      console.error('[VOT] translation request failed', error);
      this.#restoreVideoVolume('translation error');
      this.#publish({ status: 'error', error: errorMessage(error) });
      this.#scheduleTranslationRetry(
        videoId,
        generation,
        MAX_TRANSLATION_RETRY_MS
      );
    }
  }

  #handleTranslationResponse(
    videoId: string,
    generation: number,
    response: VideoTranslationResponse
  ): void {
    if (response.translated) {
      this.#publish({
        status: 'ready',
        translationId: response.translationId,
        translationStatus: response.status,
        remainingTime: response.remainingTime,
        audioUrl: response.url,
        error: null
      });
      this.#ensureAudioLoaded(generation);
      return;
    }

    this.#publish({
      status: 'waiting',
      translationId: response.translationId,
      translationStatus: response.status,
      remainingTime: response.remainingTime,
      audioUrl: null,
      error: null
    });
    this.#scheduleTranslationRetry(
      videoId,
      generation,
      getTranslationRetryDelay(response.remainingTime)
    );
  }

  #scheduleTranslationRetry(
    videoId: string,
    generation: number,
    delay: number
  ): void {
    if (this.#translationRetryTimer !== null) {
      window.clearTimeout(this.#translationRetryTimer);
    }
    console.info('[VOT] translation retry scheduled', { videoId, delay });
    this.#translationRetryTimer = window.setTimeout(() => {
      this.#translationRetryTimer = null;
      if (
        generation === this.#generation &&
        videoId === this.#activeVideoId &&
        configRead('enableVoiceOverTranslation')
      ) {
        this.#maybeRequestTranslation();
      }
    }, delay);
  }

  #queueAudio(
    label: string,
    generation: number,
    operation: () => Promise<AudioServiceStatus>,
    onSuccess?: (status: AudioServiceStatus) => void,
    onFinally?: () => void,
    onError?: (error: unknown) => boolean
  ): void {
    const run = async () => {
      if (generation !== this.#generation || this.#destroyed) return;
      try {
        const status = await operation();
        if (generation !== this.#generation || this.#destroyed) return;
        onSuccess?.(status);
      } catch (error) {
        if (generation !== this.#generation || this.#destroyed) return;
        console.error(`[VOT] audio ${label} failed`, error);
        this.#audioLoadedVideoId = null;
        this.#restoreVideoVolume(`audio ${label} error`);
        this.#restoreForcedYouTubeAudio(`audio ${label} error`);
        if (!onError?.(error)) {
          this.#publish({
            audioServiceStatus: 'error',
            audioError: errorMessage(error)
          });
        }
      } finally {
        if (generation === this.#generation && !this.#destroyed) onFinally?.();
      }
    };

    const queued = this.#audioQueue.then(run, run);
    this.#audioQueue = queued.then(
      () => undefined,
      () => undefined
    );
  }

  #clearAudioLoadRetry(resetFailureCount = true): void {
    if (this.#audioLoadRetryTimer !== null) {
      window.clearTimeout(this.#audioLoadRetryTimer);
      this.#audioLoadRetryTimer = null;
    }
    if (resetFailureCount) {
      this.#audioLoadFailureCount = 0;
      this.#audioLoadRetryExhaustedGeneration = null;
    }
  }

  #isRetryableAudioLoadError(error: unknown): boolean {
    if (!(error instanceof AudioServiceError)) return true;
    return [408, 409, 425, 429].includes(error.status) || error.status >= 500;
  }

  #scheduleAudioLoadRetry(
    error: unknown,
    generation: number,
    videoId: string,
    audioUrl: string
  ): boolean {
    const delay = AUDIO_LOAD_RETRY_DELAYS_MS[this.#audioLoadFailureCount];
    if (!this.#isRetryableAudioLoadError(error) || delay === undefined) {
      this.#audioLoadRetryExhaustedGeneration = generation;
      return false;
    }

    this.#audioLoadFailureCount++;
    console.warn('[VOT] audio load retry scheduled', {
      videoId,
      attempt: this.#audioLoadFailureCount + 1,
      delay
    });
    this.#publish({ audioServiceStatus: 'loading', audioError: null });
    this.#audioLoadRetryTimer = window.setTimeout(() => {
      this.#audioLoadRetryTimer = null;
      if (
        this.#destroyed ||
        generation !== this.#generation ||
        videoId !== this.#activeVideoId ||
        audioUrl !== this.#state.audioUrl ||
        this.#state.status !== 'ready' ||
        !configRead('enableVoiceOverTranslation')
      ) {
        return;
      }
      this.#ensureAudioLoaded(generation);
    }, delay);
    return true;
  }

  #applyAudioStatus(status: AudioServiceStatus, log = false): void {
    const failed = status.state === 'error' || Boolean(status.lastError);
    if (failed) {
      this.#audioLoadedVideoId = null;
      this.#restoreForcedYouTubeAudio('audio service error');
    } else if (status.state === 'ended') {
      this.#restoreForcedYouTubeAudio('translated audio ended');
    }
    const video = this.#video;
    const translationPlaying = Boolean(
      !failed &&
      status.state === 'playing' &&
      getVoiceOverMix().translationVolume > 0 &&
      video &&
      !video.paused &&
      !video.ended &&
      !video.seeking &&
      !this.#mediaWaiting
    );
    if (translationPlaying) this.#applyVideoBalance();
    else this.#restoreVideoVolume(`audio service ${status.state}`);
    this.#publish(
      {
        audioServiceStatus: status.state,
        audioPosition: Number.isFinite(status.position)
          ? status.position
          : null,
        audioError: status.lastError ?? null
      },
      log
    );
  }

  async #loadAudioSession(
    videoId: string,
    audioUrl: string,
    generation: number
  ): Promise<AudioServiceStatus> {
    const mix = getVoiceOverMix();
    let status = await this.#audioClient.load({
      audioUrl,
      videoId,
      volume: mix.translationVolume
    });
    if (generation !== this.#generation) return status;

    const snapshot = this.#sampleVideo();
    if (!snapshot) return status;
    status = await this.#audioClient.seek({
      ...snapshot,
      resume: false,
      leaseMs: AUDIO_LEASE_MS
    });
    if (generation !== this.#generation) return status;

    const video = this.#video;
    const playbackMix = getVoiceOverMix();
    if (
      video &&
      !video.paused &&
      !video.ended &&
      !video.seeking &&
      !this.#mediaWaiting &&
      playbackMix.translationVolume > 0
    ) {
      await this.#ensureOriginalYouTubeAudio(generation, videoId);
      const playingSnapshot = this.#sampleVideo();
      if (playingSnapshot && this.#translationShouldPlay(video)) {
        status = await this.#audioClient.play({
          ...playingSnapshot,
          leaseMs: AUDIO_LEASE_MS,
          volume: playbackMix.translationVolume
        });
        status = await this.#pauseIfVideoStopped(status);
      }
    }
    return status;
  }

  #ensureAudioLoaded(generation: number): void {
    const videoId = this.#activeVideoId;
    const audioUrl = this.#state.audioUrl;
    if (
      !videoId ||
      !audioUrl ||
      this.#audioLoadedVideoId === videoId ||
      this.#audioLoadScheduledVideoId === videoId ||
      this.#audioLoadRetryTimer !== null ||
      this.#audioLoadRetryExhaustedGeneration === generation
    ) {
      return;
    }

    this.#audioLoadScheduledVideoId = videoId;
    this.#publish({ audioServiceStatus: 'loading', audioError: null });
    this.#queueAudio(
      'load',
      generation,
      () => this.#loadAudioSession(videoId, audioUrl, generation),
      (status) => {
        this.#clearAudioLoadRetry();
        this.#audioLoadedVideoId = videoId;
        this.#applyAudioStatus(status, true);
        if (this.#video && !this.#video.paused && !this.#video.ended) {
          this.#startHeartbeat();
        }
      },
      () => {
        this.#audioLoadScheduledVideoId = null;
      },
      (error) =>
        this.#scheduleAudioLoadRetry(error, generation, videoId, audioUrl)
    );
  }

  #stopAudio(videoId: string | null, reason: string, keepalive = false): void {
    this.#clearAudioLoadRetry();
    this.#stopHeartbeat();
    this.#clearSeekSyncTimer();
    this.#pauseScheduled = false;
    this.#mediaWaiting = false;
    this.#restoreVideoVolume(reason);
    this.#restoreForcedYouTubeAudio(reason);
    this.#audioLoadedVideoId = null;
    this.#audioLoadScheduledVideoId = null;
    this.#statusCheckInFlight = false;
    this.#lastStatusCheckAt = 0;
    console.info('[VOT] stopping translated audio', { videoId, reason });

    const stop = () => this.#audioClient.stop(videoId, keepalive);
    const queuedStop = this.#audioQueue.then(stop, stop);
    this.#audioQueue = queuedStop.then(
      () => undefined,
      (error) => {
        console.warn('[VOT] audio stop failed', error);
      }
    );
  }

  #syncPlay(): void {
    const generation = this.#generation;
    if (this.#state.status !== 'ready') {
      this.#maybeRequestTranslation();
      return;
    }
    if (this.#audioLoadedVideoId !== this.#activeVideoId) {
      this.#ensureAudioLoaded(generation);
      return;
    }

    const snapshot = this.#sampleVideo();
    if (!snapshot) return;
    const mix = getVoiceOverMix();
    if (mix.translationVolume === 0) {
      this.#syncPause();
      return;
    }
    this.#queueAudio(
      'play',
      generation,
      async () => {
        const currentMix = getVoiceOverMix();
        const currentSnapshot = this.#sampleVideo() ?? snapshot;
        if (currentMix.translationVolume === 0) {
          return this.#audioClient.pause(currentSnapshot);
        }
        await this.#ensureOriginalYouTubeAudio(
          generation,
          currentSnapshot.videoId
        );
        const finalSnapshot = this.#sampleVideo() ?? currentSnapshot;
        if (!this.#translationShouldPlay()) {
          return this.#audioClient.pause(finalSnapshot);
        }
        const status = await this.#audioClient.play({
          ...finalSnapshot,
          leaseMs: AUDIO_LEASE_MS,
          volume: currentMix.translationVolume
        });
        return this.#pauseIfVideoStopped(status);
      },
      (status) => {
        this.#applyAudioStatus(status, true);
        this.#startHeartbeat();
      }
    );
  }

  #syncPause(): void {
    this.#stopHeartbeat();
    if (
      this.#pauseScheduled ||
      this.#audioLoadedVideoId !== this.#activeVideoId
    ) {
      return;
    }
    const snapshot = this.#sampleVideo();
    if (!snapshot) return;
    const generation = this.#generation;
    this.#pauseScheduled = true;
    this.#queueAudio(
      'pause',
      generation,
      () => this.#audioClient.pause(snapshot),
      (status) => this.#applyAudioStatus(status, true),
      () => {
        this.#pauseScheduled = false;
      }
    );
  }

  #syncSeek(): void {
    if (this.#audioLoadedVideoId !== this.#activeVideoId) {
      if (this.#state.status === 'ready')
        this.#ensureAudioLoaded(this.#generation);
      return;
    }
    const snapshot = this.#sampleVideo();
    const video = this.#video;
    if (!snapshot || !video) return;
    const generation = this.#generation;
    this.#queueAudio(
      'seek',
      generation,
      async () => {
        const currentSnapshot = this.#sampleVideo(video) ?? snapshot;
        const translationEnabled = getVoiceOverMix().translationVolume > 0;
        const shouldResume =
          !video.paused &&
          !video.ended &&
          !video.seeking &&
          !this.#mediaWaiting &&
          translationEnabled;
        if (shouldResume) {
          await this.#ensureOriginalYouTubeAudio(
            generation,
            currentSnapshot.videoId
          );
        }
        const finalSnapshot = this.#sampleVideo(video) ?? currentSnapshot;
        const finalShouldResume =
          shouldResume && this.#translationShouldPlay(video);
        const status = await this.#audioClient.seek({
          ...finalSnapshot,
          resume: finalShouldResume,
          leaseMs: AUDIO_LEASE_MS
        });
        return this.#pauseIfVideoStopped(status);
      },
      (status) => {
        this.#applyAudioStatus(status, true);
        if (
          !video.paused &&
          !video.ended &&
          !video.seeking &&
          !this.#mediaWaiting &&
          getVoiceOverMix().translationVolume > 0
        ) {
          this.#startHeartbeat();
        }
      }
    );
  }

  #syncStatusFromTimeUpdate(): void {
    if (this.#audioLoadedVideoId !== this.#activeVideoId) {
      if (
        this.#state.status === 'ready' &&
        this.#state.audioServiceStatus !== 'ended'
      ) {
        this.#ensureAudioLoaded(this.#generation);
      }
      return;
    }
    if (
      this.#statusCheckInFlight ||
      !this.#video ||
      this.#video.seeking ||
      this.#seekSyncTimer !== null ||
      this.#mediaWaiting ||
      getVoiceOverMix().translationVolume === 0
    ) {
      return;
    }
    const now = Date.now();
    if (now - this.#lastStatusCheckAt < AUDIO_STATUS_INTERVAL_MS) return;
    this.#lastStatusCheckAt = now;
    this.#statusCheckInFlight = true;
    const generation = this.#generation;
    const videoId = this.#activeVideoId;
    const audioUrl = this.#state.audioUrl;

    this.#queueAudio(
      'status',
      generation,
      async () => {
        let status = await this.#audioClient.status();
        const video = this.#video;
        const snapshot = this.#sampleVideo(video);
        if (!video || !snapshot || !videoId || !audioUrl) return status;
        if (video.seeking || this.#mediaWaiting) return status;

        if (!status.loaded || (status.videoId && status.videoId !== videoId)) {
          status = await this.#loadAudioSession(videoId, audioUrl, generation);
          return status;
        }
        if (status.state === 'ended') return status;

        let currentSnapshot = snapshot;
        let drift = Math.abs(status.position - currentSnapshot.position);
        const translationEnabled = getVoiceOverMix().translationVolume > 0;
        let shouldPlay =
          translationEnabled &&
          !video.paused &&
          !video.ended &&
          !video.seeking &&
          !this.#mediaWaiting;
        if (
          !Number.isFinite(status.position) ||
          drift > AUDIO_DRIFT_THRESHOLD_SECONDS ||
          (shouldPlay && status.state !== 'playing') ||
          (!shouldPlay && status.state === 'playing')
        ) {
          if (shouldPlay) {
            await this.#ensureOriginalYouTubeAudio(generation, videoId);
            currentSnapshot = this.#sampleVideo(video) ?? currentSnapshot;
            shouldPlay = this.#translationShouldPlay(video);
            drift = Math.abs(status.position - currentSnapshot.position);
          }
          status = await this.#audioClient.seek({
            ...currentSnapshot,
            resume: shouldPlay,
            leaseMs: AUDIO_LEASE_MS
          });
          status = await this.#pauseIfVideoStopped(status);
          console.debug('[VOT] audio drift corrected', { drift, status });
        }
        return status;
      },
      (status) => {
        this.#audioLoadedVideoId =
          status.loaded && status.state !== 'ended' ? videoId : null;
        this.#applyAudioStatus(status);
      },
      () => {
        this.#statusCheckInFlight = false;
      },
      (error) =>
        Boolean(
          videoId &&
          audioUrl &&
          this.#scheduleAudioLoadRetry(error, generation, videoId, audioUrl)
        )
    );
  }

  #startHeartbeat(): void {
    const video = this.#video;
    if (
      this.#heartbeatTimer !== null ||
      !video ||
      video.paused ||
      video.ended ||
      video.seeking ||
      this.#mediaWaiting ||
      getVoiceOverMix().translationVolume === 0 ||
      this.#audioLoadedVideoId !== this.#activeVideoId
    ) {
      return;
    }

    this.#heartbeatTimer = window.setInterval(() => {
      const currentVideo = this.#video;
      const snapshot = this.#sampleVideo(currentVideo);
      if (
        !currentVideo ||
        currentVideo.paused ||
        currentVideo.ended ||
        currentVideo.seeking ||
        this.#mediaWaiting ||
        getVoiceOverMix().translationVolume === 0 ||
        this.#audioLoadedVideoId !== this.#activeVideoId ||
        !snapshot
      ) {
        this.#stopHeartbeat();
        return;
      }
      const generation = this.#generation;
      this.#queueAudio(
        'heartbeat',
        generation,
        () =>
          this.#audioClient.heartbeat({
            ...snapshot,
            leaseMs: AUDIO_LEASE_MS
          }),
        (status) => this.#applyAudioStatus(status)
      );
    }, AUDIO_HEARTBEAT_INTERVAL_MS);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatTimer === null) return;
    window.clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
  }

  #handleLoadedMetadata = (): void => {
    this.#updateVideoSnapshot();
    this.#maybeRequestTranslation();
  };

  #handlePlay = (): void => {
    this.#updateVideoSnapshot();
    this.#maybeRequestTranslation();
  };

  #handlePlaying = (): void => {
    this.#updateVideoSnapshot();
    this.#mediaWaiting = false;
    if (this.#seekSyncTimer !== null || this.#video?.seeking) return;
    this.#syncPlay();
  };

  #handleWaiting = (): void => {
    this.#mediaWaiting = true;
    this.#updateVideoSnapshot();
    this.#restoreVideoVolume('video waiting');
    this.#syncPause();
  };

  #handlePause = (): void => {
    this.#mediaWaiting = false;
    this.#updateVideoSnapshot();
    this.#restoreVideoVolume('video paused');
    this.#syncPause();
  };

  #handleSeeking = (): void => {
    this.#clearSeekSyncTimer();
    this.#updateVideoSnapshot();
    this.#restoreVideoVolume('video seeking');
    this.#syncPause();
  };

  #handleSeeked = (): void => {
    this.#updateVideoSnapshot();
    this.#scheduleFinalSeek();
  };

  #handleTimeUpdate = (): void => {
    this.#updateVideoSnapshot();
    this.#syncStatusFromTimeUpdate();
  };

  #handleRateChange = (): void => {
    this.#updateVideoSnapshot(true);
    this.#clearSeekSyncTimer();
    this.#syncSeek();
  };

  #handleEnded = (): void => {
    this.#mediaWaiting = false;
    this.#updateVideoSnapshot(true);
    this.#invalidateTranslation();
    this.#stopAudio(this.#activeVideoId, 'video ended');
  };

  #handleVideoError = (): void => {
    this.#mediaWaiting = false;
    this.#updateVideoSnapshot(true);
    this.#invalidateTranslation();
    this.#stopAudio(this.#activeVideoId, 'video error');
    this.#publish({ status: 'error', error: 'HTML video playback error' });
  };

  #handleNavigation = (): void => {
    this.#languageSettingsDebounce.clear();
    this.#scheduleReconcile();
  };

  #handleDomReady = (): void => {
    document.removeEventListener('DOMContentLoaded', this.#handleDomReady);
    this.#reconcile('dom-ready');
  };

  #handleConfigChange = (event: ConfigChange): void => {
    const enabled = Boolean(event.detail.newValue);
    this.#languageSettingsDebounce.clear();
    this.#manualAudioOverrideVideoId = null;
    this.#invalidateTranslation();

    if (!enabled) {
      this.#detachVideo();
      this.#domObserver.disconnect();
      this.#stopAudio(this.#activeVideoId, 'feature disabled');
      this.#publish({
        status: 'disabled',
        translationId: null,
        translationStatus: null,
        remainingTime: null,
        audioUrl: null,
        error: null
      });
      return;
    }

    this.#publish({
      status: 'idle',
      translationId: null,
      translationStatus: null,
      remainingTime: null,
      audioUrl: null,
      error: null,
      audioError: null
    });
    this.#reconcile('feature enabled');
  };

  #resetForTranslationSettings(reason: string): boolean {
    if (this.#destroyed) return false;
    const videoId = this.#activeVideoId;
    const enabled = Boolean(configRead('enableVoiceOverTranslation'));
    this.#manualAudioOverrideVideoId = null;
    this.#invalidateTranslation();
    this.#stopAudio(videoId, reason);
    const previous = this.#state;
    this.#state = initialState(enabled ? 'idle' : 'disabled', videoId);
    this.#dispatchPublicState(previous);
    this.#updateVideoSnapshot(true);
    return enabled;
  }

  #handleTranslationSettingsChange = (): void => {
    this.#languageSettingsDebounce.clear();
    if (this.#resetForTranslationSettings('translation settings changed')) {
      this.#maybeRequestTranslation();
    }
  };

  #handleLanguageSettingsChange = (): void => {
    if (this.#destroyed) return;
    this.#languageSettingsDebounce.change();
  };

  #handleLivelyVoiceChange = (event: ConfigChange): void => {
    if (this.#destroyed) return;
    this.#languageSettingsDebounce.clear();
    const enabled = Boolean(event.detail.newValue);
    this.#livelyAuthCheckedAt = 0;
    this.#livelyAuthValid = false;
    if (!enabled) {
      this.#handleTranslationSettingsChange();
      return;
    }

    void votPairingClient
      .status()
      .then((status) => {
        if (
          this.#destroyed ||
          !configRead('enableVoiceOverTranslationLivelyVoice')
        ) {
          return;
        }
        this.#livelyAuthCheckedAt = Date.now();
        this.#livelyAuthValid = status.configured && status.valid;
        if (!this.#livelyAuthValid) {
          configWrite('enableVoiceOverTranslationLivelyVoice', false);
          this.#requestLivelyVoicePairing('Yandex account is not connected');
          return;
        }
        this.#handleTranslationSettingsChange();
      })
      .catch((error) => {
        console.warn('[VOT] could not enable lively voices', error);
        if (configRead('enableVoiceOverTranslationLivelyVoice')) {
          configWrite('enableVoiceOverTranslationLivelyVoice', false);
        }
        this.#requestLivelyVoicePairing('Pairing service is unavailable');
      });
  };

  #handleLanguageMetadata = (event: Event): void => {
    const detail = (event as CustomEvent<{ videoId?: unknown }>).detail;
    if (
      this.#destroyed ||
      typeof detail?.videoId !== 'string' ||
      detail.videoId !== this.#activeVideoId
    ) {
      return;
    }

    const restorePoint = this.#forcedAudioRestorePoint;
    if (restorePoint) {
      const inspection = inspectYouTubeAudioTracks();
      if (
        inspection.videoId === restorePoint.videoId &&
        Boolean(inspection.current?.opaqueId) &&
        inspection.current?.opaqueId !== restorePoint.forcedOpaqueId
      ) {
        this.#forcedAudioRestorePoint = null;
        this.#manualAudioOverrideVideoId = restorePoint.videoId;
        this.#invalidateTranslation();
        this.#stopAudio(
          this.#activeVideoId,
          'YouTube audio track changed by user'
        );
        this.#publish({
          status: 'skipped',
          translationId: null,
          translationStatus: null,
          remainingTime: null,
          audioUrl: null,
          languageDecision: 'YouTube audio track changed by user',
          error: null
        });
        return;
      }
    }

    const previousStatus = this.#state.status;
    const previousDetectedLanguage = this.#state.detectedLanguage;
    const decision = this.#getTranslationDecision(detail.videoId);
    const languageChanged =
      previousDetectedLanguage !== decision.metadata.effectiveLanguage ||
      this.#state.languageSource !== decision.metadata.source;
    this.#publishLanguageDecision(decision, languageChanged);

    if (readSourceLanguage() !== 'auto') return;
    if (
      decision.action === 'skip' &&
      decision.reason === 'source language already matches target' &&
      ['requesting', 'waiting', 'ready'].includes(previousStatus)
    ) {
      this.#invalidateTranslation();
      this.#stopAudio(this.#activeVideoId, 'source language matches target');
      this.#publish({
        status: 'skipped',
        translationId: null,
        translationStatus: null,
        remainingTime: null,
        audioUrl: null,
        error: null
      });
      return;
    }

    if (['detecting', 'skipped', 'idle', 'error'].includes(previousStatus)) {
      if (decision.metadata.effectiveLanguage) this.#clearLanguageWait();
      this.#maybeRequestTranslation();
    }
  };

  #handleBalanceChange = (event: ConfigChange): void => {
    const mixRevision = ++this.#mixRevision;
    const mix = getVoiceOverMix();
    const enabled = configRead('enableVoiceOverTranslation');
    const videoId = this.#activeVideoId;
    const audioReady = Boolean(
      enabled &&
      videoId &&
      this.#video &&
      (this.#balancedVideo === this.#video ||
        this.#audioLoadedVideoId === videoId)
    );
    const video = this.#video;
    const translationPlaying = Boolean(
      audioReady &&
      mix.translationVolume > 0 &&
      this.#state.audioServiceStatus === 'playing' &&
      video &&
      !video.paused &&
      !video.ended &&
      !video.seeking &&
      !this.#mediaWaiting
    );
    if (translationPlaying) this.#applyVideoBalance(true);
    else if (this.#balancedVideo) {
      this.#restoreVideoVolume('translation is not playing');
    } else {
      this.#publish({
        balance: mix.balance,
        videoVolume: mix.videoVolume,
        translationVolume: mix.translationVolume
      });
    }

    const translationVolumeChanged =
      event.detail.key !== 'voiceOverTranslationOriginalVolume';
    if (!translationVolumeChanged) return;

    const audioCommandActive = Boolean(
      enabled &&
      videoId &&
      this.#video &&
      (audioReady || this.#audioLoadScheduledVideoId === videoId)
    );
    if (!audioCommandActive || !videoId) return;

    if (mix.translationVolume === 0) {
      this.#stopHeartbeat();
      this.#restoreForcedYouTubeAudio('translation volume is zero');
    }
    const generation = this.#generation;
    this.#queueAudio(
      'volume',
      generation,
      async () => {
        if (mixRevision !== this.#mixRevision) {
          return this.#audioClient.status();
        }
        let currentMix = getVoiceOverMix();
        let status = await this.#audioClient.volume({
          videoId,
          volume: currentMix.translationVolume
        });
        const video = this.#video;
        const snapshot = this.#sampleVideo(video);
        if (!video || !snapshot) return status;

        if (mixRevision !== this.#mixRevision) return status;
        currentMix = getVoiceOverMix();
        if (currentMix.translationVolume === 0) {
          return this.#audioClient.pause(snapshot);
        }
        if (
          status.state !== 'playing' &&
          !video.paused &&
          !video.ended &&
          !video.seeking &&
          !this.#mediaWaiting
        ) {
          await this.#ensureOriginalYouTubeAudio(generation, videoId);
          const finalSnapshot = this.#sampleVideo(video) ?? snapshot;
          currentMix = getVoiceOverMix();
          if (
            mixRevision !== this.#mixRevision ||
            currentMix.translationVolume === 0 ||
            !this.#translationShouldPlay(video)
          ) {
            return this.#audioClient.pause(finalSnapshot);
          }
          status = await this.#audioClient.play({
            ...finalSnapshot,
            leaseMs: AUDIO_LEASE_MS,
            volume: currentMix.translationVolume
          });
          status = await this.#pauseIfVideoStopped(status);
        }
        return status;
      },
      (status) => {
        if (mixRevision === this.#mixRevision) {
          this.#applyAudioStatus(status, true);
        }
      }
    );
  };

  #handlePageHide = (): void => {
    this.#languageSettingsDebounce.clear();
    this.#invalidateTranslation();
    this.#stopAudio(this.#activeVideoId, 'page hidden', true);
  };

  #handleBeforeUnload = (): void => {
    this.destroy();
  };

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#languageSettingsDebounce.clear();
    this.#invalidateTranslation();
    this.#restoreForcedYouTubeAudio('controller destroyed');
    this.#stopAudio(this.#activeVideoId, 'controller destroyed', true);
    if (this.#reconcileTimer !== null) {
      window.clearTimeout(this.#reconcileTimer);
      this.#reconcileTimer = null;
    }
    this.#domObserver.disconnect();
    this.#detachVideo();
    window.removeEventListener('hashchange', this.#handleNavigation);
    window.removeEventListener('popstate', this.#handleNavigation);
    window.removeEventListener('pageshow', this.#handleNavigation);
    window.removeEventListener('ytaf-page-update', this.#handleNavigation);
    window.removeEventListener(
      YOUTUBE_LANGUAGE_EVENT,
      this.#handleLanguageMetadata
    );
    window.removeEventListener('pagehide', this.#handlePageHide);
    window.removeEventListener('beforeunload', this.#handleBeforeUnload);
    document.removeEventListener('DOMContentLoaded', this.#handleDomReady);
    configRemoveChangeListener(
      'enableVoiceOverTranslation',
      this.#handleConfigChange
    );
    configRemoveChangeListener(
      'voiceOverTranslationOriginalVolume',
      this.#handleBalanceChange
    );
    configRemoveChangeListener(
      'voiceOverTranslationVolume',
      this.#handleBalanceChange
    );
    configRemoveChangeListener(
      'voiceOverTranslationMode',
      this.#handleTranslationSettingsChange
    );
    configRemoveChangeListener(
      'voiceOverTranslationSourceLanguage',
      this.#handleLanguageSettingsChange
    );
    configRemoveChangeListener(
      'voiceOverTranslationTargetLanguage',
      this.#handleLanguageSettingsChange
    );
    configRemoveChangeListener(
      'voiceOverTranslationForceOriginalAudio',
      this.#handleTranslationSettingsChange
    );
    configRemoveChangeListener(
      'enableVoiceOverTranslationLivelyVoice',
      this.#handleLivelyVoiceChange
    );
  }
}

export const voiceOverTranslationController =
  new VoiceOverTranslationController();

export function getVoiceOverTranslationState(): Readonly<VoiceOverTranslationState> {
  return voiceOverTranslationController.state;
}

Object.defineProperty(window, 'ytaf_votState', {
  configurable: true,
  get: () => publicState(voiceOverTranslationController.state)
});
