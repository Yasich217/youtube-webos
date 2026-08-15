'use strict';

/*
 * Root-side voice-over audio service for LG webOS.
 *
 * It deliberately uses mpg123's generic remote protocol and the dedicated
 * ptts PulseAudio sink. That keeps translated speech out of WAM, where webOS
 * limits applications to one activated HTML media player.
 */

const crypto = require('crypto');
const dns = require('dns');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');
const { EventEmitter } = require('events');
const { execFile, spawn } = require('child_process');
const { Transform, pipeline } = require('stream');

const HOST = '127.0.0.1';
const PORT = positiveInteger(process.env.VOT_AUDIO_PORT, 8767);
const CACHE_DIR =
  process.env.VOT_AUDIO_CACHE_DIR || '/run/youtube-vot/audio-cache';
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_AUDIO_BYTES = positiveInteger(
  process.env.VOT_AUDIO_MAX_BYTES,
  256 * 1024 * 1024
);
const DOWNLOAD_IDLE_TIMEOUT_MS = positiveInteger(
  process.env.VOT_AUDIO_DOWNLOAD_IDLE_TIMEOUT_MS,
  30 * 1000
);
const DOWNLOAD_TOTAL_TIMEOUT_MS = positiveInteger(
  process.env.VOT_AUDIO_DOWNLOAD_TOTAL_TIMEOUT_MS,
  5 * 60 * 1000
);
const MAX_REDIRECTS = 3;
const COMMAND_TIMEOUT_MS = positiveInteger(
  process.env.VOT_AUDIO_COMMAND_TIMEOUT_MS,
  5 * 1000
);
const MIX_SETTLE_MS = positiveInteger(process.env.VOT_AUDIO_MIX_SETTLE_MS, 200);
const PLAYBACK_LEASE_MS = positiveInteger(
  process.env.VOT_AUDIO_PLAYBACK_LEASE_MS,
  120 * 1000
);
const MAX_PLAYBACK_LEASE_MS = positiveInteger(
  process.env.VOT_AUDIO_MAX_PLAYBACK_LEASE_MS,
  10 * 60 * 1000
);
const MAX_CONTINUOUS_PLAYBACK_MS = positiveInteger(
  process.env.VOT_AUDIO_MAX_CONTINUOUS_PLAYBACK_MS,
  6 * 60 * 60 * 1000
);
const PLAYER_STALL_MS = positiveInteger(
  process.env.VOT_AUDIO_PLAYER_STALL_MS,
  12 * 1000
);
const SCREENSAVER_REFRESH_INTERVAL_MS = clamp(
  positiveInteger(
    process.env.VOT_AUDIO_SCREENSAVER_REFRESH_INTERVAL_MS,
    55 * 1000
  ),
  45 * 1000,
  60 * 1000
);
const CONTROLLER_HEARTBEAT_FRESH_MS = positiveInteger(
  process.env.VOT_AUDIO_CONTROLLER_HEARTBEAT_FRESH_MS,
  75 * 1000
);
const SCREENSAVER_SESSION_TTL_MS = Math.min(
  positiveInteger(
    process.env.VOT_AUDIO_SCREENSAVER_SESSION_TTL_MS,
    20 * 60 * 1000
  ),
  20 * 60 * 1000
);

const ALLOWED_ORIGINS = new Set([
  'https://www.youtube.com',
  'https://youtube.com',
  'null'
]);
const DEFAULT_AUDIO_HOST = 'vtrans.s3-private.mds.yandex.net';
const ALLOWED_AUDIO_HOSTS = new Set(
  [DEFAULT_AUDIO_HOST]
    .concat(String(process.env.VOT_AUDIO_ALLOWED_HOSTS || '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const AUDIO_CONTENT_TYPES = new Set(['audio/mpeg', 'audio/mp3']);
const MODERN_MIX_URI =
  'luna://com.webos.service.audio/tv/mixDigitalSoundOutput';
const LEGACY_MIX_URI = 'luna://com.webos.service.tv.sound/mixDigitalAudioOut';
const LEGACY_UNMIX_URI =
  'luna://com.webos.service.tv.sound/unmixDigitalAudioOut';
const SCREENSAVER_ACTIVITY_URI =
  'luna://com.webos.surfacemanager.screenSaver/restartUserActivityTimer';
const FOREGROUND_APP_URI =
  'luna://com.webos.applicationManager/getForegroundAppInfo';
const YOUTUBE_APP_ID = 'youtube.leanback.v4';
const LUNA_CALLER_ID = 'com.yasich.votd';
const MPG123_INSTANCE_NAME = 'com.yasich.votd';
const MPG123_OUTPUT_RATES = new Set([
  8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000
]);
const MPG123_OUTPUT_CHANNELS = 2;
const MPG123_OUTPUT_ENCODING = 's16';
const configuredTranslationVolume = Number(process.env.VOT_AUDIO_VOLUME);
const DEFAULT_TRANSLATION_VOLUME =
  Number.isFinite(configuredTranslationVolume) &&
  configuredTranslationVolume >= 0 &&
  configuredTranslationVolume <= 1
    ? configuredTranslationVolume
    : 0.62;
const DEFAULT_PLAYBACK_RATE = 1;
const YOUTUBE_VIDEO_ID_RE = /^[\w-]{6,64}$/;
const TRANSIENT_FOREGROUND_APP_IDS = new Set([
  'com.webos.app.notification',
  'com.webos.app.volume',
  'com.webos.app.mute',
  'com.webos.app.googleassistant',
  'yandex.alice'
]);

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hasOwn(value, property) {
  return Object.getOwnPropertyDescriptor(Object(value), property) !== undefined;
}

function waitMs(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function systemProcessEnv() {
  const environment = { ...process.env };
  // Private glibc is selected by the loader's --library-path. Exporting it to
  // stock webOS children (luna-send, script, /bin/sh) mixes two glibc builds.
  delete environment.LD_LIBRARY_PATH;
  delete environment.LD_PRELOAD;
  return environment;
}

function collectForegroundAppIds(value, result) {
  const output = result || [];
  if (!value) return output;
  if (Array.isArray(value)) {
    value.forEach((item) => {
      collectForegroundAppIds(item, output);
    });
    return output;
  }
  if (typeof value !== 'object') return output;
  const appId = value.appId || value.id;
  if (typeof appId === 'string' && appId) output.push(appId);
  [
    'foregroundAppInfo',
    'ForegroundApps',
    'FilteredForegroundApps',
    'running'
  ].forEach((key) => {
    if (value[key]) collectForegroundAppIds(value[key], output);
  });
  return output;
}

function createJsonObjectParser(onObject, onError) {
  let buffer = '';
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  return (chunk) => {
    buffer += String(chunk || '');
    for (let index = 0; index < buffer.length; index += 1) {
      const character = buffer[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === '{') {
        if (depth === 0) start = index;
        depth += 1;
        continue;
      }
      if (character !== '}') continue;
      depth -= 1;
      if (depth !== 0 || start < 0) continue;
      const json = buffer.slice(start, index + 1);
      buffer = buffer.slice(index + 1);
      index = -1;
      start = -1;
      try {
        onObject(JSON.parse(json));
      } catch (error) {
        log('foreground subscription JSON parse failed: ' + error.message);
        if (typeof onError === 'function') onError(error);
      }
    }
    if (depth === 0 && buffer.length > 8192) buffer = buffer.slice(-1024);
  };
}

function requestedVolume(payload, fallback) {
  if (!payload || !hasOwn(payload, 'volume')) return fallback;
  const volume = Number(payload.volume);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new ServiceError('volume must be a number from 0 to 1', 400);
  }
  return volume;
}

function requestedPlaybackRate(payload, fallback) {
  if (!payload || !hasOwn(payload, 'playbackRate')) return fallback;
  const playbackRate = Number(payload.playbackRate);
  if (
    !Number.isFinite(playbackRate) ||
    playbackRate < 0.5 ||
    playbackRate > 2
  ) {
    throw new ServiceError('playbackRate must be a number from 0.5 to 2', 400);
  }
  return playbackRate;
}

function log(message) {
  process.stdout.write(
    new Date().toISOString() + ' [VOT-Audio] ' + String(message) + '\n'
  );
}

class ServiceError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'ServiceError';
    this.statusCode = statusCode || 500;
  }
}

function requestedVideoId(payload) {
  if (
    !payload ||
    !hasOwn(payload, 'videoId') ||
    payload.videoId === null ||
    payload.videoId === undefined ||
    payload.videoId === ''
  ) {
    return null;
  }
  if (
    typeof payload.videoId !== 'string' ||
    !YOUTUBE_VIDEO_ID_RE.test(payload.videoId)
  ) {
    throw new ServiceError('videoId is invalid', 400);
  }
  return payload.videoId;
}

function parseIPv4(address) {
  if (net.isIP(address) !== 4) return null;
  const bytes = address.split('.').map(Number);
  return bytes.length === 4 ? bytes : null;
}

function parseIPv6(address) {
  let input = String(address).toLowerCase().split('%')[0];
  if (net.isIP(input) !== 6) return null;

  const ipv4Match = input.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const ipv4 = parseIPv4(ipv4Match[1]);
    if (!ipv4) return null;
    const replacement =
      ((ipv4[0] << 8) | ipv4[1]).toString(16) +
      ':' +
      ((ipv4[2] << 8) | ipv4[3]).toString(16);
    input = input.slice(0, -ipv4Match[1].length) + replacement;
  }

  const halves = input.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const omitted = 8 - left.length - right.length;
  if (omitted < 0 || (halves.length === 1 && omitted !== 0)) return null;
  const words = left
    .concat(new Array(omitted).fill('0'), right)
    .map((word) => Number.parseInt(word || '0', 16));
  if (words.length !== 8 || words.some((word) => !Number.isFinite(word))) {
    return null;
  }
  const bytes = [];
  words.forEach((word) => {
    bytes.push((word >>> 8) & 0xff, word & 0xff);
  });
  return bytes;
}

