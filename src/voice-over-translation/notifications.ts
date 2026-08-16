import { configAddChangeListener, configRead } from '../config';
import { showNotification } from '../notifications.js';
import { notificationStage } from './notification-stage';
import {
  getVoiceOverTranslationState,
  type VoiceOverTranslationPublicState,
  type VoiceOverTranslationState,
  VOICE_OVER_TRANSLATION_STATE_EVENT
} from './index';

const NOTIFICATIONS_CONFIG_KEY = 'enableVoiceOverTranslationNotifications';
const GLOBAL_NOTIFICATIONS_CONFIG_KEY = 'disableNotifications';
const MESSAGE_VISIBLE_MS = 4_000;
const LONG_WAIT_REMINDER_MS = 60_000;
const MEDIUM_WAIT_REMINDER_MS = 30_000;

const TARGET_LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  ru: 'Russian',
  en: 'English',
  kk: 'Kazakh'
};

type NotificationHandle = ReturnType<typeof showNotification>;

let activeHandle: NotificationHandle | null = null;
let handleReleaseTimer: number | null = null;
let countdownTimer: number | null = null;
let waitingDeadline = 0;
let waitingActive = false;
let activeVideoId: string | null = null;
let lastStageKey: string | null = null;
let readyAnnounced = false;
let playingAnnounced = false;
let previousState: VoiceOverTranslationPublicState | null = null;

function notificationsEnabled(): boolean {
  return (
    Boolean(configRead(NOTIFICATIONS_CONFIG_KEY)) &&
    !Boolean(configRead(GLOBAL_NOTIFICATIONS_CONFIG_KEY))
  );
}

function clearHandleReleaseTimer(): void {
  if (handleReleaseTimer === null) return;
  window.clearTimeout(handleReleaseTimer);
  handleReleaseTimer = null;
}

function clearCountdown(): void {
  if (countdownTimer !== null) window.clearTimeout(countdownTimer);
  countdownTimer = null;
  waitingDeadline = 0;
  waitingActive = false;
}

function removeActiveNotification(): void {
  clearHandleReleaseTimer();
  clearCountdown();
  activeHandle?.remove();
  activeHandle = null;
}

function resetPresenter(removeNotification = true): void {
  if (removeNotification) removeActiveNotification();
  else {
    clearHandleReleaseTimer();
    clearCountdown();
    activeHandle = null;
  }
  lastStageKey = null;
  readyAnnounced = false;
  playingAnnounced = false;
}

function showWorkflowMessage(message: string): void {
  if (!notificationsEnabled()) return;
  clearHandleReleaseTimer();
  if (activeHandle) activeHandle.update(message, 0);
  else activeHandle = showNotification(message, 0);

  const handle = activeHandle;
  handleReleaseTimer = window.setTimeout(() => {
    if (activeHandle === handle) {
      handle.remove();
      activeHandle = null;
    }
    handleReleaseTimer = null;
  }, MESSAGE_VISIBLE_MS);
}

function showTerminalMessage(message: string): void {
  if (!notificationsEnabled()) return;
  clearCountdown();
  clearHandleReleaseTimer();
  if (activeHandle) activeHandle.update(message, 0);
  else activeHandle = showNotification(message, 0);

  const handle = activeHandle;
  handleReleaseTimer = window.setTimeout(() => {
    if (activeHandle === handle) {
      handle.remove();
      activeHandle = null;
    }
    handleReleaseTimer = null;
  }, MESSAGE_VISIBLE_MS);
}

function formatRemainingTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function roundedRemainingSeconds(): number {
  const remaining = Math.max(
    0,
    Math.ceil((waitingDeadline - Date.now()) / 1_000)
  );
  const step = remaining > 60 ? 10 : remaining > 20 ? 5 : 1;
  return remaining > 0 ? Math.ceil(remaining / step) * step : 0;
}

function waitingReminderDelay(remaining: number): number | null {
  if (remaining > 120) return LONG_WAIT_REMINDER_MS;
  if (remaining > 30) return MEDIUM_WAIT_REMINDER_MS;
  return null;
}

function scheduleWaitingReminder(): void {
  if (!waitingActive || countdownTimer !== null) return;
  const delay = waitingReminderDelay(roundedRemainingSeconds());
  if (delay === null) return;
  countdownTimer = window.setTimeout(() => {
    countdownTimer = null;
    if (!notificationsEnabled() || !waitingActive) return;
    showWaitingMessage();
    scheduleWaitingReminder();
  }, delay);
}

function showWaitingMessage(): void {
  const remaining = roundedRemainingSeconds();
  showWorkflowMessage(
    remaining > 0
      ? `Translation is being prepared · about ${formatRemainingTime(remaining)}`
      : 'Translation is being prepared…'
  );
}

