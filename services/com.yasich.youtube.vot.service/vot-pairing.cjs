'use strict';

/**
 * Root-side, short-lived LAN pairing service for Yandex OAuth.
 *
 * The permanent API is loopback-only. A LAN listener exists only while a
 * pairing session is active, is bound to one RFC1918 address, and expires
 * after three minutes. Pairing secrets and OAuth tokens are deliberately
 * absent from logs and status responses.
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

const LOOPBACK_HOST = '127.0.0.1';
const LOOPBACK_PORT = Number(process.env.VOT_PAIRING_PORT || 8768);
const LAN_PORT = Number(process.env.VOT_PAIRING_LAN_PORT || 8769);
const SESSION_TTL_MS = 180 * 1000;
const MAX_PHONE_BODY_BYTES = 4 * 1024;
const MAX_LOOPBACK_BODY_BYTES = 4 * 1024;
const MAX_YANDEX_RESPONSE_BYTES = 64 * 1024;
const YANDEX_TIMEOUT_MS = 8 * 1000;
const MAX_ATTEMPTS = 5;
const ATTEMPT_INTERVAL_MS = 1000;
const DEFAULT_SECRET_FILE =
  process.env.VOT_YANDEX_SECRET_FILE ||
  '/home/root/local-patches/vot/secrets/yandex-oauth.json';
const ALLOWED_ORIGINS = new Set([
  'https://www.youtube.com',
  'https://youtube.com',
  'null'
]);

const PHONE_STYLE = `
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#101114;color:#f3f3f3}
body{box-sizing:border-box;max-width:34rem;margin:0 auto;padding:2rem 1.25rem}
h1{font-size:1.55rem;margin:0 0 1rem}p{line-height:1.45;color:#c8c9cc}
label{display:block;margin:1rem 0 .4rem;font-weight:600}
input,button{box-sizing:border-box;width:100%;border-radius:.65rem;font:inherit;padding:.85rem}
input{border:1px solid #555;background:#202124;color:#fff}button{margin-top:1.2rem;border:0;background:#8ab4f8;color:#111;font-weight:700}
button:disabled{opacity:.55}#message{min-height:1.5rem;color:#f6c344}.ok{color:#81c995!important}
`;

const PHONE_SCRIPT = `
(() => {
  'use strict';
  const pairingSecret = location.hash.length > 1 ? location.hash.slice(1) : '';
  history.replaceState(null, '', location.pathname + location.search);
  const pairId = new URLSearchParams(location.search).get('pairId') || '';
  addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('pair-form');
    const token = document.getElementById('token');
    const code = document.getElementById('code');
    const submit = document.getElementById('submit');
    const message = document.getElementById('message');
    if (!pairingSecret || !pairId) {
      message.textContent = 'Ссылка недействительна. Создайте новый QR-код на телевизоре.';
      submit.disabled = true;
      return;
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      message.className = '';
      message.textContent = 'Проверяем токен…';
      try {
        const response = await fetch('/v1/pair', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-VOT-Pairing': pairingSecret
          },
          body: JSON.stringify({pairId, token: token.value.trim(), code: code.value.trim()}),
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error'
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'Не удалось сохранить токен');
        token.value = '';
        code.value = '';
        message.className = 'ok';
        message.textContent = 'Готово. Живые голоса подключены — можно закрыть эту страницу.';
      } catch (error) {
        message.textContent = error && error.message ? error.message : 'Ошибка подключения';
        submit.disabled = false;
      }
    });
  }, {once: true});
})();
`;

function sha256Csp(value) {
  return (
    "'sha256-" +
    crypto.createHash('sha256').update(value).digest('base64') +
    "'"
  );
}

const PHONE_CSP = [
  "default-src 'none'",
  'script-src ' + sha256Csp(PHONE_SCRIPT),
  'style-src ' + sha256Csp(PHONE_STYLE),
  "connect-src 'self'",
  "img-src 'none'",
  "font-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

const PHONE_HTML = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>VOT — живые голоса</title><style>${PHONE_STYLE}</style><script>${PHONE_SCRIPT}</script></head>
<body><h1>Подключение живых голосов</h1><p>Введите OAuth-токен Яндекса и шестизначный код с экрана телевизора. Страница доступна только во время подключения.</p>
<form id="pair-form"><label for="token">OAuth-токен</label><input id="token" name="token" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required maxlength="2048">
<label for="code">Код на телевизоре</label><input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
<button id="submit" type="submit">Проверить и сохранить</button></form><p id="message" role="status" aria-live="polite"></p></body></html>`;

function log(message) {
  process.stdout.write(
    new Date().toISOString() + ' [VOT-Pairing] ' + message + '\n'
  );
}

function noStoreHeaders(contentType, contentLength) {
  return {
    'Content-Type': contentType,
    'Content-Length': String(contentLength),
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  };
}

function sendJson(res, statusCode, value, origin, extraHeaders) {
  const body = Buffer.from(JSON.stringify(value));
  const headers = Object.assign(
    noStoreHeaders('application/json; charset=utf-8', body.length),
    extraHeaders || {}
  );
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  res.writeHead(statusCode, headers);
  res.end(body);
}

function sendPhoneJson(res, statusCode, value, extraHeaders) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(
    statusCode,
    Object.assign(
      noStoreHeaders('application/json; charset=utf-8', body.length),
      extraHeaders || {}
    )
  );
  res.end(body);
}

function errorWithStatus(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function readBody(req, maximumBytes) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      req.resume();
      reject(errorWithStatus('request body is too large', 413));
      return;
    }

    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maximumBytes) {
        settled = true;
        chunks.length = 0;
        reject(errorWithStatus('request body is too large', 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

async function readJson(req, maximumBytes, allowEmpty) {
  const contentType = String(req.headers['content-type'] || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw errorWithStatus('Content-Type must be application/json', 415);
  }
  const body = await readBody(req, maximumBytes);
  if (allowEmpty && body.length === 0) return {};
  let value;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    throw errorWithStatus('invalid JSON body', 400);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw errorWithStatus('JSON body must be an object', 400);
  }
  return value;
}

function parseIpv4(address) {
  if (
    typeof address !== 'string' ||
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)
  ) {
    return null;
  }
  const octets = address.split('.').map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return null;
  return octets;
}

function isPrivateIpv4(address) {
  const octets = parseIpv4(address);
  if (!octets) return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function selectLanAddress(networkInterfaces, configuredAddress) {
  const interfaces = networkInterfaces || os.networkInterfaces();
  if (configuredAddress) {
    if (!isPrivateIpv4(configuredAddress)) {
      throw new Error('configured pairing address is not a private IPv4');
    }
    const exists = Object.values(interfaces).some((entries) =>
      (entries || []).some(
        (entry) =>
          entry &&
          entry.address === configuredAddress &&
          entry.family !== 6 &&
          entry.family !== 'IPv6' &&
          !entry.internal
      )
    );
    if (!exists) throw new Error('configured pairing address is not assigned');
    return configuredAddress;
  }

  const candidates = [];
  Object.keys(interfaces).forEach((name) => {
    (interfaces[name] || []).forEach((entry) => {
      if (
        !entry ||
        entry.internal ||
        entry.family === 6 ||
        entry.family === 'IPv6' ||
        !isPrivateIpv4(entry.address)
      ) {
        return;
      }
      const preferredName = /^(?:eth|en|wlan|wl)/i.test(name) ? 0 : 1;
      candidates.push({ address: entry.address, name, preferredName });
    });
  });
  candidates.sort(
    (left, right) =>
      left.preferredName - right.preferredName ||
      left.name.localeCompare(right.name) ||
      left.address.localeCompare(right.address)
  );
  if (candidates.length === 0) {
    throw new Error('no private IPv4 address is available for pairing');
  }
  return candidates[0].address;
}

function base64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left), 'utf8');
  const rightBuffer = Buffer.from(String(right), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeToken(value) {
  if (typeof value !== 'string') {
    throw errorWithStatus('OAuth token is required', 400);
  }
  const token = value.trim();
  let hasForbiddenCharacter = false;
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index);
    if (code <= 32 || code === 127) {
      hasForbiddenCharacter = true;
      break;
    }
  }
  if (token.length < 8 || token.length > 2048 || hasForbiddenCharacter) {
    throw errorWithStatus('OAuth token has an invalid format', 400);
  }
  return token;
}

function accountFromYandex(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Yandex returned an invalid account response');
  }
  const id = value.id == null ? '' : String(value.id);
  if (!id || id.length > 256) {
    throw new Error('Yandex account response has no id');
  }
  const safeOptional = (candidate, maximumLength) => {
    if (candidate == null) return null;
    const text = String(candidate);
    return text.length > maximumLength ? text.slice(0, maximumLength) : text;
  };
  return {
    id,
    login: safeOptional(value.login, 256),
    displayName: safeOptional(
      value.displayName || value.display_name || value.real_name,
      512
    )
  };
}

function validateYandexToken(token, options) {
  const settings = options || {};
  const requestFactory = settings.requestFactory || https.request;
  const timeoutMs = settings.timeoutMs || YANDEX_TIMEOUT_MS;
  const maximumBytes = settings.maximumBytes || MAX_YANDEX_RESPONSE_BYTES;

  return new Promise((resolve, reject) => {
    let settled = false;
    let absoluteTimer;
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      if (absoluteTimer) clearTimeout(absoluteTimer);
      reject(error);
    };
    const request = requestFactory(
      {
        protocol: 'https:',
        hostname: 'login.yandex.ru',
        port: 443,
        method: 'GET',
        path: '/info?format=json',
        headers: {
          Accept: 'application/json',
          Authorization: 'OAuth ' + token,
          'User-Agent': 'YouTube-VOT-webOS/1.0'
        },
        agent: false
      },
      (response) => {
        const statusCode = Number(response.statusCode || 0);
        if (statusCode !== 200) {
          response.resume();
          finishError(
            errorWithStatus(
              statusCode === 401 || statusCode === 403
                ? 'Yandex rejected the OAuth token'
                : 'Yandex OAuth validation failed',
              statusCode === 401 || statusCode === 403 ? 401 : 502
            )
          );
          return;
        }
        const declaredLength = Number(
          (response.headers || {})['content-length']
        );
        if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
          response.destroy();
          finishError(errorWithStatus('Yandex response is too large', 502));
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          if (settled) return;
          size += chunk.length;
          if (size > maximumBytes) {
            response.destroy();
            finishError(errorWithStatus('Yandex response is too large', 502));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          let parsed;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            finishError(errorWithStatus('Yandex returned invalid JSON', 502));
            return;
          }
          try {
            const account = accountFromYandex(parsed);
            settled = true;
            if (absoluteTimer) clearTimeout(absoluteTimer);
            resolve(account);
          } catch (error) {
            finishError(errorWithStatus(error.message, 502));
          }
        });
        response.on('error', () => {
          finishError(errorWithStatus('Yandex response failed', 502));
        });
      }
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(
        errorWithStatus('Yandex OAuth validation timed out', 504)
      );
    });
    if (!settled) {
      absoluteTimer = setTimeout(() => {
        request.destroy(
          errorWithStatus('Yandex OAuth validation timed out', 504)
        );
      }, timeoutMs);
    }
    request.on('error', (error) => {
      finishError(
        errorWithStatus(
          error && error.statusCode
            ? error.message
            : 'Yandex OAuth request failed',
          (error && error.statusCode) || 502
        )
      );
    });
    request.end();
  });
}

function ensureSecretDirectory(directory, filesystem) {
  const fileSystem = filesystem || fs;
  fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fileSystem.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('secret path is not a real directory');
  }
  fileSystem.chmodSync(directory, 0o700);
}

function writeSecretAtomically(filename, value, options) {
  const settings = options || {};
  const fileSystem = settings.filesystem || fs;
  const randomBytes = settings.randomBytes || crypto.randomBytes;
  const directory = path.dirname(filename);
  ensureSecretDirectory(directory, fileSystem);
  const temporary = path.join(
    directory,
    '.' + path.basename(filename) + '.' + base64Url(randomBytes(12)) + '.tmp'
  );
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fileSystem.openSync(temporary, flags, 0o600);
    const serialized = Buffer.from(JSON.stringify(value) + '\n', 'utf8');
    let offset = 0;
    while (offset < serialized.length) {
      const written = fileSystem.writeSync(
        descriptor,
        serialized,
        offset,
        serialized.length - offset
      );
      if (written <= 0) throw new Error('could not write credential file');
      offset += written;
    }
    fileSystem.fsyncSync(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = undefined;
    fileSystem.renameSync(temporary, filename);
    fileSystem.chmodSync(filename, 0o600);
    let directoryDescriptor;
    try {
      directoryDescriptor = fileSystem.openSync(
        directory,
        fs.constants.O_RDONLY
      );
      fileSystem.fsyncSync(directoryDescriptor);
    } catch {
      // Some webOS filesystems do not permit fsync on directories.
    } finally {
      if (directoryDescriptor !== undefined) {
        try {
          fileSystem.closeSync(directoryDescriptor);
        } catch {
          // Best-effort cleanup after the durable rename.
        }
      }
    }
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fileSystem.closeSync(descriptor);
      } catch {
        // Preserve the original write error.
      }
    }
    try {
      fileSystem.unlinkSync(temporary);
    } catch {
      // The temporary file may not have been created yet.
    }
    throw error;
  }
}

function readStoredCredential(filename, filesystem) {
  const fileSystem = filesystem || fs;
  try {
    const stat = fileSystem.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const value = JSON.parse(fileSystem.readFileSync(filename, 'utf8'));
    if (
      !value ||
      value.version !== 1 ||
      value.provider !== 'yandex' ||
      typeof value.token !== 'string' ||
      !value.account
    ) {
      return null;
    }
    return {
      version: 1,
      provider: 'yandex',
      token: value.token,
      validatedAt: String(value.validatedAt || ''),
      account: accountFromYandex(value.account)
    };
  } catch {
    return null;
  }
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server.address());
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function closeServer(server, sockets, preservedSocket) {
  if (!server) return;
  try {
    server.close();
  } catch {
    // The listener may already be closed.
  }
  (sockets || []).forEach((socket) => {
    if (socket === preservedSocket) return;
    socket.destroy();
  });
  if (preservedSocket) {
    const timer = setTimeout(() => preservedSocket.destroy(), 500);
    if (timer.unref) timer.unref();
  }
}

class PairingManager {
  constructor(options) {
    const settings = options || {};
    this.now = settings.now || Date.now;
    this.randomBytes = settings.randomBytes || crypto.randomBytes;
    this.randomInt = settings.randomInt || crypto.randomInt;
    this.networkInterfaces = settings.networkInterfaces || os.networkInterfaces;
    this.configuredLanAddress =
      settings.lanAddress || process.env.VOT_PAIRING_LAN_ADDRESS || '';
    this.lanPort = settings.lanPort == null ? LAN_PORT : settings.lanPort;
    this.ttlMs = settings.ttlMs || SESSION_TTL_MS;
    this.maximumAttempts = settings.maximumAttempts || MAX_ATTEMPTS;
    this.attemptIntervalMs =
      settings.attemptIntervalMs == null
        ? ATTEMPT_INTERVAL_MS
        : settings.attemptIntervalMs;
    this.allowLoopbackForTests = Boolean(settings.allowLoopbackForTests);
    this.validator = settings.validator || validateYandexToken;
    this.secretFile = settings.secretFile || DEFAULT_SECRET_FILE;
    this.filesystem = settings.filesystem || fs;
    this.storedCredential = readStoredCredential(
      this.secretFile,
      this.filesystem
    );
    this.current = null;
    this.starting = false;
  }

  _expireIfNeeded() {
    const session = this.current;
    if (session && this.now() >= session.expiresAtMs) {
      this._removeSession(session);
    }
  }

  _removeSession(session, preservedSocket) {
    if (!session) return false;
    if (this.current === session) this.current = null;
    if (session.timer) clearTimeout(session.timer);
    session.timer = null;
    closeServer(session.server, session.sockets, preservedSocket);
    return true;
  }

  _publicSession(session, includeBootstrap) {
    if (!session) return null;
    const value = {
      pairId: session.pairId,
      state: session.validating ? 'validating' : 'waiting',
      expiresAt: new Date(session.expiresAtMs).toISOString(),
      attemptsRemaining: Math.max(0, this.maximumAttempts - session.attempts)
    };
    if (includeBootstrap) {
      value.url = session.url;
      value.code = session.code;
    }
    return value;
  }

  status() {
    this._expireIfNeeded();
    // The proxy removes a credential after an authenticated lively request is
    // rejected upstream. Refresh from disk so the separate pairing process
    // immediately reports invalid and opens a fresh QR flow.
    this.storedCredential = readStoredCredential(
      this.secretFile,
      this.filesystem
    );
    const credential = this.storedCredential;
    const account = credential ? credential.account : null;
    return {
      ok: true,
      configured: Boolean(credential),
      valid: Boolean(credential),
      provider: 'yandex',
      account,
      accountLabel: account
        ? account.displayName || account.login || account.id
        : null,
      validatedAt: credential ? credential.validatedAt : null,
      pairing: this._publicSession(this.current, false)
    };
  }

  async start() {
    if (this.starting)
      throw errorWithStatus('pairing is already starting', 409);
    this.starting = true;
    try {
      if (this.current) this._removeSession(this.current);
      let address;
      if (
        this.allowLoopbackForTests &&
        this.configuredLanAddress === '127.0.0.1'
      ) {
        address = '127.0.0.1';
      } else {
        address = selectLanAddress(
          this.networkInterfaces(),
          this.configuredLanAddress
        );
      }
      const session = {
        pairId: base64Url(this.randomBytes(16)),
        secret: base64Url(this.randomBytes(32)),
        code: String(this.randomInt(0, 1000000)).padStart(6, '0'),
        address,
        port: this.lanPort,
        createdAtMs: this.now(),
        expiresAtMs: this.now() + this.ttlMs,
        attempts: 0,
        lastAttemptAtMs: -Infinity,
        validating: false,
        sockets: new Set(),
        server: null,
        timer: null,
        url: ''
      };
      const server = http.createServer((req, res) =>
        this._handlePhoneRequest(session, req, res)
      );
      session.server = server;
      server.keepAliveTimeout = 1000;
      server.headersTimeout = 5000;
      server.requestTimeout = 10000;
      server.on('connection', (socket) => {
        session.sockets.add(socket);
        socket.on('close', () => session.sockets.delete(socket));
      });
      server.on('clientError', (_error, socket) => {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      });
      let listeningAddress;
      try {
        listeningAddress = await listen(server, session.port, session.address);
      } catch {
        closeServer(server, session.sockets);
        throw errorWithStatus('could not open the temporary pairing page', 503);
      }
      session.port = listeningAddress.port;
      const expectedHost =
        session.address + (session.port === 80 ? '' : ':' + session.port);
      session.expectedHost = expectedHost;
      session.origin = 'http://' + expectedHost;
      session.url =
        session.origin +
        '/?pairId=' +
        encodeURIComponent(session.pairId) +
        '#' +
        session.secret;
      session.timer = setTimeout(() => {
        if (this.current === session) {
          this._removeSession(session);
          log('pairing session expired');
        }
      }, this.ttlMs);
      if (session.timer.unref) session.timer.unref();
      this.current = session;
      log('temporary pairing listener opened on ' + session.address);
      return { ok: true, pairing: this._publicSession(session, true) };
    } finally {
      this.starting = false;
    }
  }

  cancel(pairId) {
    this._expireIfNeeded();
    const session = this.current;
    if (!session) return { ok: true, cancelled: false };
    if (pairId && !timingSafeStringEqual(pairId, session.pairId)) {
      return { ok: true, cancelled: false };
    }
    this._removeSession(session);
    log('pairing session cancelled');
    return { ok: true, cancelled: true };
  }

  _isCurrent(session) {
    this._expireIfNeeded();
    return this.current === session;
  }

  _consumeAttempt(session) {
    const now = this.now();
    if (session.validating) {
      throw errorWithStatus('another validation is already running', 429);
    }
    const retryAfterMs = session.lastAttemptAtMs + this.attemptIntervalMs - now;
    if (retryAfterMs > 0) {
      const error = errorWithStatus(
        'too many attempts; try again shortly',
        429
      );
      error.retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));
      throw error;
    }
    if (session.attempts >= this.maximumAttempts) {
      throw errorWithStatus('pairing attempt limit reached', 410);
    }
    session.lastAttemptAtMs = now;
    session.attempts += 1;
  }

  _failAttempt(session, res, error) {
    const remaining = Math.max(0, this.maximumAttempts - session.attempts);
    if (remaining === 0) {
      res.once('finish', () => this._removeSession(session, res.socket));
    }
    sendPhoneJson(res, error.statusCode || 400, {
      ok: false,
      error: error.message,
      attemptsRemaining: remaining
    });
  }

  async _handlePhoneRequest(session, req, res) {
    if (String(req.headers.host || '') !== session.expectedHost) {
      sendPhoneJson(res, 421, { ok: false, error: 'host is not allowed' });
      return;
    }
    if (!this._isCurrent(session)) {
      sendPhoneJson(res, 410, { ok: false, error: 'pairing session expired' });
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, session.origin);
    } catch {
      sendPhoneJson(res, 400, { ok: false, error: 'invalid request URL' });
      return;
    }
    if (parsedUrl.origin !== session.origin) {
      sendPhoneJson(res, 400, { ok: false, error: 'invalid request URL' });
      return;
    }

    if (
      req.method === 'GET' &&
      parsedUrl.pathname === '/' &&
      parsedUrl.searchParams.get('pairId') === session.pairId &&
      Array.from(parsedUrl.searchParams.keys()).length === 1
    ) {
      const body = Buffer.from(PHONE_HTML, 'utf8');
      res.writeHead(
        200,
        Object.assign(noStoreHeaders('text/html; charset=utf-8', body.length), {
          'Content-Security-Policy': PHONE_CSP,
          'Permissions-Policy':
            'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
        })
      );
      res.end(body);
      return;
    }

    if (
      req.method !== 'POST' ||
      parsedUrl.pathname !== '/v1/pair' ||
      parsedUrl.search
    ) {
      sendPhoneJson(res, 404, { ok: false, error: 'not found' });
      return;
    }
    if (String(req.headers.origin || '') !== session.origin) {
      sendPhoneJson(res, 403, { ok: false, error: 'origin is not allowed' });
      return;
    }

    try {
      this._consumeAttempt(session);
    } catch (error) {
      const headers = error.retryAfter
        ? { 'Retry-After': String(error.retryAfter) }
        : undefined;
      sendPhoneJson(
        res,
        error.statusCode || 429,
        { ok: false, error: error.message },
        headers
      );
      return;
    }

    let payload;
    try {
      payload = await readJson(req, MAX_PHONE_BODY_BYTES, false);
      if (!this._isCurrent(session)) {
        throw errorWithStatus('pairing session expired', 410);
      }
      if (
        !timingSafeStringEqual(
          String(req.headers['x-vot-pairing'] || ''),
          session.secret
        ) ||
        !timingSafeStringEqual(String(payload.pairId || ''), session.pairId) ||
        !timingSafeStringEqual(String(payload.code || ''), session.code)
      ) {
        throw errorWithStatus('pairing code or link is invalid', 401);
      }
      const token = normalizeToken(payload.token);
      session.validating = true;
      const account = accountFromYandex(await this.validator(token));
      if (!this._isCurrent(session)) {
        throw errorWithStatus('pairing session expired', 410);
      }
      const validatedAt = new Date(this.now()).toISOString();
      const credential = {
        version: 1,
        provider: 'yandex',
        token,
        validatedAt,
        account
      };
      writeSecretAtomically(this.secretFile, credential, {
        filesystem: this.filesystem,
        randomBytes: this.randomBytes
      });
      this.storedCredential = credential;
      res.once('finish', () => this._removeSession(session, res.socket));
      sendPhoneJson(res, 200, {
        ok: true,
        account: {
          id: account.id,
          login: account.login,
          displayName: account.displayName
        }
      });
      log('Yandex OAuth credential validated and stored');
    } catch (error) {
      session.validating = false;
      const safeError =
        error && error.statusCode
          ? error
          : errorWithStatus('could not validate or store the OAuth token', 502);
      this._failAttempt(session, res, safeError);
    }
  }
}

function createLoopbackServer(manager) {
  const server = http.createServer(async (req, res) => {
    const origin = String(req.headers.origin || '');
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, service: 'vot-pairing' }, origin);
      return;
    }
    if (!ALLOWED_ORIGINS.has(origin)) {
      sendJson(res, 403, { ok: false, error: 'origin is not allowed' });
      return;
    }
    const allowedPaths = new Set([
      '/v1/auth/status',
      '/v1/auth/pair/start',
      '/v1/auth/pair/cancel'
    ]);
    if (req.method === 'OPTIONS' && allowedPaths.has(req.url)) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
        'Cache-Control': 'no-store'
      });
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/auth/status') {
      sendJson(res, 200, manager.status(), origin);
      return;
    }
    if (
      req.method !== 'POST' ||
      (req.url !== '/v1/auth/pair/start' && req.url !== '/v1/auth/pair/cancel')
    ) {
      sendJson(res, 404, { ok: false, error: 'not found' }, origin);
      return;
    }

    try {
      const payload = await readJson(req, MAX_LOOPBACK_BODY_BYTES, true);
      if (req.url === '/v1/auth/pair/start') {
        sendJson(res, 200, await manager.start(), origin);
      } else {
        const pairId = payload.pairId == null ? '' : String(payload.pairId);
        sendJson(res, 200, manager.cancel(pairId), origin);
      }
    } catch (error) {
      sendJson(
        res,
        (error && error.statusCode) || 500,
        {
          ok: false,
          error:
            error && error.statusCode
              ? error.message
              : 'pairing service request failed'
        },
        origin
      );
    }
  });
  server.keepAliveTimeout = 1000;
  server.headersTimeout = 5000;
  server.requestTimeout = 10000;
  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return server;
}

async function startService(options) {
  const settings = options || {};
  const manager = settings.manager || new PairingManager(settings);
  const server = createLoopbackServer(manager);
  const address = await listen(
    server,
    settings.loopbackPort == null ? LOOPBACK_PORT : settings.loopbackPort,
    settings.loopbackHost || LOOPBACK_HOST
  );
  return { manager, server, address };
}

async function run() {
  const service = await startService();
  log(
    'listening on http://' +
      service.address.address +
      ':' +
      service.address.port
  );
  const shutdown = (signal) => {
    log('received ' + signal + ', shutting down');
    service.manager.cancel();
    service.server.close(() => process.exit(0));
    const timer = setTimeout(() => process.exit(1), 3000);
    if (timer.unref) timer.unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  run().catch((error) => {
    log('startup failed: ' + error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  ALLOWED_ORIGINS,
  MAX_ATTEMPTS,
  PairingManager,
  PHONE_CSP,
  PHONE_HTML,
  SESSION_TTL_MS,
  accountFromYandex,
  createLoopbackServer,
  isPrivateIpv4,
  normalizeToken,
  readStoredCredential,
  selectLanAddress,
  startService,
  timingSafeStringEqual,
  validateYandexToken,
  writeSecretAtomically
};
