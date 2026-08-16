import assert from 'node:assert/strict';
import test from 'node:test';

import { notificationStage } from './notification-stage.js';

function state(status, extra = {}) {
  return {
    status,
    languageDecision: null,
    audioServiceStatus: 'idle',
    hasError: false,
    hasAudioError: false,
    ...extra
  };
}

test('same-target Russian detection and skip emit no VOT toast stages', () => {
  const stages = [
    notificationStage(state('detecting')),
    notificationStage(
      state('skipped', {
        languageDecision: 'source language already matches target'
      })
    )
  ];
  assert.deepEqual(stages, ['silent', 'reset']);
  assert.equal(
    stages.filter((stage) => !['silent', 'reset'].includes(stage)).length,
    0
  );
});

test('English request, wait, error and ready paths remain actionable', () => {
  assert.equal(notificationStage(state('requesting')), 'requesting');
  assert.equal(notificationStage(state('waiting')), 'waiting');
  assert.equal(notificationStage(state('error')), 'error');
  assert.equal(notificationStage(state('ready')), 'ready');
  assert.equal(
    notificationStage(state('ready', { audioServiceStatus: 'loading' })),
    'audio-loading'
  );
  assert.equal(
    notificationStage(state('ready', { audioServiceStatus: 'playing' })),
    'playing'
  );
});
