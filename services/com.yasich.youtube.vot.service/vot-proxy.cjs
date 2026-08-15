'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const HOST = '127.0.0.1';
const PORT = Number(process.env.VOT_PROXY_PORT || 8766);
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 45 * 1000;
const YANDEX_TOKEN_FILE =
  process.env.VOT_YANDEX_SECRET_FILE ||
  process.env.VOT_YANDEX_TOKEN_FILE ||
  '/home/root/local-patches/vot/secrets/yandex-oauth.json';
const LIVELY_MARKER_HEADER = 'x-yasich-vot-lively';
const AUTH_STATE_HEADER = 'X-Yasich-VOT-Auth-State';
const AUTH_STATE_INVALID = 'invalid';
const ALLOWED_ORIGINS = new Set([
  'https://www.youtube.com',
  'https://youtube.com',
  'null'
]);
const ALLOWED_HOSTS = new Set(['api.browser.yandex.ru']);
const ALLOWED_PATH_PREFIXES = [
  '/session/create',
  '/video-translation/',
  '/video-subtitles/',
  '/stream-translation/'
];
const HOP_BY_HOP_HEADERS = new Set([
  'authorization',
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

function readStoredYandexToken(filename, filesystem) {
  const credentialFile = filename || YANDEX_TOKEN_FILE;
  const fileSystem = filesystem || fs;
  let parsed;
  try {
    parsed = JSON.parse(fileSystem.readFileSync(credentialFile, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      const missingError = new Error('Yandex account is not connected');
      missingError.code = 'ENOENT';
      throw missingError;
    }
    throw new Error('Yandex account credentials are unavailable');
  }
  if (
    !parsed ||
    parsed.version !== 1 ||
    parsed.provider !== 'yandex' ||
    typeof parsed.token !== 'string' ||
    parsed.token.length < 16 ||
    parsed.token.length > 4096
  ) {
    throw new Error('Yandex account credentials are invalid');
  }
  return parsed.token;
}

function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left), 'utf8');
  const rightBuffer = Buffer.from(String(right), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function invalidateStoredYandexToken(expectedToken, filename, filesystem) {
  const credentialFile = filename || YANDEX_TOKEN_FILE;
  const fileSystem = filesystem || fs;
  let currentToken;
  try {
    currentToken = readStoredYandexToken(credentialFile, fileSystem);
  } catch (error) {
    // Missing or malformed credentials are already invalid from the pairing
    // service's point of view. Never expose their contents in this result.
    return Boolean(error && error.code === 'ENOENT');
  }
  if (!timingSafeStringEqual(currentToken, expectedToken)) return false;
  fileSystem.unlinkSync(credentialFile);
  return true;
}

function log(message) {
  process.stdout.write(
    new Date().toISOString() + ' [VOT-Proxy] ' + message + '\n'
  );
}

function sendJson(res, status, value, origin) {
  const body = Buffer.from(JSON.stringify(value));
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store'
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error('request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function validateTarget(rawUrl) {
  let target;
  try {
    target = new URL(String(rawUrl));
  } catch {
    throw new Error('invalid upstream URL');
  }

  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    throw new Error('upstream host is not allowed');
  }
  if (
    !ALLOWED_PATH_PREFIXES.some((prefix) => target.pathname.startsWith(prefix))
  ) {
    throw new Error('upstream path is not allowed');
  }
  return target;
}

function sanitizeHeaders(value) {
  const headers = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return headers;
  }

  Object.keys(value).forEach((name) => {
    const lowerName = name.toLowerCase();
    const headerValue = value[name];
    if (
      HOP_BY_HOP_HEADERS.has(lowerName) ||
      lowerName === LIVELY_MARKER_HEADER ||
      (typeof headerValue !== 'string' && !Array.isArray(headerValue))
    ) {
      return;
    }
    headers[name] = headerValue;
  });
  return headers;
}

function proxyRequest(payload, res, origin, options) {
  const settings = options || {};
  const requestFactory = settings.requestFactory || https.request;
  const tokenFile = settings.tokenFile || YANDEX_TOKEN_FILE;
  const filesystem = settings.filesystem || fs;
  const target = validateTarget(payload.url);
  const method = String(payload.method || 'POST').toUpperCase();
  if (method !== 'POST' && method !== 'PUT') {
    throw new Error('upstream method is not allowed');
  }

  const encodedBody = String(payload.bodyBase64 || '');
  if (
    !/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(
      encodedBody
    )
  ) {
    throw new Error('invalid base64 body');
  }
  const body = Buffer.from(encodedBody, 'base64');
  if (body.length > MAX_REQUEST_BYTES) {
    throw new Error('upstream body is too large');
  }

  const incomingHeaders =
    payload.headers && typeof payload.headers === 'object'
      ? payload.headers
      : {};
  const wantsLivelyVoice = Object.entries(incomingHeaders).some(
    ([name, value]) =>
      name.toLowerCase() === LIVELY_MARKER_HEADER && value === '1'
  );
  if (
    wantsLivelyVoice &&
    (target.hostname !== 'api.browser.yandex.ru' ||
      target.pathname !== '/video-translation/translate' ||
      method !== 'POST')
  ) {
    throw new Error('lively voice authorization target is not allowed');
  }

  const headers = sanitizeHeaders(incomingHeaders);
  let livelyToken = null;
  if (wantsLivelyVoice) {
    livelyToken = readStoredYandexToken(tokenFile, filesystem);
    headers.Authorization = 'OAuth ' + livelyToken;
  }
  headers['Content-Length'] = String(body.length);
  const startedAt = Date.now();

  const upstream = requestFactory(
    target,
    { method, headers, timeout: UPSTREAM_TIMEOUT_MS },
    (upstreamResponse) => {
      const chunks = [];
      let size = 0;

      upstreamResponse.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          upstreamResponse.destroy(new Error('upstream response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      upstreamResponse.on('end', () => {
        if (res.headersSent) return;
        const upstreamStatus = Number(upstreamResponse.statusCode || 502);
        const authRejected =
          wantsLivelyVoice &&
          livelyToken !== null &&
          (upstreamStatus === 401 || upstreamStatus === 403);
        let responseBody = Buffer.concat(chunks);
        const responseHeaders = {
          'Content-Type':
            upstreamResponse.headers['content-type'] ||
            'application/octet-stream',
          'Content-Length': String(responseBody.length),
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': origin,
          Vary: 'Origin',
          'X-VOT-Upstream-Status': String(upstreamStatus)
        };
        if (authRejected) {
          let invalidated = false;
          try {
            invalidated = invalidateStoredYandexToken(
              livelyToken,
              tokenFile,
              filesystem
            );
          } catch (error) {
            log(
              'could not invalidate rejected Yandex credential: ' +
                error.message
            );
          }
          responseBody = Buffer.from(
            JSON.stringify({
              error: 'Yandex authorization was rejected',
              code: 'VOT_YANDEX_AUTH_INVALID'
            })
          );
          responseHeaders['Content-Type'] = 'application/json';
          responseHeaders['Content-Length'] = String(responseBody.length);
          responseHeaders[AUTH_STATE_HEADER] = AUTH_STATE_INVALID;
          responseHeaders['Access-Control-Expose-Headers'] =
            AUTH_STATE_HEADER + ', X-VOT-Upstream-Status';
          log(
            invalidated
              ? 'Yandex credential invalidated after upstream authorization rejection'
              : 'rejected Yandex credential was already absent or replaced'
          );
        }
        res.writeHead(upstreamStatus, responseHeaders);
        res.end(responseBody);
        log(
          method +
            ' ' +
            target.pathname +
            ' -> ' +
            upstreamStatus +
            ' (' +
            responseBody.length +
            ' bytes, ' +
            (Date.now() - startedAt) +
            'ms)'
        );
      });
      upstreamResponse.on('error', (error) => {
        if (!res.headersSent) {
          sendJson(res, 502, { error: 'upstream response failed' }, origin);
        }
        log(
          method + ' ' + target.pathname + ' response error: ' + error.message
        );
      });
    }
  );

  upstream.on('timeout', () => {
    upstream.destroy(new Error('upstream timeout'));
  });
  upstream.on('error', (error) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: 'upstream request failed' }, origin);
    }
    log(method + ' ' + target.pathname + ' request error: ' + error.message);
  });
  upstream.end(body);
}

