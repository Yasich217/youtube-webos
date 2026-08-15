'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const test = require('node:test');

const {
  AudioService,
  DigitalMixer,
  ForegroundAppGuard,
  Mpg123Remote,
  ScreensaverActivityLease,
  ServiceError,
  adjustedPosition,
  createServer,
  isPublicAddress,
  lunaSubscriptionSpawn,
  parseLunaJsonResponse,
  requestedPlaybackRate,
  resolvePublicHost,
  validateAudioUrl
} = require('./vot-audio.cjs');

function getJson(server, pathName, headers) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = http.get(
      {
        host: '127.0.0.1',
        port: address.port,
        path: pathName,
        headers: headers || {}
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            resolve({
              statusCode: response.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on('error', reject);
  });
}

test('health stays unavailable until audio initialization commits', async () => {
  const audio = {
    initialized: false,
    status: () => ({ ok: true, state: 'idle' })
  };
  const server = createServer(audio);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    let response = await getJson(server, '/health');
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.ready, false);

    audio.initialized = true;
    response = await getJson(server, '/health');
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ready, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('legacy WAM null Origin may call only the loopback audio API', async () => {
  const audio = {
    initialized: true,
    status: () => ({ ok: true, ready: true, state: 'idle' })
  };
  const server = createServer(audio);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const response = await getJson(server, '/v1/status', { Origin: 'null' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.state, 'idle');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Luna acknowledgement parser rejects silence and error envelopes', () => {
  assert.deepEqual(
    parseLunaJsonResponse(
      'terminal preface\r\n{\n  "returnValue": true\n}\r\n'
    ),
    { returnValue: true }
  );
  assert.throws(() => parseLunaJsonResponse(''), /no acknowledged JSON/);
  assert.throws(
    () =>
      parseLunaJsonResponse(
        '{"returnValue":false,"errorCode":-1,"errorText":"unknown"}'
      ),
    /Luna request rejected \(-1\)/
  );
});

test('digital mixer prefers modern backend and cleans it up symmetrically', async () => {
  const calls = [];
  const mixer = new DigitalMixer({
    request: async (settings) => {
      calls.push(settings);
      return { returnValue: true };
    }
  });

  await mixer.set(true);
  await mixer.disableSafely();

  assert.equal(mixer.backend, 'modern');
  assert.equal(mixer.enabled, false);
  assert.match(calls[0].uri, /mixDigitalSoundOutput$/);
  assert.deepEqual(calls[0].payload, {
    mix: true,
    callerId: 'com.yasich.votd'
  });
  assert.match(calls[1].uri, /mixDigitalSoundOutput$/);
  assert.equal(calls[1].payload.mix, false);
});

test('digital mixer falls back to legacy mix/unmix with YouTube requestApp', async () => {
  const calls = [];
  const mixer = new DigitalMixer({
    request: async (settings) => {
      calls.push(settings);
      if (/mixDigitalSoundOutput$/.test(settings.uri)) {
        throw new Error('unsupported');
      }
      return { returnValue: true };
    }
  });

  await mixer.set(true);
  await mixer.disableSafely();

  assert.equal(mixer.backend, 'legacy');
  assert.match(calls[1].uri, /mixDigitalSoundOutput$/);
  assert.equal(calls[1].payload.mix, false);
  assert.match(calls[2].uri, /mixDigitalAudioOut$/);
  assert.deepEqual(calls[2].payload, { requestApp: 'youtube.leanback.v4' });
  assert.match(calls[3].uri, /unmixDigitalAudioOut$/);
  assert.deepEqual(calls[3].payload, { requestApp: 'youtube.leanback.v4' });
});

test('unknown mixer state clears both backends even after the first ack', async () => {
  const calls = [];
  const mixer = new DigitalMixer({
    request: async (settings) => {
      calls.push(settings);
      return { returnValue: true };
    }
  });

  const acknowledgements = await mixer.disableSafely();

  assert.equal(mixer.backend, null);
  assert.equal(mixer.enabled, false);
  assert.deepEqual(acknowledgements, { modern: true, legacy: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].payload.mix, false);
  assert.match(calls[1].uri, /unmixDigitalAudioOut$/);
});

test('ambiguous modern enable is cleaned before legacy fallback', async () => {
  const calls = [];
  const mixer = new DigitalMixer({
    request: async (settings) => {
      calls.push(settings);
      if (/mixDigitalSoundOutput$/.test(settings.uri) && settings.payload.mix) {
        throw new Error('reply timed out');
      }
      return { returnValue: true };
    }
  });

  await mixer.set(true);

  assert.equal(mixer.backend, 'legacy');
  assert.equal(mixer.enabled, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].payload.mix, true);
  assert.equal(calls[1].payload.mix, false);
  assert.match(calls[2].uri, /mixDigitalAudioOut$/);
});

test('total mixer enable failure cleans both attempted backends', async () => {
  const calls = [];
  const mixer = new DigitalMixer({
    request: async (settings) => {
      calls.push(settings);
      const enablingModern =
        /mixDigitalSoundOutput$/.test(settings.uri) && settings.payload.mix;
      const enablingLegacy = /\/mixDigitalAudioOut$/.test(settings.uri);
      if (enablingModern || enablingLegacy) throw new Error('no reply');
      return { returnValue: true };
    }
  });

  await assert.rejects(mixer.set(true), /no reply/);

  assert.equal(mixer.backend, null);
  assert.equal(mixer.enabled, false);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].payload.mix, true);
  assert.equal(calls[1].payload.mix, false);
  assert.match(calls[2].uri, /mixDigitalAudioOut$/);
  assert.match(calls[3].uri, /unmixDigitalAudioOut$/);
});