function updateWaiting(remainingTime: number | null): void {
  const enteringWaiting = !waitingActive;
  waitingActive = true;
  if (
    typeof remainingTime === 'number' &&
    Number.isFinite(remainingTime) &&
    remainingTime > 0
  ) {
    waitingDeadline = Date.now() + remainingTime * 1_000;
    if (remainingTime <= 30 && countdownTimer !== null) {
      window.clearTimeout(countdownTimer);
      countdownTimer = null;
    }
  }
  if (enteringWaiting) showWaitingMessage();
  scheduleWaitingReminder();
}

function skipMessage(state: VoiceOverTranslationPublicState): string {
  if (state.languageDecision === 'source language already matches target') {
    const language =
      TARGET_LANGUAGE_NAMES[state.targetLanguage] ?? state.targetLanguage;
    return `Translation not needed · video is already in ${language}`;
  }
  if (
    state.languageDecision === 'source language is unknown in foreign-only mode'
  ) {
    return 'Translation skipped · video language was not detected';
  }
  return 'Translation skipped for this video';
}

function stageKey(
  state: VoiceOverTranslationPublicState,
  stage: string
): string {
  return `${state.videoId ?? 'none'}:${stage}`;
}

function setActiveVideo(videoId: string | null): void {
  if (videoId === activeVideoId) return;
  removeActiveNotification();
  activeVideoId = videoId;
  lastStageKey = null;
  readyAnnounced = false;
  playingAnnounced = false;
}

function presentState(state: VoiceOverTranslationPublicState): void {
  if (!notificationsEnabled()) {
    removeActiveNotification();
    return;
  }

  const previous = previousState;
  previousState = state;
  const sameVideo = previous?.videoId === state.videoId;
  setActiveVideo(state.videoId);
  const stage = notificationStage(state);

  if (stage === 'reset') {
    resetPresenter();
    return;
  }
  if (stage === 'silent') return;

  if (stage === 'error') {
    const key = stageKey(state, 'error');
    if (key !== lastStageKey) {
      lastStageKey = key;
      playingAnnounced = false;
      showTerminalMessage(
        state.status === 'error' || state.hasError
          ? 'Voice-over translation error'
          : 'Voice-over translation audio error'
      );
    }
    return;
  }

  if (stage === 'requesting') {
    if (sameVideo && waitingActive) return;
    clearCountdown();
    const key = stageKey(state, 'requesting');
    if (key !== lastStageKey) {
      lastStageKey = key;
      showWorkflowMessage('Requesting voice-over translation…');
    }
    return;
  }

  if (stage === 'waiting') {
    lastStageKey = stageKey(state, 'waiting');
    updateWaiting(state.remainingTime);
    return;
  }

  if (stage === 'skipped') {
    const key = stageKey(state, `skipped:${state.languageDecision ?? 'other'}`);
    if (key !== lastStageKey) {
      lastStageKey = key;
      showTerminalMessage(skipMessage(state));
    }
    return;
  }

  clearCountdown();

  if (stage === 'audio-loading') {
    readyAnnounced = false;
    const key = stageKey(state, 'audio-loading');
    if (key !== lastStageKey) {
      lastStageKey = key;
      showWorkflowMessage('Loading translated audio…');
    }
    return;
  }

  if (stage === 'playing') {
    if (!playingAnnounced) {
      playingAnnounced = true;
      lastStageKey = stageKey(state, 'playing');
      showTerminalMessage('Voice-over translation is playing');
    }
    return;
  }

  if (!readyAnnounced) {
    readyAnnounced = true;
    lastStageKey = stageKey(state, 'ready');
    showTerminalMessage('Voice-over translation ready');
  }
}

function safeSnapshot(
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

window.addEventListener(VOICE_OVER_TRANSLATION_STATE_EVENT, (event) => {
  presentState((event as CustomEvent<VoiceOverTranslationPublicState>).detail);
});

const handleNotificationSettingChange = (): void => {
  removeActiveNotification();
  lastStageKey = null;
  readyAnnounced = false;
  playingAnnounced = false;
  previousState = null;
  if (notificationsEnabled()) {
    presentState(safeSnapshot(getVoiceOverTranslationState()));
  }
};

configAddChangeListener(
  NOTIFICATIONS_CONFIG_KEY,
  handleNotificationSettingChange
);
configAddChangeListener(
  GLOBAL_NOTIFICATIONS_CONFIG_KEY,
  handleNotificationSettingChange
);

window.setTimeout(() => {
  if (notificationsEnabled()) {
    presentState(safeSnapshot(getVoiceOverTranslationState()));
  }
}, 0);