function isPublicIPv4(address) {
  const bytes = parseIPv4(address);
  if (!bytes) return false;
  const a = bytes[0];
  const b = bytes[1];
  const c = bytes[2];

  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIPv6(address) {
  const bytes = parseIPv6(address);
  if (!bytes) return false;
  const allZero = bytes.every((byte) => byte === 0);
  const loopback =
    bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  if (allZero || loopback) return false;
  if ((bytes[0] & 0xfe) === 0xfc) return false; // Unique local.
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return false; // Link local.
  if (bytes[0] === 0xff) return false; // Multicast.
  if (
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8
  ) {
    return false; // Documentation range.
  }

  const ipv4Mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  if (ipv4Mapped) {
    return isPublicIPv4(bytes.slice(12).join('.'));
  }
  // Reject deprecated IPv4-compatible and other unspecified ::/96 forms.
  if (bytes.slice(0, 12).every((byte) => byte === 0)) return false;
  return true;
}

function isPublicAddress(address, family) {
  const normalizedFamily = Number(family) || net.isIP(address);
  if (normalizedFamily === 4) return isPublicIPv4(address);
  if (normalizedFamily === 6) return isPublicIPv6(address);
  return false;
}

function validateAudioUrl(rawUrl) {
  let target;
  try {
    target = new URL(String(rawUrl));
  } catch {
    throw new ServiceError('invalid audio URL', 400);
  }
  const hostname = target.hostname.toLowerCase();
  if (target.protocol !== 'https:') {
    throw new ServiceError('audio URL must use HTTPS', 400);
  }
  if (!ALLOWED_AUDIO_HOSTS.has(hostname)) {
    throw new ServiceError('audio URL host is not allowed', 400);
  }
  if (target.username || target.password || target.port) {
    throw new ServiceError(
      'audio URL contains unsupported authority fields',
      400
    );
  }
  if (!target.pathname.endsWith('.mp3')) {
    throw new ServiceError('audio URL is not an MP3 resource', 400);
  }
  return target;
}

function resolvePublicHost(hostname, lookup) {
  const lookupFn = lookup || dns.lookup;
  return new Promise((resolve, reject) => {
    lookupFn(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        reject(new ServiceError('audio host DNS lookup failed', 502));
        return;
      }
      const records = Array.isArray(addresses) ? addresses : [];
      if (
        !records.length ||
        records.some((entry) => !isPublicAddress(entry.address, entry.family))
      ) {
        reject(
          new ServiceError('audio host resolved to a non-public address', 400)
        );
        return;
      }
      // Prefer IPv4 on old webOS networking stacks, while TLS still verifies hostname/SNI.
      resolve(
        records.find((entry) => Number(entry.family) === 4) || records[0]
      );
    });
  });
}

class ByteLimitTransform extends Transform {
  constructor(limit) {
    super();
    this.limit = limit;
    this.bytes = 0;
    this.hash = crypto.createHash('sha256');
    this.prefix = Buffer.alloc(0);
  }

  _transform(chunk, encoding, callback) {
    this.bytes += chunk.length;
    if (this.bytes > this.limit) {
      callback(new ServiceError('audio download exceeds size limit', 413));
      return;
    }
    this.hash.update(chunk);
    if (this.prefix.length < 16) {
      this.prefix = Buffer.concat([this.prefix, chunk]).slice(0, 16);
    }
    callback(null, chunk);
  }

  digest() {
    return this.hash.digest('hex');
  }
}

function looksLikeMp3(prefix) {
  if (!prefix || prefix.length < 3) return false;
  if (prefix.slice(0, 3).toString('ascii') === 'ID3') return true;
  for (let index = 0; index + 1 < prefix.length; index += 1) {
    if (prefix[index] === 0xff && (prefix[index + 1] & 0xe0) === 0xe0)
      return true;
  }
  return false;
}

class AudioDownloader {
  constructor(options) {
    const opts = options || {};
    this.lookup = opts.lookup || dns.lookup;
    this.maxBytes = opts.maxBytes || MAX_AUDIO_BYTES;
    this.idleTimeoutMs = opts.idleTimeoutMs || DOWNLOAD_IDLE_TIMEOUT_MS;
    this.totalTimeoutMs = opts.totalTimeoutMs || DOWNLOAD_TOTAL_TIMEOUT_MS;
    this.active = null;
  }

  cancel(message) {
    const active = this.active;
    if (!active) return;
    active.cancelled = true;
    active.error = new ServiceError(message || 'audio download cancelled', 409);
    if (active.request) active.request.destroy(active.error);
  }

  async download(rawUrl, destinationPath) {
    if (this.active)
      throw new ServiceError('another audio download is active', 409);
    const active = {
      cancelled: false,
      error: null,
      request: null,
      timer: null
    };
    this.active = active;
    active.timer = setTimeout(() => {
      active.cancelled = true;
      active.error = new ServiceError('audio download timed out', 504);
      if (active.request) active.request.destroy(active.error);
    }, this.totalTimeoutMs);

    try {
      const target = validateAudioUrl(rawUrl);
      return await this._downloadTarget(target, destinationPath, 0, active);
    } finally {
      clearTimeout(active.timer);
      if (this.active === active) this.active = null;
    }
  }