test('remote start rolls back if YouTube leaves foreground during acknowledgement', async () => {
  const foreground = {
    known: true,
    allowed: true,
    appIds: ['youtube.leanback.v4'],
    assertAllowed() {
      if (!this.allowed) throw new ServiceError('not foreground', 409);
    },
    setOnDisallowed(callback) {
      this.onDisallowed = callback;
    },
    start() {},
    close() {}
  };
  const calls = [];
  const player = new EventEmitter();
  player.setPaused = async (paused) => {
    calls.push(paused);
    if (!paused) foreground.allowed = false;
    return true;
  };
  player.close = async () => {};
  const audio = new AudioService({
    player,
    foreground,
    mixer: { enabled: false, disableSafely: async () => {} },
    screensaver: { tryRefresh: () => false }
  });
  try {
    await assert.rejects(audio._startRemoteIfForeground(), /not foreground/);
    assert.deepEqual(calls, [false, true]);
    assert.equal(audio.transition, null);
  } finally {
    clearInterval(audio.watchdog);
  }
});

test('stale video commands cannot mutate the active audio session', async () => {
  const player = new EventEmitter();
  let pauseCalls = 0;
  let stopCalls = 0;
  player.child = { pid: 1234 };
  player.setPaused = async () => {
    pauseCalls += 1;
  };
  player.stop = async () => {
    stopCalls += 1;
  };
  const audio = new AudioService({
    player,
    foreground: {
      known: true,
      allowed: true,
      appIds: ['youtube.leanback.v4'],
      assertAllowed() {},
      setOnDisallowed() {},
      start() {},
      close() {}
    },
    mixer: { enabled: true, disableSafely: async () => {} },
    screensaver: { tryRefresh: () => false }
  });
  audio.videoId = 'newVideo123';
  audio.state = 'playing';
  try {
    await assert.rejects(
      audio.pause({ videoId: 'oldVideo123' }),
      (error) => error instanceof ServiceError && error.statusCode === 409
    );
    await assert.rejects(
      audio.stop({ videoId: 'oldVideo123' }),
      (error) => error instanceof ServiceError && error.statusCode === 409
    );
    assert.equal(pauseCalls, 0);
    assert.equal(stopCalls, 0);
    assert.equal(audio.status().videoId, 'newVideo123');
  } finally {
    clearInterval(audio.watchdog);
  }
});

