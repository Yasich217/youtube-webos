const PAIRING_SERVICE_URL = 'http://127.0.0.1:8768';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_LENGTH = 16_384;
const DEFAULT_POLL_INTERVAL_MS = 1_250;
const PAIRING_ID_RE = /^[A-Za-z0-9_-]{12,160}$/;
const VERIFICATION_CODE_RE = /^\d{6}$/;

export type PairingState =
  | 'idle'
  | 'waiting'
  | 'validating'
  | 'paired'
  | 'expired'
  | 'cancelled'
  | 'error';

export interface PairingStatus {
  readonly configured: boolean;
  readonly valid: boolean;
  readonly accountLabel: string | null;
  readonly state: PairingState;
  readonly expiresAt: number | null;
}

export interface PairingSession {
  readonly id: string;
  readonly pairingUrl: string;
  readonly verificationCode: string | null;
  readonly status: PairingStatus;
}

export interface PairingPollOptions {
  readonly signal?: AbortSignal;
  readonly expiresAt?: number | null;
  readonly intervalMs?: number;
  readonly onStatus?: (status: PairingStatus) => void;
}

export type PairingClientErrorCode =
  | 'cancelled'
  | 'invalid-response'
  | 'request-failed'
  | 'timeout'
  | 'unavailable';

export class PairingClientError extends Error {
  readonly code: PairingClientErrorCode;
  readonly status: number;

  constructor(message: string, code: PairingClientErrorCode, status = 0) {
    super(message);
    this.name = 'PairingClientError';
    this.code = code;
    this.status = status;
  }
}

interface JsonRecord {
  [key: string]: unknown;
}

interface PairingRequestOptions {
  readonly method?: 'GET' | 'POST';
  readonly body?: object;
  readonly signal?: AbortSignal;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nestedRecord(value: JsonRecord, key: string): JsonRecord | undefined {
  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
}

function shortText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function parseExpiresAt(value: unknown): number | null {
  let timestamp: number;
  if (typeof value === 'number') timestamp = value;
  else if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    timestamp = Number.isFinite(numeric) ? numeric : Date.parse(value);
  } else return null;

  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  if (timestamp < 10_000_000_000) timestamp *= 1_000;
  return timestamp;
}

function isPrivateIPv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const first = octets[0];
  const second = octets[1];
  return (
    first === 10 ||
    (first === 192 && second === 168) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31)
  );
}