  async _downloadTarget(target, destinationPath, redirects, active) {
    if (active.cancelled) throw active.error;
    if (redirects > MAX_REDIRECTS) {
      throw new ServiceError('audio download has too many redirects', 502);
    }
    const pinned = await resolvePublicHost(target.hostname, this.lookup);
    if (active.cancelled) throw active.error;

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(
          error instanceof ServiceError
            ? error
            : new ServiceError('audio download failed', 502)
        );
      };
      const request = https.request(
        {
          protocol: 'https:',
          hostname: target.hostname,
          port: 443,
          method: 'GET',
          path: target.pathname + target.search,
          servername: target.hostname,
          agent: false,
          headers: {
            Accept: 'audio/mpeg',
            'Accept-Encoding': 'identity',
            'User-Agent': 'youtube-webos-vot-audio/1.0'
          },
          lookup: (hostname, options, callback) => {
            callback(null, pinned.address, Number(pinned.family));
          }
        },
        (response) => {
          const statusCode = Number(response.statusCode || 0);
          if ([301, 302, 303, 307, 308].includes(statusCode)) {
            const location = response.headers.location;
            response.resume();
            if (!location) {
              fail(new ServiceError('audio redirect has no location', 502));
              return;
            }
            let redirected;
            try {
              redirected = validateAudioUrl(
                new URL(location, target).toString()
              );
            } catch (error) {
              fail(error);
              return;
            }
            settled = true;
            this._downloadTarget(
              redirected,
              destinationPath,
              redirects + 1,
              active
            ).then(resolve, reject);
            return;
          }

          if (statusCode !== 200 && statusCode !== 206) {
            response.resume();
            fail(
              new ServiceError('audio origin returned HTTP ' + statusCode, 502)
            );
            return;
          }
          const contentType = String(response.headers['content-type'] || '')
            .split(';')[0]
            .trim()
            .toLowerCase();
          if (!AUDIO_CONTENT_TYPES.has(contentType)) {
            response.resume();
            fail(
              new ServiceError(
                'audio origin returned an unexpected content type',
                502
              )
            );
            return;
          }
          const contentLength = Number(response.headers['content-length']);
          if (
            Number.isFinite(contentLength) &&
            (contentLength <= 0 || contentLength > this.maxBytes)
          ) {
            response.resume();
            fail(
              new ServiceError(
                'audio origin content length is outside limits',
                413
              )
            );
            return;
          }

          const limiter = new ByteLimitTransform(this.maxBytes);
          const output = fs.createWriteStream(destinationPath, {
            flags: 'wx',
            mode: 0o600
          });
          pipeline(response, limiter, output, (error) => {
            if (settled) return;
            if (error) {
              fail(error);
              return;
            }
            if (!limiter.bytes || !looksLikeMp3(limiter.prefix)) {
              fail(
                new ServiceError(
                  'downloaded resource is not an MP3 stream',
                  502
                )
              );
              return;
            }
            settled = true;
            resolve({
              path: destinationPath,
              bytes: limiter.bytes,
              sha256: limiter.digest(),
              contentType
            });
          });
        }
      );
      active.request = request;
      request.setTimeout(this.idleTimeoutMs, () => {
        request.destroy(new ServiceError('audio download stalled', 504));
      });
      request.on('error', (error) => {
        fail(active.cancelled && active.error ? active.error : error);
      });
      request.end();
    });
  }
}

class Mpg123Remote extends EventEmitter {
  constructor(options) {
    super();
    const opts = options || {};
    this.binary =
      opts.binary || process.env.VOT_AUDIO_MPG123_BIN || '/usr/bin/mpg123';
    this.output = opts.output || process.env.VOT_AUDIO_OUTPUT_MODULE || 'pulse';
    this.device = hasOwn(opts, 'device')
      ? opts.device
      : process.env.VOT_AUDIO_OUTPUT_DEVICE ||
        process.env.VOT_AUDIO_PULSE_DEVICE ||
        'ptts';
    this.deviceBufferSeconds = String(
      opts.deviceBufferSeconds ||
        process.env.VOT_AUDIO_DEVICE_BUFFER_SECONDS ||
        '0.10'
    );
    this.commandTimeoutMs = opts.commandTimeoutMs || COMMAND_TIMEOUT_MS;
    this.child = null;
    this.waiters = [];
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.expectedExit = false;
  }

  async start() {
    if (this.child && this.child.exitCode === null) return;
    this.expectedExit = false;
    const child = spawn(this.binary, this.spawnArguments(), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: systemProcessEnv()
    });
    this.child = child;
    child.stdout.on('data', (chunk) => this._consume('stdout', chunk));
    child.stderr.on('data', (chunk) => this._consume('stderr', chunk));
    child.on('error', (error) => this._handleExit(error));
    child.on('exit', (code, signal) => {
      this._handleExit(
        new Error(
          'mpg123 exited (' + String(code) + ', ' + String(signal) + ')'
        )
      );
    });
    await this._waitFor(
      (line) => (line.startsWith('@R MPG123') ? line : null),
      this.commandTimeoutMs,
      'mpg123 startup'
    );
  }

  spawnArguments() {
    const args = [
      '-q',
      '-R',
      '--remote-err',
      '--keep-open',
      '--name',
      MPG123_INSTANCE_NAME,
      '--stereo',
      '-e',
      MPG123_OUTPUT_ENCODING,
      '--timeout',
      '10',
      '--devbuffer',
      this.deviceBufferSeconds,
      '-o',
      this.output
    ];
    if (this.device) args.push('-a', this.device);
    return args;
  }

  _consume(channel, chunk) {
    const key = channel + 'Buffer';
    this[key] += chunk.toString('utf8');
    if (this[key].length > 128 * 1024) this[key] = this[key].slice(-64 * 1024);
    let newline;
    while ((newline = this[key].indexOf('\n')) !== -1) {
      const line = this[key].slice(0, newline).replace(/\r$/, '');
      this[key] = this[key].slice(newline + 1);
      if (line) this._handleLine(line);
    }
  }

  _handleLine(line) {
    this.emit('line', line);
    for (let index = 0; index < this.waiters.length; index += 1) {
      const waiter = this.waiters[index];
      if (line.startsWith('@E ')) {
        this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.reject(new ServiceError('mpg123 rejected a command', 502));
        return;
      }
      let result;
      try {
        result = waiter.predicate(line);
      } catch (error) {
        this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.reject(error);
        return;
      }
      if (result !== null && result !== undefined && result !== false) {
        this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(result);
        return;
      }
    }
  }

  _waitFor(predicate, timeoutMs, description) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(new ServiceError(description + ' timed out', 504));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async command(command, predicate, description) {
    if (
      !this.child ||
      this.child.exitCode !== null ||
      !this.child.stdin.writable
    ) {
      throw new ServiceError('mpg123 is not running', 502);
    }
    if (/[\r\n]/.test(command))
      throw new ServiceError('invalid mpg123 command', 500);
    const response = this._waitFor(
      predicate,
      this.commandTimeoutMs,
      description || command
    );
    this.child.stdin.write(command + '\n');
    return response;
  }

  loadPaused(filePath) {
    if (/[\r\n]/.test(filePath))
      throw new ServiceError('invalid cache path', 500);
    return this.command(
      'LOADPAUSED ' + filePath,
      (line) => {
        if (line === '@P 1') return true;
        if (line === '@P 0') {
          throw new ServiceError('mpg123 could not load cached audio', 502);
        }
        return null;
      },
      'mpg123 load'
    );
  }

  format() {
    return this.command(
      'FORMAT',
      (line) => {
        const match = line.match(/^@FORMAT (\d+) (\d+)$/);
        if (!match) return null;
        const format = {
          rate: Number(match[1]),
          channels: Number(match[2])
        };
        if (
          !MPG123_OUTPUT_RATES.has(format.rate) ||
          format.channels !== MPG123_OUTPUT_CHANNELS
        ) {
          throw new ServiceError(
            'unexpected mpg123 output format ' +
              String(format.rate) +
              ' Hz/' +
              String(format.channels) +
              ' ch',
            502
          );
        }
        return format;
      },
      'mpg123 format query'
    );
  }

  sample() {
    return this.command(
      'SAMPLE',
      (line) => {
        const match = line.match(/^@SAMPLE (\d+) (\d+)$/);
        return match
          ? { position: Number(match[1]), length: Number(match[2]) }
          : null;
      },
      'mpg123 sample query'
    );
  }

  seekSamples(sample) {
    const target = Math.max(0, Math.round(sample));
    return this.command(
      'SEEK ' + String(target),
      (line) => {
        const match = line.match(/^@K (\d+)$/);
        if (!match) return null;
        const actual = Number(match[1]);
        if (actual !== target) {
          throw new ServiceError(
            'mpg123 seek mismatch: requested ' +
              String(target) +
              ', got ' +
              String(actual),
            502
          );
        }
        return actual;
      },
      'mpg123 seek'
    );
  }

  setPaused(paused) {
    const desired = paused ? '@P 1' : '@P 2';
    return this.command(
      'PAUSE',
      (line) => (line === desired ? true : null),
      'mpg123 pause'
    );
  }

  setVolume(volume) {
    const percent = clamp(Number(volume), 0, 1) * 100;
    return this.command(
      'VOLUME ' + percent.toFixed(3),
      (line) => {
        const match = line.match(/^@V ([0-9.]+)%$/);
        return match ? Number(match[1]) / 100 : null;
      },
      'mpg123 volume'
    );
  }

  setPlaybackRate(playbackRate) {
    const target = clamp(Number(playbackRate), 0.5, 2);
    const pitch = target - 1;
    return this.command(
      'PITCH ' + pitch.toFixed(6),
      (line) => {
        const match = line.match(/^@PITCH (-?[0-9.]+)$/);
        if (!match) return null;
        const actual = Number(match[1]) + 1;
        if (Math.abs(actual - target) > 0.001) {
          throw new ServiceError(
            'mpg123 playback-rate mismatch: requested ' +
              String(target) +
              ', got ' +
              String(actual),
            502
          );
        }
        return actual;
      },
      'mpg123 playback rate'
    );
  }

  stop() {
    return this.command(
      'STOP',
      (line) => (line === '@P 0' ? true : null),
      'mpg123 stop'
    );
  }

  _handleExit(error) {
    const child = this.child;
    if (!child) return;
    this.child = null;
    const waiters = this.waiters.splice(0);
    waiters.forEach((waiter) => {
      clearTimeout(waiter.timer);
      waiter.reject(new ServiceError('mpg123 exited unexpectedly', 502));
    });
    this.emit('exit', { error, expected: this.expectedExit });
  }

  async close() {
    const child = this.child;
    if (!child) return;
    this.expectedExit = true;
    try {
      if (child.stdin.writable) child.stdin.write('QUIT\n');
    } catch {
      // Escalation below is intentional.
    }
    await new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      child.once('exit', finish);
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
          finish();
        }, 700).unref();
      }, 700).unref();
    });
  }
}