test('foreground guard allows YouTube, ignores transient overlays and blocks Home', () => {
  const losses = [];
  const guard = new ForegroundAppGuard({
    onDisallowed: (appIds) => losses.push(appIds)
  });
  assert.throws(() => guard.assertAllowed(), /not the foreground/);
  guard.handlePayload({
    foregroundAppInfo: [{ appId: 'youtube.leanback.v4' }]
  });
  assert.equal(guard.known, true);
  assert.equal(guard.allowed, true);

  guard.handlePayload({
    foregroundAppInfo: [{ appId: 'com.webos.app.volume' }]
  });
  assert.equal(guard.allowed, true);

  guard.handlePayload({
    foregroundAppInfo: [{ appId: 'com.webos.app.home' }]
  });
  assert.equal(guard.allowed, false);
  assert.deepEqual(losses, [['com.webos.app.home']]);
  assert.throws(() => guard.assertAllowed(), /not the foreground/);

  guard.handlePayload({
    foregroundAppInfo: [
      { appId: 'youtube.leanback.v4' },
      { appId: 'com.webos.app.volume' }
    ]
  });
  assert.equal(guard.allowed, true);
  guard.close();
});

test('foreground guard seeds state with an acknowledged one-shot query', async () => {
  let requestSettings;
  const guard = new ForegroundAppGuard({
    request: async (settings) => {
      requestSettings = settings;
      return {
        returnValue: true,
        foregroundAppInfo: [{ appId: 'youtube.leanback.v4' }]
      };
    }
  });

  guard._refreshCurrent();
  await guard.initialQueryInFlight;

  assert.equal(requestSettings.uri.includes('getForegroundAppInfo'), true);
  assert.deepEqual(requestSettings.payload, {});
  assert.equal(guard.known, true);
  assert.equal(guard.allowed, true);
  guard.close();
});

test('foreground guard polling catches a C9 subscription that stays silent', async () => {
  let requests = 0;
  const losses = [];
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.kill = () => {
    child.exitCode = 0;
  };
  const guard = new ForegroundAppGuard({
    pollMs: 10,
    spawnFn: () => child,
    onDisallowed: (appIds) => losses.push(appIds),
    request: async () => {
      requests += 1;
      return {
        returnValue: true,
        foregroundAppInfo: [
          {
            appId:
              requests === 1
                ? 'youtube.leanback.v4'
                : 'org.webosbrew.hbchannel'
          }
        ]
      };
    }
  });

  guard.start();
  await new Promise((resolve) => setTimeout(resolve, 35));

  assert.ok(requests >= 2);
  assert.equal(guard.known, true);
  assert.equal(guard.allowed, false);
  assert.deepEqual(losses, [['org.webosbrew.hbchannel']]);
  guard.close();
});

test('foreground guard fails closed when its one-shot query fails', async () => {
  const losses = [];
  const guard = new ForegroundAppGuard({
    onDisallowed: (appIds) => losses.push(appIds),
    request: async () => {
      throw new Error('LS2 unavailable');
    }
  });
  guard.handlePayload({
    foregroundAppInfo: [{ appId: 'youtube.leanback.v4' }]
  });

  guard._refreshCurrent();
  await guard.initialQueryInFlight;

  assert.equal(guard.known, false);
  assert.equal(guard.allowed, false);
  assert.deepEqual(losses, [['foreground-monitor-unavailable']]);
  guard.close();
});

test('foreground guard fails closed on an acknowledged poll without app IDs', async () => {
  const losses = [];
  const guard = new ForegroundAppGuard({
    onDisallowed: (appIds) => losses.push(appIds),
    request: async () => ({ returnValue: true })
  });
  guard.handlePayload({
    foregroundAppInfo: [{ appId: 'youtube.leanback.v4' }]
  });

  guard._refreshCurrent();
  await guard.initialQueryInFlight;

  assert.equal(guard.known, false);
  assert.equal(guard.allowed, false);
  assert.deepEqual(losses, [['foreground-monitor-unavailable']]);
  guard.close();
});

