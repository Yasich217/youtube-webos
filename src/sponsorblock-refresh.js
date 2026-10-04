export const SPONSORBLOCK_APIS = Object.freeze({
  primary: 'https://sponsorblock.inf.re/api',
  fallback: 'https://sponsor.ajay.app/api'
});

export const SPONSORBLOCK_STATUS_EVENT = 'ytaf-sponsorblock-status';

const MINUTE_MS = 60 * 1000;
const EMPTY_REFRESH_DELAYS = [5, 10, 20, 30].map(
  (minutes) => minutes * MINUTE_MS
);
const FAILURE_REFRESH_DELAYS = [5, 10, 20, 30].map(
  (minutes) => minutes * MINUTE_MS
);
const POPULATED_REFRESH_DELAY = 15 * MINUTE_MS;

function delayAt(delays, attempt) {
  const index = Math.max(0, Math.min(delays.length - 1, attempt - 1));
  return delays[index];
}

export function getSponsorBlockRefreshDelay({
  hasSegments,
  consecutiveEmptyChecks = 0,
  consecutiveFailures = 0
}) {
  if (consecutiveFailures > 0)
    return delayAt(FAILURE_REFRESH_DELAYS, consecutiveFailures);
  if (hasSegments) return POPULATED_REFRESH_DELAY;
  return delayAt(EMPTY_REFRESH_DELAYS, Math.max(1, consecutiveEmptyChecks));
}

export function isSponsorBlockRefreshDue(now, nextCheckAt) {
  return !Number.isFinite(nextCheckAt) || nextCheckAt <= now;
}

export function getSponsorBlockApiHost(apiUrl) {
  return apiUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}