function execFileCapture(binary, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 64 * 1024,
        env: systemProcessEnv()
      },
      (error, stdout, stderr) => {
        if (error) reject(error);
        else
          resolve({
            stdout: String(stdout || ''),
            stderr: String(stderr || '')
          });
      }
    );
  });
}

function lunaArgs(uri, payload, timeoutMs) {
  // -f only pretty-prints JSON. -n 1 waits for one reply, while -w adds an
  // LS2-native timeout below Node's outer execFile timeout.
  return [
    '-n',
    '1',
    '-w',
    String(Math.max(250, timeoutMs - 500)),
    '-f',
    uri,
    JSON.stringify(payload)
  ];
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function lunaSubscriptionSpawn(binary, uri, payload, scriptBinary) {
  const lunaCommand = [binary, '-i', '-f', uri, JSON.stringify(payload)];
  if (!scriptBinary) return { binary, args: lunaCommand.slice(1) };
  return {
    binary: scriptBinary,
    args: ['-q', '-f', '-c', lunaCommand.map(shellQuote).join(' '), '/dev/null']
  };
}

function parseLunaJsonResponse(output) {
  const text = String(output || '').replace(/\r/g, '');
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  const candidates = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try {
      const response = JSON.parse(candidates[index]);
      if (response && typeof response.returnValue === 'boolean') {
        if (response.returnValue !== true) {
          throw new Error(
            'Luna request rejected' +
              (response.errorCode === undefined
                ? ''
                : ' (' + String(response.errorCode) + ')')
          );
        }
        return response;
      }
    } catch (error) {
      if (error && /^Luna request rejected/.test(error.message)) throw error;
    }
  }
  throw new Error('Luna request returned no acknowledged JSON response');
}

async function requestLunaJson(settings) {
  const binary = settings.binary;
  const args = lunaArgs(settings.uri, settings.payload, settings.timeoutMs);
  let result;
  if (fs.existsSync('/usr/bin/script')) {
    const command = [binary].concat(args).map(shellQuote).join(' ');
    result = await execFileCapture(
      '/usr/bin/script',
      ['-q', '-c', command, '/dev/null'],
      settings.timeoutMs
    );
  } else {
    result = await execFileCapture(binary, args, settings.timeoutMs);
  }
  return parseLunaJsonResponse(result.stdout);
}

class DigitalMixer {
  constructor(options) {
    const opts = options || {};
    this.binary =
      opts.binary || process.env.VOT_AUDIO_LUNA_BIN || '/usr/bin/luna-send';
    this.timeoutMs = opts.timeoutMs || 3500;
    this.request = opts.request || requestLunaJson;
    this.enabled = false;
    this.backend = null;
  }

  _backendRequest(backend, enabled) {
    if (backend === 'modern') {
      return {
        binary: this.binary,
        uri: MODERN_MIX_URI,
        payload: { mix: Boolean(enabled), callerId: LUNA_CALLER_ID },
        timeoutMs: this.timeoutMs
      };
    }
    return {
      binary: this.binary,
      uri: enabled ? LEGACY_MIX_URI : LEGACY_UNMIX_URI,
      payload: { requestApp: YOUTUBE_APP_ID },
      timeoutMs: this.timeoutMs
    };
  }

  async _call(backend, enabled) {
    await this.request(this._backendRequest(backend, enabled));
  }

  async _disableBackendSafely(backend, context) {
    try {
      await this._call(backend, false);
      return true;
    } catch (error) {
      log(
        'digital mixer ' +
          backend +
          ' ' +
          (context || 'cleanup') +
          ' failed: ' +
          error.message
      );
      return false;
    }
  }

  async set(enabled) {
    const desired = Boolean(enabled);
    if (this.enabled === desired) return;
    if (!desired) {
      await this.disableSafely();
      return;
    }

    const order = this.backend
      ? [this.backend, this.backend === 'modern' ? 'legacy' : 'modern']
      : ['modern', 'legacy'];
    let lastError = null;
    for (const backend of order) {
      try {
        // Capability probing is intentionally ordered; parallel mix requests
        // could leave two platform policies enabled at once.
        // eslint-disable-next-line no-await-in-loop
        await this._call(backend, true);
        this.backend = backend;
        this.enabled = true;
        log('digital mixer backend selected: ' + backend);
        return;
      } catch (error) {
        lastError = error;
        log('digital mixer ' + backend + ' enable failed: ' + error.message);
        // A timeout or a lost acknowledgement is ambiguous: the platform may
        // already have applied this backend. Undo that exact request before a
        // fallback backend is allowed to enable, so two ducking policies can
        // never remain active together.
        // eslint-disable-next-line no-await-in-loop
        await this._disableBackendSafely(backend, 'post-enable cleanup');
      }
    }
    this.enabled = false;
    throw (
      lastError || new Error('no digital mixer backend acknowledged enable')
    );
  }