test('foreground subscription uses a pseudo-TTY when available', () => {
  const launch = lunaSubscriptionSpawn(
    '/usr/bin/luna-send',
    'luna://example/getForegroundAppInfo',
    { subscribe: true },
    '/usr/bin/script'
  );
  assert.equal(launch.binary, '/usr/bin/script');
  assert.deepEqual(launch.args.slice(0, 3), ['-q', '-f', '-c']);
  assert.match(launch.args[3], /luna-send/);
  assert.match(launch.args[3], /'\{"subscribe":true\}'/);
  assert.equal(launch.args.at(-1), '/dev/null');

  assert.deepEqual(
    lunaSubscriptionSpawn('/usr/bin/luna-send', 'luna://example', {}, null),
    {
      binary: '/usr/bin/luna-send',
      args: ['-i', '-f', 'luna://example', '{}']
    }
  );
});

test('screensaver activity calls are rate-limited and use a bounded Luna call', async () => {
  let now = 1000;
  const calls = [];
  const lease = new ScreensaverActivityLease({
    now: () => now,
    minimumIntervalMs: 55 * 1000,
    timeoutMs: 3500,
    runner: async (binary, args, timeoutMs) =>
      calls.push({ binary, args, timeoutMs })
  });
  assert.equal(lease.tryRefresh(), true);
  await lease.inFlight;
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('-n'));
  assert.ok(calls[0].args.includes('-w'));
  assert.ok(
    calls[0].args.includes(
      'luna://com.webos.surfacemanager.screenSaver/restartUserActivityTimer'
    )
  );
  assert.equal(calls[0].args.at(-1), '{}');

  now += 30 * 1000;
  assert.equal(lease.tryRefresh(), false);
  now += 26 * 1000;
  assert.equal(lease.tryRefresh(), true);
  await lease.inFlight;
  assert.equal(calls.length, 2);
});

test('SSRF address filter rejects local and reserved ranges', () => {
  const rejected = [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.168.0.1',
    '198.18.0.1',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1'
  ];
  rejected.forEach((address) => {
    assert.equal(isPublicAddress(address), false, address);
  });
  ['8.8.8.8', '77.88.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8'].forEach(
    (address) => {
      assert.equal(isPublicAddress(address), true, address);
    }
  );
});

