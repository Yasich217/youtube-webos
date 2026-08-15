export function notificationStage(state) {
  if (state.status === 'disabled' || state.status === 'idle') return 'reset';
  if (state.status === 'detecting') return 'silent';
  if (
    state.status === 'error' ||
    state.hasError ||
    state.audioServiceStatus === 'error' ||
    state.hasAudioError
  ) {
    return 'error';
  }
  if (
    state.status === 'skipped' &&
    state.languageDecision === 'source language already matches target'
  ) {
    return 'reset';
  }
  if (state.status === 'requesting') return 'requesting';
  if (state.status === 'waiting') return 'waiting';
  if (state.status === 'skipped') return 'skipped';
  if (state.status !== 'ready') return 'silent';
  if (state.audioServiceStatus === 'loading') return 'audio-loading';
  if (state.audioServiceStatus === 'playing') return 'playing';
  return 'ready';
}