function normalizeState(value: unknown): PairingState {
  switch (value) {
    case 'active':
    case 'pending':
    case 'started':
    case 'waiting':
      return 'waiting';
    case 'checking':
    case 'validating':
      return 'validating';
    case 'complete':
    case 'completed':
    case 'configured':
    case 'paired':
    case 'success':
      return 'paired';
    case 'expired':
      return 'expired';
    case 'canceled':
    case 'cancelled':
      return 'cancelled';
    case 'failed':
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

function accountLabel(value: JsonRecord): string | null {
  const account = nestedRecord(value, 'account');
  return (
    shortText(value.accountLabel, 80) ??
    shortText(value.label, 80) ??
    (account
      ? (shortText(account.label, 80) ??
        shortText(account.displayName, 80) ??
        shortText(account.login, 80))
      : null)
  );
}

function parseStatus(value: unknown): PairingStatus {
  if (!isRecord(value)) {
    throw new PairingClientError(
      'Pairing service returned an invalid response',
      'invalid-response'
    );
  }

  const status = nestedRecord(value, 'status') ?? value;
  const pairing = nestedRecord(status, 'pairing');
  const configured = status.configured === true;
  const valid = configured && status.valid === true;
  const state = normalizeState(pairing?.state ?? status.state);

  return {
    configured,
    valid,
    accountLabel: accountLabel(status),
    state: valid && state === 'idle' ? 'paired' : state,
    expiresAt: parseExpiresAt(pairing?.expiresAt ?? status.expiresAt)
  };
}

function parsePairingUrl(value: unknown, pairingId: string): string {
  const text = shortText(value, 2_048);
  if (!text) {
    throw new PairingClientError(
      'Pairing service did not provide a pairing URL',
      'invalid-response'
    );
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new PairingClientError(
      'Pairing service returned an invalid pairing URL',
      'invalid-response'
    );
  }

  const pairingPort = Number(url.port);

  if (
    url.protocol !== 'http:' ||
    !Number.isSafeInteger(pairingPort) ||
    pairingPort < 1_024 ||
    pairingPort > 65_535 ||
    !isPrivateIPv4(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.searchParams.get('pairId') !== pairingId ||
    url.hash.length < 17 ||
    url.hash.length > 513
  ) {
    throw new PairingClientError(
      'Pairing service returned an unsafe pairing URL',
      'invalid-response'
    );
  }
  return url.href;
}

function parseSession(value: unknown): PairingSession {
  if (!isRecord(value)) {
    throw new PairingClientError(
      'Pairing service returned an invalid response',
      'invalid-response'
    );
  }

  const pairing = nestedRecord(value, 'pairing') ?? value;
  const id = shortText(pairing.pairId ?? pairing.id ?? pairing.pairingId, 160);
  if (!id || !PAIRING_ID_RE.test(id)) {
    throw new PairingClientError(
      'Pairing service returned an invalid session',
      'invalid-response'
    );
  }

  const verificationCode = shortText(
    pairing.code ?? pairing.verificationCode,
    16
  );
  const status = parseStatus({
    configured: value.configured,
    valid: value.valid,
    accountLabel: value.accountLabel,
    state: pairing.state ?? 'waiting',
    expiresAt: pairing.expiresAt
  });

  return {
    id,
    pairingUrl: parsePairingUrl(pairing.url ?? pairing.pairingUrl, id),
    verificationCode:
      verificationCode && VERIFICATION_CODE_RE.test(verificationCode)
        ? verificationCode
        : null,
    status
  };
}

function sanitizeInterval(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.min(5_000, Math.max(500, Math.round(value as number)));
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PairingClientError('Pairing was cancelled', 'cancelled'));
      return;
    }

    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, milliseconds);
    const handleAbort = (): void => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', handleAbort);
      reject(new PairingClientError('Pairing was cancelled', 'cancelled'));
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

export class VOTPairingClient {
  async #request(
    path: string,
    options: PairingRequestOptions = {}
  ): Promise<unknown> {
    if (options.signal?.aborted) {
      throw new PairingClientError('Pairing was cancelled', 'cancelled');
    }
    const timeoutController = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, REQUEST_TIMEOUT_MS);
    const handleExternalAbort = (): void => timeoutController.abort();
    options.signal?.addEventListener('abort', handleExternalAbort, {
      once: true
    });

    const init: RequestInit = {
      method: options.method ?? 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: timeoutController.signal
    };
    if (options.body) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(options.body);
    }

    try {
      const response = await window.fetch(
        `${PAIRING_SERVICE_URL}${path}`,
        init
      );
      const responseText = await response.text();
      if (responseText.length > MAX_RESPONSE_LENGTH) {
        throw new PairingClientError(
          'Pairing service response was too large',
          'invalid-response',
          response.status
        );
      }

      let data: unknown = {};
      if (responseText) {
        try {
          data = JSON.parse(responseText);
        } catch {
          throw new PairingClientError(
            'Pairing service returned invalid JSON',
            'invalid-response',
            response.status
          );
        }
      }

      if (!response.ok) {
        throw new PairingClientError(
          response.status === 404
            ? 'Pairing session is no longer available'
            : 'Pairing service request failed',
          'request-failed',
          response.status
        );
      }
      if (!isRecord(data) || data.ok !== true) {
        throw new PairingClientError(
          'Pairing service returned an invalid response',
          'invalid-response',
          response.status
        );
      }
      return data;
    } catch (error) {
      if (error instanceof PairingClientError) throw error;
      if (options.signal?.aborted) {
        throw new PairingClientError('Pairing was cancelled', 'cancelled');
      }
      throw new PairingClientError(
        timedOut
          ? 'Pairing service did not respond in time'
          : 'Pairing service is unavailable',
        timedOut ? 'timeout' : 'unavailable'
      );
    } finally {
      window.clearTimeout(timeout);
      options.signal?.removeEventListener('abort', handleExternalAbort);
    }
  }

  async status(signal?: AbortSignal): Promise<PairingStatus> {
    return parseStatus(await this.#request('/v1/auth/status', { signal }));
  }

  async start(signal?: AbortSignal): Promise<PairingSession> {
    return parseSession(
      await this.#request('/v1/auth/pair/start', {
        method: 'POST',
        body: {},
        signal
      })
    );
  }

  async pairingStatus(
    pairingId: string,
    signal?: AbortSignal
  ): Promise<PairingStatus> {
    if (!PAIRING_ID_RE.test(pairingId)) {
      throw new PairingClientError(
        'Invalid pairing session',
        'invalid-response'
      );
    }
    return this.status(signal);
  }

  async cancel(
    pairingId: string,
    signal?: AbortSignal
  ): Promise<PairingStatus> {
    if (!PAIRING_ID_RE.test(pairingId)) {
      throw new PairingClientError(
        'Invalid pairing session',
        'invalid-response'
      );
    }
    await this.#request('/v1/auth/pair/cancel', {
      method: 'POST',
      body: { pairId: pairingId },
      signal
    });
    return this.status(signal);
  }

  async poll(
    pairingId: string,
    options: PairingPollOptions = {}
  ): Promise<PairingStatus> {
    const interval = sanitizeInterval(options.intervalMs);
    let expiresAt = options.expiresAt ?? null;

    for (;;) {
      if (expiresAt !== null && Date.now() >= expiresAt) {
        return {
          configured: false,
          valid: false,
          accountLabel: null,
          state: 'expired',
          expiresAt
        };
      }

      const status = await this.pairingStatus(pairingId, options.signal);
      expiresAt = status.expiresAt ?? expiresAt;
      options.onStatus?.(status);

      if (status.state === 'paired') {
        return status.valid ? status : this.status(options.signal);
      }
      if (
        status.state === 'expired' ||
        status.state === 'cancelled' ||
        status.state === 'error'
      ) {
        return status;
      }
      await delay(interval, options.signal);
    }
  }
}

export const votPairingClient = new VOTPairingClient();
