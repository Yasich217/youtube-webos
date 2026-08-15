'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const test = require('node:test');

const {
  AUTH_STATE_HEADER,
  AUTH_STATE_INVALID,
  createServer
} = require('./vot-proxy.cjs');

const YOUTUBE_ORIGIN = 'https://www.youtube.com';
const TEST_TOKEN = 'definitely-not-a-real-yandex-token';

function fakeHttpsRequest(statusCode, responseBody, capture) {
  return (target, options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = (timeoutMs, handler) => {
      request.timeoutMs = timeoutMs;
      request.timeoutHandler = handler;
      return request;
    };
    request.destroy = (error) => {
      process.nextTick(() =>
        request.emit('error', error || new Error('closed'))
      );
    };
    request.end = (body) => {
      capture(target, options, body, request);
      process.nextTick(() => {
        const response = new Readable({ read() {} });
        response.statusCode = statusCode;
        response.headers = { 'content-type': 'application/json' };
        callback(response);
        response.push(responseBody);
        response.push(null);
      });
    };
    return request;
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function postProxy(port, headers, origin = YOUTUBE_ORIGIN) {
  const payload = Buffer.from(
    JSON.stringify({
      url: 'https://api.browser.yandex.ru/video-translation/translate',
      method: 'POST',
      headers,
      bodyBase64: Buffer.from('protobuf request').toString('base64')
    })
  );
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/v1/fetch',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'Content-Length': String(payload.length)
        }
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    request.on('error', reject);
    request.end(payload);
  });
}

function writeCredential(filename, token = TEST_TOKEN) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    filename,
    JSON.stringify({
      version: 1,
      provider: 'yandex',
      token,
      validatedAt: '2026-08-15T00:00:00.000Z',
      account: { id: '42' }
    }),
    { mode: 0o600 }
  );
}

for (const statusCode of [401, 403]) {
  test(`lively upstream ${statusCode} invalidates auth without exposing the token`, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vot-proxy-auth-'));
    const tokenFile = path.join(directory, 'secrets', 'yandex-oauth.json');
    writeCredential(tokenFile);
    let upstreamOptions;
    const server = createServer({
      tokenFile,
      requestFactory: fakeHttpsRequest(
        statusCode,
        JSON.stringify({ upstream: 'rejected' }),
        (_target, options) => {
          upstreamOptions = options;
        }
      )
    });
    const port = await listen(server);
    try {
      const response = await postProxy(
        port,
        {
          'X-Yasich-VOT-Lively': '1',
          Authorization: 'Bearer must-not-be-forwarded'
        },
        statusCode === 401 ? 'null' : YOUTUBE_ORIGIN
      );
      assert.equal(response.statusCode, statusCode);
      assert.equal(
        response.headers[AUTH_STATE_HEADER.toLowerCase()],
        AUTH_STATE_INVALID
      );
      assert.match(
        response.headers['access-control-expose-headers'],
        /X-Yasich-VOT-Auth-State/
      );
      assert.equal(
        upstreamOptions.headers.Authorization,
        'OAuth ' + TEST_TOKEN
      );
      assert.equal(fs.existsSync(tokenFile), false);
      assert.doesNotMatch(response.body, new RegExp(TEST_TOKEN));
      assert.deepEqual(JSON.parse(response.body), {
        error: 'Yandex authorization was rejected',
        code: 'VOT_YANDEX_AUTH_INVALID'
      });
    } finally {
      await close(server);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('unauthenticated upstream rejection does not invalidate stored auth', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vot-proxy-plain-'));
  const tokenFile = path.join(directory, 'secrets', 'yandex-oauth.json');
  writeCredential(tokenFile);
  let upstreamOptions;
  const server = createServer({
    tokenFile,
    requestFactory: fakeHttpsRequest(
      403,
      JSON.stringify({ upstream: 'standard request rejected' }),
      (_target, options) => {
        upstreamOptions = options;
      }
    )
  });
  const port = await listen(server);
  try {
    const response = await postProxy(port, {
      Authorization: 'Bearer must-not-be-forwarded'
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.headers[AUTH_STATE_HEADER.toLowerCase()], undefined);
    assert.equal(upstreamOptions.headers.Authorization, undefined);
    assert.equal(fs.existsSync(tokenFile), true);
  } finally {
    await close(server);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a rejected stale request cannot delete a newly paired credential', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vot-proxy-race-'));
  const tokenFile = path.join(directory, 'secrets', 'yandex-oauth.json');
  const replacementToken = 'newly-paired-not-a-real-yandex-token';
  writeCredential(tokenFile);
  const server = createServer({
    tokenFile,
    requestFactory: fakeHttpsRequest(
      401,
      JSON.stringify({ upstream: 'old token rejected' }),
      () => writeCredential(tokenFile, replacementToken)
    )
  });
  const port = await listen(server);
  try {
    const response = await postProxy(port, {
      'X-Yasich-VOT-Lively': '1'
    });
    assert.equal(response.statusCode, 401);
    assert.equal(
      response.headers[AUTH_STATE_HEADER.toLowerCase()],
      AUTH_STATE_INVALID
    );
    assert.equal(
      JSON.parse(fs.readFileSync(tokenFile, 'utf8')).token,
      replacementToken
    );
    assert.doesNotMatch(response.body, new RegExp(replacementToken));
  } finally {
    await close(server);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
