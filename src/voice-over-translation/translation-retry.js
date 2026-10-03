const DEFAULT_ERROR_RETRY_DELAYS_MS = [5_000, 30_000, 60_000];

export function translationErrorRetryDelay(
  errorCount,
  maximumDelay = Number.POSITIVE_INFINITY
) {
  const configuredDelay = DEFAULT_ERROR_RETRY_DELAYS_MS[errorCount - 1];
  if (configuredDelay === undefined) return null;
  return Math.min(configuredDelay, maximumDelay);
}
