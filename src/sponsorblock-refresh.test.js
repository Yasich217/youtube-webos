import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSponsorBlockApiHost,
  getSponsorBlockRefreshDelay,
  isSponsorBlockRefreshDue
} from './sponsorblock-refresh.js';

const MINUTE_MS = 60 * 1000;

test('backs off empty and failed segment refreshes up to thirty minutes', () => {
  assert.equal(
    getSponsorBlockRefreshDelay({
      hasSegments: false,
      consecutiveEmptyChecks: 1
    }),
    5 * MINUTE_MS
  );
  assert.equal(
    getSponsorBlockRefreshDelay({
      hasSegments: false,
      consecutiveEmptyChecks: 2
    }),
    10 * MINUTE_MS
  );
  assert.equal(
    getSponsorBlockRefreshDelay({
      hasSegments: false,
      consecutiveEmptyChecks: 9
    }),
    30 * MINUTE_MS
  );
  assert.equal(
    getSponsorBlockRefreshDelay({ hasSegments: false, consecutiveFailures: 3 }),
    20 * MINUTE_MS
  );
});

test('rechecks videos with segments every fifteen minutes', () => {
  assert.equal(
    getSponsorBlockRefreshDelay({ hasSegments: true }),
    15 * MINUTE_MS
  );
});

test('recognizes a refresh that became due while playback was paused', () => {
  assert.equal(isSponsorBlockRefreshDue(10_000, 9_999), true);
  assert.equal(isSponsorBlockRefreshDue(10_000, 10_001), false);
  assert.equal(isSponsorBlockRefreshDue(10_000, null), true);
});

test('formats API hosts without exposing endpoint paths', () => {
  assert.equal(
    getSponsorBlockApiHost('https://sponsor.ajay.app/api'),
    'sponsor.ajay.app'
  );
});
