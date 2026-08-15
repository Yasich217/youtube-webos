export const VOT_PROXY_AUTH_STATE_HEADER = 'X-Yasich-VOT-Auth-State';
export const VOT_PROXY_AUTH_STATE_INVALID = 'invalid';
export const VOT_PROXY_AUTH_INVALID_CODE = 'VOT_PROXY_YANDEX_AUTH_INVALID';

export class VOTProxyAuthInvalidError extends Error {
  constructor() {
    super(VOT_PROXY_AUTH_INVALID_CODE);
    this.name = 'VOTProxyAuthInvalidError';
    this.code = VOT_PROXY_AUTH_INVALID_CODE;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// @vot.js/core 3.0.2 catches a fetch rejection and preserves its stable
// message in VOTJSError.data.data. Match that machine contract exactly; never
// infer authorization state from a human-readable error string.
export function isVotProxyAuthInvalidError(error) {
  if (error instanceof VOTProxyAuthInvalidError) return true;
  if (!isRecord(error) || !isRecord(error.data)) return false;
  return (
    error.data.success === false &&
    error.data.data === VOT_PROXY_AUTH_INVALID_CODE
  );
}
