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
  PairingManager,
  PHONE_CSP,
  PHONE_HTML,
  isPrivateIpv4,
  selectLanAddress,
  startService,
  validateYandexToken,
  writeSecretAtomically
} = require('./vot-pairing.cjs');

const YOUTUBE_ORIGIN = 'https://www.youtube.com';

function request(options) {
  return new Promise((resolve, reject) => {
    const body = options.body == null ? null : Buffer.from(options.body);
    const headers = Object.assign({}, options.headers);
    if (body && headers['Content-Length'] == null) {
      headers['Content-Length'] = String(body.length);
    }
    const req = http.request(
      {
        host: options.host || '127.0.0.1',
        port: options.port,
        method: options.method || 'GET',
        path: options.path || '/',
        headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          let json = null;
          if (/application\/json/.test(String(res.headers['content-type']))) {
            json = JSON.parse(rawBody);
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: rawBody,
            json
          });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function postJson(port, requestPath, value, extraHeaders) {
  return request({
    port,
    method: 'POST',
    path: requestPath,
    headers: Object.assign(
      {
        Origin: YOUTUBE_ORIGIN,
        'Content-Type': 'application/json'
      },
      extraHeaders || {}
    ),
    body: JSON.stringify(value)
  });
}

function close(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(resolve);
  });
}

function fakeHttpsRequest(responseOptions, capture) {
  return (options, callback) => {
    const req = new EventEmitter();
    capture(options, req);
    req.setTimeout = (timeoutMs, handler) => {
      req.timeoutMs = timeoutMs;
      req.timeoutHandler = handler;
      return req;
    };
    req.destroy = (error) => {
      process.nextTick(() =>
        req.emit('error', error || new Error('destroyed'))
      );
    };
    req.end = () => {
      process.nextTick(() => {
        const response = new Readable({ read() {} });
        response.statusCode = responseOptions.statusCode;
        response.headers = responseOptions.headers || {};
        callback(response);
        if (responseOptions.body != null) response.push(responseOptions.body);
        response.push(null);
      });
    };
    return req;
  };
}

test('only RFC1918 IPv4 addresses are accepted and selection is deterministic', () => {
  ['10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.50.10'].forEach(
    (address) => {
      assert.equal(isPrivateIpv4(address), true, address);
    }
  );
  ['127.0.0.1', '169.254.1.2', '172.32.0.1', '100.64.0.1', '8.8.8.8'].forEach(
    (address) => {
      assert.equal(isPrivateIpv4(address), false, address);
    }
  );
  const interfaces = {
    zt0: [{ address: '10.0.0.9', family: 'IPv4', internal: false }],
    eth0: [{ address: '192.168.50.42', family: 'IPv4', internal: false }]
  };
  assert.equal(selectLanAddress(interfaces), '192.168.50.42');
  assert.equal(selectLanAddress(interfaces, '192.168.50.42'), '192.168.50.42');
  assert.throws(
    () => selectLanAddress(interfaces, '192.168.1.99'),
    /not assigned/
  );
});

test('credential storage is atomic and root-only', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vot-pair-secret-'));
  const filename = path.join(directory, 'secrets', 'yandex-oauth.json');
  try {
    writeSecretAtomically(filename, {
      version: 1,
      provider: 'yandex',
      token: 'definitely-not-a-real-token',
      validatedAt: '2026-08-15T00:00:00.000Z',
      account: { id: '42', login: 'test', displayName: 'Test' }
    });
    assert.equal(fs.statSync(path.dirname(filename)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
    const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
    assert.equal(value.provider, 'yandex');
    assert.equal(value.account.id, '42');
    assert.deepEqual(fs.readdirSync(path.dirname(filename)), [
      'yandex-oauth.json'
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('status observes credential invalidation performed by the proxy', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vot-pair-invalid-'));
  const filename = path.join(directory, 'secrets', 'yandex-oauth.json');
  try {
    writeSecretAtomically(filename, {
      version: 1,
      provider: 'yandex',
      token: 'definitely-not-a-real-token',
      validatedAt: '2026-08-15T00:00:00.000Z',
      account: { id: '42', login: 'test', displayName: 'Test' }
    });
    const manager = new PairingManager({ secretFile: filename });
    assert.equal(manager.status().valid, true);

    fs.unlinkSync(filename);
    const status = manager.status();
    assert.equal(status.configured, false);
    assert.equal(status.valid, false);
    assert.equal(status.account, null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Yandex validation pins the HTTPS target, refuses redirects and caps responses', async () => {
  let requestOptions;
  let requestObject;
  const account = await validateYandexToken('safe-test-token', {
    requestFactory: fakeHttpsRequest(
      {
        statusCode: 200,
        body: JSON.stringify({
          id: '7',
          login: 'tester',
          display_name: 'Tester'
        })
      },
      (options, req) => {
        requestOptions = options;
        requestObject = req;
      }
    )
  });
  assert.deepEqual(account, {
    id: '7',
    login: 'tester',
    displayName: 'Tester'
  });
  assert.equal(requestOptions.protocol, 'https:');
  assert.equal(requestOptions.hostname, 'login.yandex.ru');
  assert.equal(requestOptions.port, 443);
  assert.equal(requestOptions.path, '/info?format=json');
  assert.equal(requestOptions.method, 'GET');
  assert.equal(requestOptions.headers.Authorization, 'OAuth safe-test-token');
  assert.equal(requestObject.timeoutMs, 8000);

  await assert.rejects(
    validateYandexToken('safe-test-token', {
      requestFactory: fakeHttpsRequest(
        { statusCode: 302, headers: { location: 'https://evil.invalid/' } },
        () => {}
      )
    }),
    /validation failed/
  );
  await assert.rejects(
    validateYandexToken('safe-test-token', {
      maximumBytes: 8,
      requestFactory: fakeHttpsRequest(
        { statusCode: 200, body: '{"id":"response-is-too-long"}' },
        () => {}
      )
    }),
    /too large/
  );

  const hangingRequest = () => {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.end = () => {};
    req.destroy = (error) => process.nextTick(() => req.emit('error', error));
    return req;
  };
  await assert.rejects(
    validateYandexToken('safe-test-token', {
      timeoutMs: 5,
      requestFactory: hangingRequest
    }),
    /timed out/
  );
});

test('phone page uses a strict hashed CSP and erases the URL fragment', () => {
  assert.match(PHONE_CSP, /^default-src 'none'/);
  assert.match(PHONE_CSP, /script-src 'sha256-/);
  assert.match(PHONE_CSP, /style-src 'sha256-/);
  assert.doesNotMatch(PHONE_CSP, /unsafe-inline|unsafe-eval/);
  assert.match(PHONE_HTML, /history\.replaceState/);
  assert.match(PHONE_HTML, /X-VOT-Pairing/);
});

test('loopback API, temporary phone page and sanitized status complete pairing', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vot-pair-e2e-'));
  const secretFile = path.join(directory, 'secrets', 'yandex-oauth.json');
  const manager = new PairingManager({
    lanAddress: '127.0.0.1',
    allowLoopbackForTests: true,
    lanPort: 0,
    attemptIntervalMs: 0,
    secretFile,
    validator: async () => ({ id: '100', login: 'owner', displayName: 'Owner' })
  });
  const service = await startService({ manager, loopbackPort: 0 });
  const port = service.address.port;
  try {
    let response = await request({
      port,
      path: '/v1/auth/status',
      headers: { Origin: 'https://youtube.com.evil.invalid' }
    });
    assert.equal(response.statusCode, 403);

    response = await request({
      port,
      path: '/v1/auth/status',
      headers: { Origin: 'null' }
    });
    assert.equal(response.statusCode, 200);

    response = await request({
      port,
      path: '/v1/auth/status'
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json.configured, false);

    response = await request({
      port,
      path: '/v1/auth/status',
      headers: { Host: 'attacker.invalid' }
    });
    assert.equal(response.statusCode, 403);

    response = await request({
      port,
      method: 'POST',
      path: '/v1/auth/pair/cancel',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(response.statusCode, 403);

    response = await postJson(port, '/v1/auth/pair/start', {});
    assert.equal(response.statusCode, 200);
    assert.equal(response.json.ok, true);
    assert.match(response.json.pairing.code, /^\d{6}$/);
    assert.equal(response.json.pairing.attemptsRemaining, 5);
    const pairingUrl = new URL(response.json.pairing.url);
    const pairingSecret = pairingUrl.hash.slice(1);
    assert.equal(Buffer.from(pairingSecret, 'base64url').length, 32);

    const page = await request({
      port: Number(pairingUrl.port),
      path: pairingUrl.pathname + pairingUrl.search,
      headers: { Host: pairingUrl.host }
    });
    assert.equal(page.statusCode, 200);
    assert.equal(page.headers['cache-control'], 'no-store, max-age=0');
    assert.equal(page.headers['content-security-policy'], PHONE_CSP);
    assert.doesNotMatch(page.body, new RegExp(pairingSecret));

    const token = 'definitely-not-a-real-oauth-token';
    const phoneResponse = await request({
      port: Number(pairingUrl.port),
      method: 'POST',
      path: '/v1/pair',
      headers: {
        Host: pairingUrl.host,
        Origin: pairingUrl.origin,
        'Content-Type': 'application/json',
        'X-VOT-Pairing': pairingSecret
      },
      body: JSON.stringify({
        pairId: response.json.pairing.pairId,
        code: response.json.pairing.code,
        token
      })
    });
    assert.equal(phoneResponse.statusCode, 200);
    assert.equal(phoneResponse.json.ok, true);
    await new Promise((resolve) => setImmediate(resolve));

    const status = await request({
      port,
      path: '/v1/auth/status',
      headers: { Origin: YOUTUBE_ORIGIN }
    });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json.configured, true);
    assert.equal(status.json.valid, true);
    assert.equal(status.json.accountLabel, 'Owner');
    assert.equal(status.json.pairing, null);
    assert.doesNotMatch(status.body, new RegExp(token));
    assert.equal(JSON.parse(fs.readFileSync(secretFile, 'utf8')).token, token);
  } finally {
    manager.cancel();
    await close(service.server);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('pairing enforces exact phone Host/Origin, rate limiting and five attempts', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vot-pair-limit-'));
  let now = 1000;
  const manager = new PairingManager({
    lanAddress: '127.0.0.1',
    allowLoopbackForTests: true,
    lanPort: 0,
    now: () => now,
    attemptIntervalMs: 1000,
    secretFile: path.join(directory, 'secret.json'),
    validator: async () => {
      throw new Error('validator must not be reached');
    }
  });
  try {
    const started = await manager.start();
    const pairing = started.pairing;
    const pairingUrl = new URL(pairing.url);
    const baseHeaders = {
      Host: pairingUrl.host,
      Origin: pairingUrl.origin,
      'Content-Type': 'application/json',
      'X-VOT-Pairing': pairingUrl.hash.slice(1)
    };
    const invalid = JSON.stringify({
      pairId: pairing.pairId,
      code: '999999',
      token: 'definitely-not-a-real-token'
    });

    let response = await request({
      port: Number(pairingUrl.port),
      method: 'POST',
      path: '/v1/pair',
      headers: Object.assign({}, baseHeaders, { Host: '127.0.0.1:1' }),
      body: invalid
    });
    assert.equal(response.statusCode, 421);
    assert.equal(manager.status().pairing.attemptsRemaining, 5);

    response = await request({
      port: Number(pairingUrl.port),
      method: 'POST',
      path: '/v1/pair',
      headers: Object.assign({}, baseHeaders, {
        Origin: 'http://evil.invalid'
      }),
      body: invalid
    });
    assert.equal(response.statusCode, 403);
    assert.equal(manager.status().pairing.attemptsRemaining, 5);

    response = await request({
      port: Number(pairingUrl.port),
      method: 'POST',
      path: '/v1/pair',
      headers: baseHeaders,
      body: invalid
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json.attemptsRemaining, 4);

    response = await request({
      port: Number(pairingUrl.port),
      method: 'POST',
      path: '/v1/pair',
      headers: baseHeaders,
      body: invalid
    });
    assert.equal(response.statusCode, 429);
    assert.equal(response.headers['retry-after'], '1');
    assert.equal(manager.status().pairing.attemptsRemaining, 4);

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      now += 1000;
      // Sequential requests are required to exercise the session counter.
      // eslint-disable-next-line no-await-in-loop
      response = await request({
        port: Number(pairingUrl.port),
        method: 'POST',
        path: '/v1/pair',
        headers: baseHeaders,
        body: invalid
      });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json.attemptsRemaining, 5 - attempt);
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(manager.status().pairing, null);
  } finally {
    manager.cancel();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('phone submission body is capped at 4 KiB before token validation', async () => {
  const manager = new PairingManager({
    lanAddress: '127.0.0.1',
    allowLoopbackForTests: true,
    lanPort: 0,
    attemptIntervalMs: 0,
    secretFile: path.join(os.tmpdir(), 'nonexistent-vot-pairing-body-file'),
    validator: async () => {
      throw new Error('validator must not be reached');
    }
  });
  try {
    const pairing = (await manager.start()).pairing;
    const pairingUrl = new URL(pairing.url);
    const response = await request({
      port: Number(pairingUrl.port),
      method: 'POST',
      path: '/v1/pair',
      headers: {
        Host: pairingUrl.host,
        Origin: pairingUrl.origin,
        'Content-Type': 'application/json',
        'X-VOT-Pairing': pairingUrl.hash.slice(1)
      },
      body: JSON.stringify({
        pairId: pairing.pairId,
        code: pairing.code,
        token: 'x'.repeat(5000)
      })
    });
    assert.equal(response.statusCode, 413);
    assert.equal(response.json.attemptsRemaining, 4);
  } finally {
    manager.cancel();
  }
});

test('status expires the temporary listener after the bounded TTL', async () => {
  let now = 5000;
  const manager = new PairingManager({
    lanAddress: '127.0.0.1',
    allowLoopbackForTests: true,
    lanPort: 0,
    now: () => now,
    ttlMs: 180000,
    secretFile: path.join(os.tmpdir(), 'nonexistent-vot-pairing-file')
  });
  try {
    await manager.start();
    assert.ok(manager.status().pairing);
    now += 180000;
    assert.equal(manager.status().pairing, null);
  } finally {
    manager.cancel();
  }
});