function createServer(options) {
  const server = http.createServer(async (req, res) => {
    const origin = String(req.headers.origin || '');

    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, service: 'vot-proxy' }, origin);
      return;
    }

    if (!ALLOWED_ORIGINS.has(origin)) {
      sendJson(res, 403, { error: 'origin is not allowed' });
      return;
    }

    if (req.method === 'OPTIONS' && req.url === '/v1/fetch') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin'
      });
      res.end();
      return;
    }

    if (req.method !== 'POST' || req.url !== '/v1/fetch') {
      sendJson(res, 404, { error: 'not found' }, origin);
      return;
    }

    try {
      const payload = await readJson(req);
      proxyRequest(payload, res, origin, options);
    } catch (error) {
      sendJson(res, 400, { error: error.message }, origin);
    }
  });

  server.on('clientError', (error, socket) => {
    log('client error: ' + error.message);
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return server;
}

function run() {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    log('listening on http://' + HOST + ':' + PORT);
  });

  function shutdown(signal) {
    log('received ' + signal + ', shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) run();

module.exports = {
  AUTH_STATE_HEADER,
  AUTH_STATE_INVALID,
  createServer,
  invalidateStoredYandexToken,
  proxyRequest,
  readStoredYandexToken,
  sanitizeHeaders,
  timingSafeStringEqual,
  validateTarget
};