  async disableSafely() {
    const order = this.backend ? [this.backend] : ['modern', 'legacy'];
    const acknowledgements = {};
    for (const backend of order) {
      // When the backend is unknown (for example after a service crash), both
      // policies must be cleared even when the first cleanup is acknowledged.
      // eslint-disable-next-line no-await-in-loop
      acknowledgements[backend] = await this._disableBackendSafely(backend);
    }
    this.enabled = false;
    if (!Object.values(acknowledgements).some(Boolean)) {
      log('could not confirm digital unmix');
    }
    return acknowledgements;
  }
}

class ScreensaverActivityLease {
  constructor(options) {
    const opts = options || {};
    this.binary =
      opts.binary || process.env.VOT_AUDIO_LUNA_BIN || '/usr/bin/luna-send';
    this.timeoutMs = opts.timeoutMs || 3500;
    this.minimumIntervalMs =
      opts.minimumIntervalMs || SCREENSAVER_REFRESH_INTERVAL_MS;
    this.now = opts.now || Date.now;
    this.runner = opts.runner || null;
    this.request = opts.request || requestLunaJson;
    this.lastAttemptAt = 0;
    this.inFlight = null;
  }

  tryRefresh() {
    const now = this.now();
    if (
      this.inFlight ||
      (this.lastAttemptAt && now - this.lastAttemptAt < this.minimumIntervalMs)
    ) {
      return false;
    }
    this.lastAttemptAt = now;
    this.inFlight = Promise.resolve()
      .then(() => {
        if (this.runner) {
          return this.runner(
            this.binary,
            lunaArgs(SCREENSAVER_ACTIVITY_URI, {}, this.timeoutMs),
            this.timeoutMs
          );
        }
        return this.request({
          binary: this.binary,
          uri: SCREENSAVER_ACTIVITY_URI,
          payload: {},
          timeoutMs: this.timeoutMs
        });
      })
      .catch((error) => {
        // Fail open: a screensaver API failure never pauses or breaks playback.
        log('screensaver activity refresh failed: ' + error.message);
      })
      .finally(() => {
        this.inFlight = null;
      });
    return true;
  }
}

class ForegroundAppGuard {
  constructor(options) {
    const opts = options || {};
    this.binary =
      opts.binary || process.env.VOT_AUDIO_LUNA_BIN || '/usr/bin/luna-send';
    this.restartMs = positiveInteger(opts.restartMs, 2000);
    // Some older LS2 builds acknowledge and keep getForegroundAppInfo
    // subscriptions alive without delivering subsequent foreground changes.
    // Keep a bounded one-shot query as a safety net instead of trusting an
    // apparently healthy subscription indefinitely.
    this.pollMs = positiveInteger(opts.pollMs, 2000);
    this.timeoutMs = positiveInteger(opts.timeoutMs, 3500);
    this.request = opts.request || requestLunaJson;
    this.spawnFn = opts.spawnFn || spawn;
    this.scriptBinary = hasOwn(opts, 'scriptBinary')
      ? opts.scriptBinary
      : fs.existsSync('/usr/bin/script')
        ? '/usr/bin/script'
        : null;
    this.onDisallowed = opts.onDisallowed || (() => {});
    this.child = null;
    this.restartTimer = null;
    this.pollTimer = null;
    this.initialQueryInFlight = null;
    this.closed = false;
    this.known = false;
    this.allowed = true;
    this.appIds = [];
  }

  start() {
    if (this.closed || this.child) return;
    this._refreshCurrent();
    this._startPolling();
    const launch = lunaSubscriptionSpawn(
      this.binary,
      FOREGROUND_APP_URI,
      { subscribe: true },
      this.scriptBinary
    );
    const child = this.spawnFn(launch.binary, launch.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: systemProcessEnv()
    });
    this.child = child;
    const parse = createJsonObjectParser(
      (payload) => {
        if (!this.handlePayload(payload)) {
          this._failClosed('foreground-monitor-unavailable');
        }
      },
      () => this._failClosed('foreground-monitor-unavailable')
    );
    child.stdout.on('data', parse);
    child.stderr.on('data', (chunk) => {
      const message = String(chunk || '').trim();
      if (message) log('foreground subscription stderr: ' + message);
    });
    child.on('error', (error) => {
      log('foreground subscription failed: ' + error.message);
    });
    child.on('close', () => {
      if (this.child === child) this.child = null;
      if (this.closed || this.restartTimer) return;
      this._failClosed('foreground-monitor-unavailable');
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.start();
      }, this.restartMs);
      this.restartTimer.unref();
    });
  }

  _startPolling() {
    if (this.closed || this.pollTimer) return;
    this.pollTimer = setInterval(() => this._refreshCurrent(), this.pollMs);
    this.pollTimer.unref();
  }

  _refreshCurrent() {
    if (this.closed || this.initialQueryInFlight) return;
    this.initialQueryInFlight = Promise.resolve()
      .then(() =>
        this.request({
          binary: this.binary,
          uri: FOREGROUND_APP_URI,
          payload: {},
          timeoutMs: this.timeoutMs
        })
      )
      .then((payload) => {
        if (
          !this.closed &&
          !this.handlePayload(payload)
        ) {
          this._failClosed('foreground-monitor-unavailable');
        }
      })
      .catch((error) => {
        log('initial foreground query failed: ' + error.message);
        if (this.closed) return;
        this._failClosed('foreground-monitor-unavailable');
      })
      .finally(() => {
        this.initialQueryInFlight = null;
      });
  }

  handlePayload(payload) {
    const appIds = collectForegroundAppIds(payload).filter(
      (appId, index, values) => values.indexOf(appId) === index
    );
    if (!appIds.length) return false;
    const relevantAppIds = appIds.filter(
      (appId) => !TRANSIENT_FOREGROUND_APP_IDS.has(appId)
    );
    if (!relevantAppIds.length) return true;
    const wasAllowed = this.allowed;
    this.known = true;
    this.appIds = appIds;
    this.allowed = relevantAppIds.includes(YOUTUBE_APP_ID);
    if (wasAllowed && !this.allowed) this.onDisallowed(this.appIds.slice());
    return true;
  }

  _failClosed(reason) {
    if (this.closed) return;
    const wasAllowed = this.allowed;
    this.known = false;
    this.allowed = false;
    this.appIds = [];
    if (wasAllowed) this.onDisallowed([reason]);
  }

  assertAllowed() {
    if (!this.known || !this.allowed) {
      throw new ServiceError('YouTube is not the foreground application', 409);
    }
  }

  setOnDisallowed(callback) {
    this.onDisallowed = typeof callback === 'function' ? callback : () => {};
  }

  close() {
    this.closed = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) child.kill('SIGTERM');
  }
}

function adjustedPosition(payload, playbackRate) {
  const position = clamp(
    finiteNumber(payload && payload.position, 0),
    0,
    24 * 60 * 60
  );
  const clientTimestampMs = finiteNumber(
    payload && payload.clientTimestampMs,
    0
  );
  if (!clientTimestampMs) return position;
  const transitSeconds =
    clamp((Date.now() - clientTimestampMs) / 1000, 0, 2) *
    clamp(finiteNumber(playbackRate, DEFAULT_PLAYBACK_RATE), 0.5, 2);
  return position + transitSeconds;
}