test('DNS validation rejects a hostname if any answer is private', async () => {
  const mixedLookup = (hostname, options, callback) => {
    callback(null, [
      { address: '77.88.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ]);
  };
  await assert.rejects(
    resolvePublicHost('vtrans.s3-private.mds.yandex.net', mixedLookup),
    /non-public/
  );
});

test('audio URL validation is an exact HTTPS host and MP3 allowlist', () => {
  const accepted = validateAudioUrl(
    'https://vtrans.s3-private.mds.yandex.net/tts/prod/track.mp3?X-Amz-Signature=secret'
  );
  assert.equal(accepted.hostname, 'vtrans.s3-private.mds.yandex.net');
  assert.throws(
    () =>
      validateAudioUrl(
        'http://vtrans.s3-private.mds.yandex.net/tts/prod/track.mp3'
      ),
    /HTTPS/
  );
  assert.throws(
    () =>
      validateAudioUrl(
        'https://vtrans.s3-private.mds.yandex.net.evil.test/track.mp3'
      ),
    /host/
  );
  assert.throws(
    () =>
      validateAudioUrl('https://vtrans.s3-private.mds.yandex.net/track.json'),
    /MP3/
  );
});

test('controller timestamp compensates only a bounded request transit time', () => {
  const now = Date.now();
  const near = adjustedPosition({ position: 10, clientTimestampMs: now - 250 });
  assert.ok(near >= 10.2 && near <= 10.4);
  assert.equal(
    adjustedPosition({ position: 10, clientTimestampMs: now - 60 * 1000 }),
    12
  );
  assert.equal(
    adjustedPosition({ position: 10, clientTimestampMs: now - 60 * 1000 }, 1.5),
    13
  );
});

test('playback rate accepts only the controller range', () => {
  assert.equal(requestedPlaybackRate({ playbackRate: 0.5 }, 1), 0.5);
  assert.equal(requestedPlaybackRate({ playbackRate: 2 }, 1), 2);
  assert.equal(requestedPlaybackRate({}, 1), 1);
  assert.throws(
    () => requestedPlaybackRate({ playbackRate: 0.49 }, 1),
    /0\.5 to 2/
  );
  assert.throws(
    () => requestedPlaybackRate({ playbackRate: 2.01 }, 1),
    /0\.5 to 2/
  );
});

test('mpg123 is pinned to the named ptts stereo s16 stream', () => {
  const player = new Mpg123Remote();
  assert.equal(player.device, 'ptts');
  assert.deepEqual(player.spawnArguments(), [
    '-q',
    '-R',
    '--remote-err',
    '--keep-open',
    '--name',
    'com.yasich.votd',
    '--stereo',
    '-e',
    's16',
    '--timeout',
    '10',
    '--devbuffer',
    '0.10',
    '-o',
    'pulse',
    '-a',
    'ptts'
  ]);
});

test('mpg123 remote replies must match a valid MP3 format, seek and pitch', async () => {
  const player = new Mpg123Remote();
  player.child = {
    exitCode: null,
    stdin: { writable: true, write: () => true }
  };

  let rejected = assert.rejects(player.format(), /output format/);
  player._handleLine('@FORMAT 22050 1');
  await rejected;

  const accepted = player.format();
  player._handleLine('@FORMAT 22050 2');
  assert.deepEqual(await accepted, { rate: 22050, channels: 2 });

  rejected = assert.rejects(player.seekSamples(22050), /seek mismatch/);
  player._handleLine('@K 22049');
  await rejected;

  rejected = assert.rejects(
    player.setPlaybackRate(1.25),
    /playback-rate mismatch/
  );
  player._handleLine('@PITCH 0.200000');
  await rejected;
});

function hasBinary(binary, versionArgs) {
  try {
    execFileSync(binary, versionArgs, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const canRunRemoteIntegration =
  hasBinary('/usr/bin/mpg123', ['--version']) &&
  hasBinary('ffmpeg', ['-version']);

test(
  'mpg123 remote mode loads paused, reports format, seeks by output sample and pauses',
  { skip: !canRunRemoteIntegration, timeout: 10 * 1000 },
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vot-audio-test-'));
    const audioPath = path.join(directory, 'tone.mp3');
    let player;
    try {
      execFileSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=2',
          '-ar',
          '22050',
          '-codec:a',
          'libmp3lame',
          '-q:a',
          '5',
          audioPath
        ],
        { stdio: 'ignore' }
      );
      player = new Mpg123Remote({
        binary: '/usr/bin/mpg123',
        output: 'sleep',
        device: null,
        deviceBufferSeconds: '0.02'
      });
      await player.start();
      await player.loadPaused(audioPath);
      const playbackRate = await player.setPlaybackRate(1.5);
      const volume = await player.setVolume(0.62);
      const format = await player.format();
      const initial = await player.sample();
      assert.equal(format.rate, 22050);
      assert.equal(format.channels, 2);
      assert.equal(playbackRate, 1.5);
      assert.equal(volume, 0.62);
      assert.equal(initial.position, 0);
      assert.ok(initial.length >= 44000 && initial.length <= 44200);

      const requested = Math.round(format.rate * 0.5);
      const actual = await player.seekSamples(requested);
      assert.equal(actual, requested);
      await player.setPaused(false);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await player.setPaused(true);
      const paused = await player.sample();
      assert.ok(paused.position > requested);
      assert.ok(paused.position < initial.length);
    } finally {
      if (player) await player.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
);
