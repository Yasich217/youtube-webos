import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LANGUAGE_SETTINGS_DEBOUNCE_MS,
  TranslationSettingsDebounce
} from './settings-debounce.js';

function fakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    flush() {
      const callbacks = [...timers.values()].map((timer) => timer.callback);
      timers.clear();
      callbacks.forEach((callback) => {
        callback();
      });
    },
    size() {
      return timers.size;
    },
    delays() {
      return [...timers.values()].map((timer) => timer.delay);
    }
  };
}

test('rapid language changes stop once and request only the final pair', () => {
  const timers = fakeTimers();
  const requests = [];
  let stops = 0;
  let pair = { source: 'auto', target: 'ru' };
  const debounce = new TranslationSettingsDebounce({
    onFirstChange: () => {
      stops += 1;
    },
    onSettled: () => requests.push({ ...pair }),
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout
  });

  pair = { source: 'en', target: 'ru' };
  debounce.change();
  pair = { source: 'fr', target: 'ru' };
  debounce.change();
  pair = { source: 'fr', target: 'en' };
  debounce.change();

  assert.equal(stops, 1);
  assert.equal(requests.length, 0);
  assert.equal(timers.size(), 1);
  assert.deepEqual(timers.delays(), [2_500]);

  timers.flush();
  assert.deepEqual(requests, [{ source: 'fr', target: 'en' }]);
});

test('clear cancels a pending restart on disable, navigation or destroy', () => {
  const timers = fakeTimers();
  let requests = 0;
  const debounce = new TranslationSettingsDebounce({
    onFirstChange() {},
    onSettled: () => {
      requests += 1;
    },
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout
  });

  debounce.change();
  assert.equal(debounce.pending, true);
  debounce.clear();
  timers.flush();
  assert.equal(debounce.pending, false);
  assert.equal(requests, 0);
});

test('default timer adapters preserve legacy Window native receivers', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let scheduled = null;
  let cleared = null;
  let settles = 0;

  globalThis.setTimeout = function receiverSensitiveSetTimeout(
    callback,
    delay
  ) {
    assert.equal(this, undefined);
    scheduled = { callback, delay, handle: 73 };
    return scheduled.handle;
  };
  globalThis.clearTimeout = function receiverSensitiveClearTimeout(handle) {
    assert.equal(this, undefined);
    cleared = handle;
  };

  try {
    const debounce = new TranslationSettingsDebounce({
      onFirstChange() {},
      onSettled() {
        settles += 1;
      }
    });

    debounce.change();
    assert.equal(scheduled.delay, LANGUAGE_SETTINGS_DEBOUNCE_MS);
    assert.equal(debounce.pending, true);
    debounce.clear();
    assert.equal(cleared, 73);
    assert.equal(debounce.pending, false);
    assert.equal(settles, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
