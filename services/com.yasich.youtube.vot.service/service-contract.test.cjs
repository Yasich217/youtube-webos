'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const serviceDir = path.join(
  process.cwd(),
  'services/com.yasich.youtube.vot.service'
);
const read = (name) => fs.readFileSync(path.join(serviceDir, name), 'utf8');

test('private runtime launchers discard inherited dynamic-loader variables', () => {
  for (const name of ['vot-node.sh', 'vot-mpg123.sh']) {
    const script = read(name);
    const unsetAt = script.indexOf('unset LD_PRELOAD LD_LIBRARY_PATH');
    const execAt = script.indexOf('exec "$LOADER"');
    assert.notEqual(unsetAt, -1, `${name} must sanitize LD_*`);
    assert.ok(unsetAt < execAt, `${name} must sanitize before private loader`);
  }
});

test('init stop allows audio cleanup then escalates only revalidated processes', () => {
  const script = read('310-youtube-vot');
  const grace = Number(script.match(/^STOP_GRACE_SECONDS=(\d+)$/m)?.[1] || 0);
  assert.ok(grace >= 10, 'grace must exceed the eight-second audio hard exit');
  assert.match(script, /is_expected_service_process/);
  assert.match(script, /signal_expected_processes "\$name" KILL/);
  assert.match(script, /could not stop VOT runner and children/);
  assert.match(script, /refusing duplicate VOT runner/);
  assert.doesNotMatch(script, /\[ -f "\$pid_file" \] \|\| return 0/);
});

test('init stop finds a matching process when its PID file is absent', async () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'vot-init-contract-')
  );
  const temporaryService = path.join(temporaryRoot, 'service');
  const temporaryRuntime = path.join(temporaryRoot, 'run');
  const temporaryProc = path.join(temporaryRoot, 'proc');
  const temporaryInit = path.join(temporaryRoot, '310-youtube-vot');
  fs.mkdirSync(temporaryService, { mode: 0o700 });
  const initSource = read('310-youtube-vot')
    .replace(
      'BASE_DIR="/home/root/local-patches/vot/service"',
      `BASE_DIR="${temporaryService}"`
    )
    .replace(
      'RUNTIME_DIR="/run/youtube-vot"',
      `RUNTIME_DIR="${temporaryRuntime}"`
    );
  fs.writeFileSync(temporaryInit, initSource, { mode: 0o700 });

  const runnerName = path.join(temporaryService, 'vot-runner.sh');
  fs.writeFileSync(
    runnerName,
    '#!/bin/sh\ntrap "exit 0" TERM INT\nwhile :; do sleep 1; done\n',
    { mode: 0o700 }
  );
  const child = spawn(runnerName, ['vot-audio'], { stdio: 'ignore' });

  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    fs.mkdirSync(temporaryProc, { mode: 0o700 });
    fs.symlinkSync(
      `/proc/${child.pid}`,
      path.join(temporaryProc, String(child.pid))
    );
    assert.equal(
      fs.existsSync(path.join(temporaryRuntime, 'vot-audio-runner.pid')),
      false
    );
    const stopped = spawnSync('/bin/sh', [temporaryInit, 'stop'], {
      encoding: 'utf8',
      env: { ...process.env, VOT_PROC_ROOT: temporaryProc },
      timeout: 15_000
    });
    assert.equal(
      stopped.status,
      0,
      JSON.stringify({
        error: stopped.error?.message,
        signal: stopped.signal,
        stderr: stopped.stderr,
        stdout: stopped.stdout
      })
    );
    if (child.exitCode === null) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('matching process was not reaped')),
          2_000
        );
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    assert.equal(child.exitCode, 0);
  } finally {
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {
      // The expected stop path already reaped it.
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('installer marks, cleans and bounds failed deployment artifacts', () => {
  const local = read('install-webos.sh');
  const remote = read('install-remote.sh');
  assert.match(local, /\.vot-stage/);
  assert.match(local, /trap cleanup_remote_stage 0 HUP INT TERM/);
  assert.match(remote, /prune_rollbacks/);
  assert.match(remote, /\[ -f "\$STAGING_DIR\/\.vot-stage" \]/);
  assert.match(remote, /rm -rf "\$STAGING_DIR"/);
});

test('deployment is serialized and runtime provenance is pinned twice', () => {
  const local = read('install-webos.sh');
  const remote = read('install-remote.sh');
  const digest = read('runtime/entware-armv7sf-runtime.sha256').trim();
  assert.match(digest, /^[a-f0-9]{64}\x20{2}c9-vot-runtime-armv7sf\.tar\.gz$/);
  assert.match(remote, /mkdir -m 700 "\$DEPLOY_LOCK"/);
  assert.match(remote, /reclaim_stale_deploy_lock/);
  assert.match(remote, /mkdir -m 700 "\$DEPLOY_LOCK\/reclaim"/);
  assert.match(remote, /deploy_lock_owner_is_active/);
  assert.match(remote, /another or unsafe VOT deployment lock exists/);
  assert.match(remote, /release_deploy_lock/);
  assert.match(remote, /"\$STAGING_DIR\/service\/310-youtube-vot" stop/);
  assert.match(local, /RUNTIME_SHA.*PINNED_RUNTIME_SHA/s);
  assert.match(remote, /actual_runtime_sha.*pinned_runtime_sha/s);
  assert.match(
    remote,
    /cmp "\$STAGING_DIR\/runtime\/VOT_RUNTIME_MANIFEST\.tsv"/
  );
});
