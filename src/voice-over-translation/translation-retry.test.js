import assert from 'node:assert/strict';
import test from 'node:test';

import { translationErrorRetryDelay } from './translation-retry.js';

test('translation errors use bounded retries and then stop', () => {
  assert.equal(translationErrorRetryDelay(1), 5_000);
  assert.equal(translationErrorRetryDelay(2), 30_000);
  assert.equal(translationErrorRetryDelay(3), null);
  assert.equal(translationErrorRetryDelay(4), null);
  assert.equal(translationErrorRetryDelay(20), null);
});

test('translation error retries respect the controller maximum', () => {
  assert.equal(translationErrorRetryDelay(1, 2_000), 2_000);
  assert.equal(translationErrorRetryDelay(2, 10_000), 10_000);
});