class AudioService {
  constructor(options) {
    const opts = options || {};
    this.cacheDir = opts.cacheDir || CACHE_DIR;
    this.downloader = opts.downloader || new AudioDownloader();
    this.player = opts.player || new Mpg123Remote();
    this.mixer = opts.mixer || new DigitalMixer();
    this.screensaver = opts.screensaver || new ScreensaverActivityLease();
    this.foreground = opts.foreground || new ForegroundAppGuard();
    this.state = 'idle';
    this.cache = null;
    this.rate = 0;
    this.channels = 0;
    this.totalSamples = 0;
    this.positionSamples = 0;
    this.volume = DEFAULT_TRANSLATION_VOLUME;
    this.playbackRate = DEFAULT_PLAYBACK_RATE;
    this.videoId = null;
    this.playerLoadedPath = null;
    this.lastProgressAt = 0;
    this.lastError = null;
    this.leaseDeadline = 0;
    this.continuousPlaybackDeadline = 0;
    this.lastControllerHeartbeatAt = 0;
    this.screensaverSessionStartedAt = 0;
    this.screensaverSessionDeadline = 0;
    this.transition = null;
    this.closed = false;
    this.initialized = false;
    this.queue = Promise.resolve();
    this.watchdogBusy = false;
    this.player.on('line', (line) => this._onPlayerLine(line));
    this.player.on('exit', (event) => this._onPlayerExit(event));
    this.watchdog = setInterval(() => this._watchdog(), 1000);
    this.watchdog.unref();
    this.foreground.setOnDisallowed((appIds) =>
      this._handleForegroundLoss(appIds)
    );
  }

  enqueue(operation) {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => {});
    return run;
  }

  async initialize() {
    await fs.promises.mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
    await this._cleanStaleCache();
    await this.mixer.disableSafely();
    this.foreground.start();
    this.initialized = true;
  }

  _handleForegroundLoss(appIds) {
    if (this.closed) return;
    if (this.state === 'loading') {
      this.cancelDownload('YouTube left the foreground');
    }
    if (this.state !== 'playing') return;
    this.enqueue(async () => {
      if (this.state !== 'playing' || this.foreground.allowed) return;
      log(
        'YouTube left foreground (' +
          appIds.join(',') +
          '); pausing translated audio'
      );
      await this._pauseAndUnmix('foreground application changed');
      if (this.cache && this.state !== 'error') this.state = 'paused';
    }).catch((error) => {
      log('foreground pause failed: ' + error.message);
    });
  }

  async _cleanStaleCache() {
    let entries = [];
    try {
      entries = await fs.promises.readdir(this.cacheDir, {
        withFileTypes: true
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            /^vot-[a-f0-9]{24}\.mp3(?:\.part)?$/.test(entry.name)
        )
        .map((entry) =>
          fs.promises
            .unlink(path.join(this.cacheDir, entry.name))
            .catch(() => {})
        )
    );
  }

  cancelDownload(reason) {
    this.downloader.cancel(reason);
  }

  isStaleVideoSession(payload) {
    const videoId = requestedVideoId(payload);
    return Boolean(videoId && this.videoId && videoId !== this.videoId);
  }

  _assertVideoSession(payload) {
    if (this.isStaleVideoSession(payload)) {
      throw new ServiceError('stale video session', 409);
    }
    return requestedVideoId(payload);
  }

  async load(payload) {
    const rawUrl = payload && payload.url;
    validateAudioUrl(rawUrl);
    const previousVideoId = this.videoId;
    const videoId = requestedVideoId(payload);
    if (videoId) this.videoId = videoId;
    const volume = requestedVolume(payload, this.volume);
    const playbackRate = requestedPlaybackRate(payload, this.playbackRate);
    await this._pauseAndUnmix('new audio load');
    this.state = 'loading';
    this.lastError = null;
    const token = crypto.randomBytes(12).toString('hex');
    const destination = path.join(this.cacheDir, 'vot-' + token + '.mp3.part');
    let downloaded;
    try {
      downloaded = await this.downloader.download(rawUrl, destination);
      const finalPath = destination.slice(0, -'.part'.length);
      await fs.promises.rename(destination, finalPath);
      downloaded.path = finalPath;

      await this.player.start();
      this.transition = 'load';
      await this.player.loadPaused(downloaded.path);
      this.transition = null;
      this.playerLoadedPath = downloaded.path;
      await this._applyPlaybackRate(playbackRate);
      this.volume = await this.player.setVolume(volume);
      const format = await this.player.format();
      const sample = await this.player.sample();
      if (!format.rate || !sample.length) {
        throw new ServiceError(
          'mpg123 could not determine audio duration',
          502
        );
      }

      const previous = this.cache;
      this.cache = {
        path: downloaded.path,
        bytes: downloaded.bytes,
        sha256: downloaded.sha256,
        loadedAt: Date.now()
      };
      this.rate = format.rate;
      this.channels = format.channels;
      this.totalSamples = sample.length;
      this.positionSamples = sample.position;
      this.state = 'ready';
      if (previous && previous.path !== downloaded.path) {
        await fs.promises.unlink(previous.path).catch(() => {});
      }
      log(
        'loaded ' +
          String(downloaded.bytes) +
          ' bytes, sha256=' +
          downloaded.sha256.slice(0, 12) +
          ', duration=' +
          (this.totalSamples / this.rate).toFixed(2) +
          's'
      );
      return this.status();
    } catch (error) {
      if (videoId && this.videoId === videoId) {
        this.videoId = previousVideoId;
      }
      this.transition = null;
      this.playerLoadedPath = null;
      await this.player.close().catch(() => {});
      await fs.promises.unlink(destination).catch(() => {});
      if (downloaded && downloaded.path) {
        await fs.promises.unlink(downloaded.path).catch(() => {});
      }
      this.lastError = error.message;
      this.state = this.cache ? 'ready' : 'error';
      throw error;
    } finally {
      if (this.state !== 'playing') await this.mixer.disableSafely();
    }
  }

  async _ensurePlayerLoaded() {
    if (!this.cache)
      throw new ServiceError('no translated audio is loaded', 409);
    if (!this.player.child || this.playerLoadedPath !== this.cache.path) {
      await this.player.start();
      this.transition = 'load';
      await this.player.loadPaused(this.cache.path);
      this.transition = null;
      this.playerLoadedPath = this.cache.path;
      await this._applyPlaybackRate(this.playbackRate);
      this.volume = await this.player.setVolume(this.volume);
      const format = await this.player.format();
      const sample = await this.player.sample();
      this.rate = format.rate;
      this.channels = format.channels;
      this.totalSamples = sample.length;
      this.positionSamples = sample.position;
      this.state = 'ready';
    }
  }

  async _applyPlaybackRate(playbackRate) {
    const actual = await this.player.setPlaybackRate(playbackRate);
    if (Math.abs(actual - playbackRate) > 0.001) {
      throw new ServiceError(
        'mpg123 could not apply the requested playback rate',
        502
      );
    }
    this.playbackRate = actual;
  }

  _renewLease(payload) {
    const requested = positiveInteger(
      payload && payload.leaseMs,
      PLAYBACK_LEASE_MS
    );
    this.leaseDeadline =
      Date.now() + Math.min(requested, MAX_PLAYBACK_LEASE_MS);
  }

  _startOrRefreshScreensaverSession(isExistingSession) {
    const now = Date.now();
    this.lastControllerHeartbeatAt = now;
    if (!isExistingSession || !this.screensaverSessionStartedAt) {
      this.screensaverSessionStartedAt = now;
      this.screensaverSessionDeadline = now + SCREENSAVER_SESSION_TTL_MS;
    }
    this._maybeRefreshScreensaver(now);
  }

  _endScreensaverSession() {
    this.lastControllerHeartbeatAt = 0;
    this.screensaverSessionStartedAt = 0;
    this.screensaverSessionDeadline = 0;
  }

  _maybeRefreshScreensaver(nowValue) {
    const now = nowValue || Date.now();
    if (this.state !== 'playing') return false;
    if (
      !this.screensaverSessionDeadline ||
      now >= this.screensaverSessionDeadline
    ) {
      return false;
    }
    if (
      !this.lastControllerHeartbeatAt ||
      now - this.lastControllerHeartbeatAt > CONTROLLER_HEARTBEAT_FRESH_MS
    ) {
      return false;
    }
    return this.screensaver.tryRefresh();
  }

  async play(payload) {
    this._assertVideoSession(payload);
    this.foreground.assertAllowed();
    await this._ensurePlayerLoaded();
    const volume = requestedVolume(payload, this.volume);
    const playbackRate = requestedPlaybackRate(payload, this.playbackRate);
    const wasPlaying = this.state === 'playing';
    let started = false;
    try {
      if (wasPlaying) await this._pauseRemote();
      if (playbackRate !== this.playbackRate) {
        await this._applyPlaybackRate(playbackRate);
      }
      if (volume !== this.volume) {
        this.volume = await this.player.setVolume(volume);
      }
      const mixerNeedsSettle = !this.mixer.enabled;
      await this.mixer.set(true);
      if (mixerNeedsSettle) await waitMs(MIX_SETTLE_MS);
      const position = adjustedPosition(payload || {}, this.playbackRate);
      const sample = clamp(
        Math.round(position * this.rate),
        0,
        Math.max(0, this.totalSamples - 1)
      );
      this.positionSamples = await this.player.seekSamples(sample);
      await this._startRemoteIfForeground();
      started = true;
      this.state = 'playing';
      this.lastProgressAt = Date.now();
      this.continuousPlaybackDeadline = Date.now() + MAX_CONTINUOUS_PLAYBACK_MS;
      this._renewLease(payload);
      this._startOrRefreshScreensaverSession(wasPlaying);
      this.lastError = null;
      return this.status();
    } finally {
      this.transition = null;
      if (!started) {
        this.state = this.cache ? 'paused' : 'error';
        this._endScreensaverSession();
        if (wasPlaying) {
          this.playerLoadedPath = null;
          await this.player.close().catch(() => {});
        }
        await this.mixer.disableSafely();
      }
    }
  }

  async _pauseRemote() {
    if (!this.player.child || this.state !== 'playing') return;
    this.transition = 'pause';
    try {
      await this.player.setPaused(true);
      const sample = await this.player.sample();
      this.positionSamples = sample.position;
      this.state = 'paused';
    } finally {
      this.transition = null;
    }
  }

  async _startRemoteIfForeground() {
    this.foreground.assertAllowed();
    this.transition = 'play';
    try {
      await this.player.setPaused(false);
      try {
        // The foreground may change while mpg123 acknowledges PAUSE. Re-check
        // before the caller can commit state=playing.
        this.foreground.assertAllowed();
      } catch (error) {
        this.transition = 'foreground-pause';
        try {
          await this.player.setPaused(true);
        } catch {
          this.playerLoadedPath = null;
          await this.player.close().catch(() => {});
        }
        throw error;
      }
    } finally {
      this.transition = null;
    }
  }

  async _pauseAndUnmix(reason) {
    try {
      await this._pauseRemote();
    } catch (error) {
      log('pause during ' + reason + ' failed: ' + error.message);
      await this.player.close().catch(() => {});
    } finally {
      this.leaseDeadline = 0;
      this.continuousPlaybackDeadline = 0;
      this._endScreensaverSession();
      await this.mixer.disableSafely();
    }
  }

  async pause(payload) {
    this._assertVideoSession(payload);
    await this._pauseAndUnmix('pause');
    if (this.cache && this.state !== 'error') this.state = 'paused';
    return this.status();
  }

  async seek(payload) {
    this._assertVideoSession(payload);
    await this._ensurePlayerLoaded();
    const playbackRate = requestedPlaybackRate(payload, this.playbackRate);
    const wasPlaying = this.state === 'playing';
    const shouldResume =
      payload && hasOwn(payload, 'resume')
        ? Boolean(payload.resume)
        : wasPlaying;
    try {
      if (wasPlaying) await this._pauseRemote();
      if (playbackRate !== this.playbackRate) {
        await this._applyPlaybackRate(playbackRate);
      }
      if (shouldResume) {
        this.foreground.assertAllowed();
        const mixerNeedsSettle = !this.mixer.enabled;
        await this.mixer.set(true);
        if (mixerNeedsSettle) await waitMs(MIX_SETTLE_MS);
      }
      const position = adjustedPosition(
        shouldResume
          ? payload || {}
          : { position: payload && payload.position },
        this.playbackRate
      );
      const target = clamp(
        Math.round(position * this.rate),
        0,
        Math.max(0, this.totalSamples - 1)
      );
      this.positionSamples = await this.player.seekSamples(target);
      this.state = 'paused';
      if (shouldResume) {
        await this._startRemoteIfForeground();
        this.state = 'playing';
        this.lastProgressAt = Date.now();
        if (!wasPlaying || !this.continuousPlaybackDeadline) {
          this.continuousPlaybackDeadline =
            Date.now() + MAX_CONTINUOUS_PLAYBACK_MS;
        }
        this._renewLease(payload);
        this._startOrRefreshScreensaverSession(wasPlaying);
      } else {
        this._endScreensaverSession();
        await this.mixer.disableSafely();
      }
      return this.status();
    } catch (error) {
      this.transition = null;
      this.state = 'paused';
      this._endScreensaverSession();
      if (wasPlaying) {
        this.playerLoadedPath = null;
        await this.player.close().catch(() => {});
      }
      await this.mixer.disableSafely();
      throw error;
    }
  }

  async stop(payload) {
    this._assertVideoSession(payload);
    let result;
    try {
      if (this.player.child) {
        this.transition = 'stop';
        await this.player.stop();
        this.playerLoadedPath = null;
      }
      this.positionSamples = 0;
      this.state = this.cache ? 'ready' : 'idle';
    } finally {
      this.transition = null;
      this.leaseDeadline = 0;
      this.continuousPlaybackDeadline = 0;
      this._endScreensaverSession();
      await this.mixer.disableSafely();
    }
    result = this.status();
    return result;
  }

  async setVolume(payload) {
    this._assertVideoSession(payload);
    const volume = requestedVolume(payload, this.volume);
    if (
      this.player.child &&
      this.playerLoadedPath === (this.cache && this.cache.path)
    ) {
      this.volume = await this.player.setVolume(volume);
    } else {
      this.volume = volume;
    }
    return this.status();
  }

  heartbeat(payload) {
    this._assertVideoSession(payload);
    this.foreground.assertAllowed();
    if (this.state !== 'playing')
      throw new ServiceError('audio is not playing', 409);
    this._renewLease(payload || {});
    this.lastControllerHeartbeatAt = Date.now();
    this._maybeRefreshScreensaver(this.lastControllerHeartbeatAt);
    return this.status();
  }

  _onPlayerLine(line) {
    const progress = line.match(/^@F \d+ \d+ ([0-9.]+) ([0-9.]+)$/);
    if (progress && this.rate) {
      this.positionSamples = Math.round(Number(progress[1]) * this.rate);
      this.lastProgressAt = Date.now();
      return;
    }
    if (line === '@P 1' && this.state === 'playing' && !this.transition) {
      this.positionSamples = this.totalSamples;
      this.state = 'ended';
      this.leaseDeadline = 0;
      this.continuousPlaybackDeadline = 0;
      this._endScreensaverSession();
      this.enqueue(() => this.mixer.disableSafely()).catch(() => {});
    }
  }

  _onPlayerExit(event) {
    this.playerLoadedPath = null;
    this._endScreensaverSession();
    if (this.closed) return;
    if (!event.expected) {
      this.lastError = 'mpg123 exited unexpectedly';
      this.state = this.cache ? 'ready' : 'error';
      log(this.lastError);
    }
    this.enqueue(() => this.mixer.disableSafely()).catch(() => {});
  }

  _watchdog() {
    if (this.closed || this.state !== 'playing' || this.watchdogBusy) return;
    const now = Date.now();
    this._maybeRefreshScreensaver(now);
    let reason = null;
    if (this.leaseDeadline && now > this.leaseDeadline)
      reason = 'controller lease expired';
    else if (
      this.continuousPlaybackDeadline &&
      now > this.continuousPlaybackDeadline
    ) {
      reason = 'continuous playback limit reached';
    }
    this.watchdogBusy = true;
    this.enqueue(async () => {
      try {
        if (reason) {
          log(reason + '; pausing translated audio');
          await this._pauseAndUnmix(reason);
          return;
        }
        if (Date.now() - this.lastProgressAt > PLAYER_STALL_MS) {
          const sample = await this.player.sample();
          if (sample.position <= this.positionSamples) {
            throw new ServiceError(
              'mpg123 playback stopped making progress',
              502
            );
          }
          this.positionSamples = sample.position;
          this.lastProgressAt = Date.now();
        }
      } catch (error) {
        this.lastError = error.message;
        this.state = this.cache ? 'paused' : 'error';
        await this.player.close().catch(() => {});
        await this.mixer.disableSafely();
      } finally {
        this.watchdogBusy = false;
      }
    }).catch(() => {
      this.watchdogBusy = false;
    });
  }

  status() {
    return {
      ok: true,
      service: 'vot-audio',
      ready: this.initialized,
      state: this.state,
      videoId: this.videoId,
      loaded: Boolean(this.cache),
      bytes: this.cache ? this.cache.bytes : 0,
      audioId: this.cache ? this.cache.sha256.slice(0, 16) : null,
      rate: this.rate || null,
      channels: this.channels || null,
      position: this.rate ? this.positionSamples / this.rate : 0,
      duration: this.rate ? this.totalSamples / this.rate : 0,
      playerPid: this.player.child ? this.player.child.pid : null,
      playbackRate: this.playbackRate,
      outputModule: this.player.output || null,
      outputDevice: this.player.device || null,
      mixEnabled: Boolean(this.mixer.enabled),
      mixerBackend: this.mixer.backend || null,
      volume: this.volume,
      leaseRemainingMs:
        this.state === 'playing'
          ? Math.max(0, this.leaseDeadline - Date.now())
          : 0,
      screensaverLeaseRemainingMs:
        this.state === 'playing'
          ? Math.max(0, this.screensaverSessionDeadline - Date.now())
          : 0,
      foregroundKnown: this.foreground.known,
      foregroundAllowed: this.foreground.allowed,
      foregroundAppIds: this.foreground.appIds.slice(),
      lastError: this.lastError
    };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.initialized = false;
    clearInterval(this.watchdog);
    this.foreground.close();
    this._endScreensaverSession();
    this.cancelDownload('service is shutting down');
    await this.queue.catch(() => {});
    try {
      await this.player.close();
    } finally {
      await this.mixer.disableSafely();
      if (this.cache) await fs.promises.unlink(this.cache.path).catch(() => {});
      this.cache = null;
    }
  }
}

function isLoopbackRequest(req) {
  const address = String(req.socket.remoteAddress || '').split('%')[0];
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}

function sendJson(res, statusCode, value, origin) {
  const body = Buffer.from(JSON.stringify(value));
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  res.writeHead(statusCode, headers);
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        failed = true;
        reject(new ServiceError('request body is too large', 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new ServiceError('invalid JSON body', 400));
      }
    });
    req.on('error', (error) => {
      if (!failed) reject(error);
    });
  });
}

function createServer(audio) {
  return http.createServer(async (req, res) => {
    const origin = String(req.headers.origin || '');
    if (!isLoopbackRequest(req)) {
      sendJson(res, 403, { ok: false, error: 'loopback clients only' });
      return;
    }
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      sendJson(res, 403, { ok: false, error: 'origin is not allowed' });
      return;
    }
    const pathname = String(req.url || '').split('?')[0];
    if (req.method === 'OPTIONS' && pathname.startsWith('/v1/')) {
      if (!origin) {
        sendJson(res, 400, { ok: false, error: 'CORS origin is required' });
        return;
      }
      res.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin'
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(
        res,
        audio.initialized ? 200 : 503,
        {
          ok: Boolean(audio.initialized),
          service: 'vot-audio',
          ready: Boolean(audio.initialized)
        },
        origin
      );
      return;
    }
    if (!audio.initialized) {
      sendJson(
        res,
        503,
        { ok: false, error: 'audio service is starting' },
        origin
      );
      return;
    }
    if (req.method === 'GET' && pathname === '/v1/status') {
      sendJson(res, 200, audio.status(), origin);
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 404, { ok: false, error: 'not found' }, origin);
      return;
    }
    const contentType = String(req.headers['content-type'] || '')
      .split(';')[0]
      .trim();
    if (contentType !== 'application/json') {
      sendJson(
        res,
        415,
        { ok: false, error: 'application/json is required' },
        origin
      );
      return;
    }

    try {
      const payload = await readJson(req);
      let result;
      if (pathname === '/v1/load') {
        audio.cancelDownload('superseded by a new load');
        result = await audio.enqueue(() => audio.load(payload));
      } else if (pathname === '/v1/play') {
        result = await audio.enqueue(() => audio.play(payload));
      } else if (pathname === '/v1/pause') {
        result = await audio.enqueue(() => audio.pause(payload));
      } else if (pathname === '/v1/seek') {
        result = await audio.enqueue(() => audio.seek(payload));
      } else if (pathname === '/v1/stop') {
        if (audio.isStaleVideoSession(payload)) {
          result = audio.status();
        } else {
          audio.cancelDownload('stopped by controller');
          result = await audio.enqueue(() => audio.stop(payload));
        }
      } else if (pathname === '/v1/volume') {
        result = await audio.enqueue(() => audio.setVolume(payload));
      } else if (pathname === '/v1/heartbeat') {
        result = await audio.enqueue(() => audio.heartbeat(payload));
      } else {
        sendJson(res, 404, { ok: false, error: 'not found' }, origin);
        return;
      }
      sendJson(res, 200, result, origin);
    } catch (error) {
      const statusCode = error instanceof ServiceError ? error.statusCode : 500;
      if (statusCode >= 500) log(pathname + ' failed: ' + error.message);
      sendJson(
        res,
        statusCode,
        {
          ok: false,
          error:
            statusCode >= 500 ? 'audio service operation failed' : error.message
        },
        origin
      );
    }
  });
}

async function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

async function main() {
  const audio = new AudioService();
  const server = createServer(audio);
  await listen(server, PORT, HOST);
  try {
    await audio.initialize();
  } catch (error) {
    server.close();
    throw error;
  }
  log('listening on http://' + HOST + ':' + String(PORT));

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('received ' + signal + ', shutting down');
    const hardExit = setTimeout(() => process.exit(1), 8000);
    hardExit.unref();
    server.close();
    try {
      await audio.close();
      clearTimeout(hardExit);
      process.exit(0);
    } catch (error) {
      log('shutdown cleanup failed: ' + error.message);
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (error) => {
    log('uncaught exception: ' + error.message);
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (error) => {
    log(
      'unhandled rejection: ' +
        String(error && error.message ? error.message : error)
    );
    shutdown('unhandledRejection');
  });
}

if (require.main === module) {
  main().catch((error) => {
    log('fatal startup error: ' + error.message);
    process.exit(1);
  });
}

module.exports = {
  ALLOWED_AUDIO_HOSTS,
  AudioDownloader,
  AudioService,
  DigitalMixer,
  Mpg123Remote,
  ForegroundAppGuard,
  ScreensaverActivityLease,
  ServiceError,
  adjustedPosition,
  collectForegroundAppIds,
  createJsonObjectParser,
  createServer,
  isPublicAddress,
  isPublicIPv4,
  isPublicIPv6,
  looksLikeMp3,
  lunaSubscriptionSpawn,
  parseIPv6,
  parseLunaJsonResponse,
  requestedPlaybackRate,
  resolvePublicHost,
  validateAudioUrl
};
