import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import {
  installLegacyAbortSupport,
  installLegacyLanguageSupport
} from './polyfills.js';

function legacyRealm(fetchFn) {
  return {
    fetch: fetchFn,
    setTimeout,
    clearTimeout
  };
}

test('legacy AbortController rejects wrapped fetch on manual abort', async () => {
  let resolveNative;
  const realm = legacyRealm(
    () => new Promise((resolve) => (resolveNative = resolve))
  );
  installLegacyAbortSupport(realm);

  const controller = new realm.AbortController();
  const request = realm.fetch('/slow', { signal: controller.signal });
  controller.abort();

  await assert.rejects(request, (error) => error.name === 'AbortError');
  resolveNative({ ok: true });
});

test('legacy AbortSignal.timeout rejects fetch with TimeoutError', async () => {
  const realm = legacyRealm(() => new Promise(() => {}));
  installLegacyAbortSupport(realm);

  await assert.rejects(
    realm.fetch('/slow', { signal: realm.AbortSignal.timeout(5) }),
    (error) => error.name === 'TimeoutError'
  );
});

test('modern AbortController and fetch are not replaced', () => {
  function NativeController() {}
  function NativeSignal() {}
  NativeSignal.timeout = () => ({ native: true });
  const nativeFetch = () => Promise.resolve({ ok: true });
  const realm = {
    AbortController: NativeController,
    AbortSignal: NativeSignal,
    fetch: nativeFetch,
    setTimeout
  };

  installLegacyAbortSupport(realm);

  assert.equal(realm.AbortController, NativeController);
  assert.equal(realm.AbortSignal, NativeSignal);
  assert.equal(realm.fetch, nativeFetch);
});

test('legacy language methods cover entries, values, includes and finally', async () => {
  const realm = vm.runInNewContext('({ Object, Array, Promise, Uint8Array })');
  realm.Object.entries = undefined;
  realm.Object.values = undefined;
  realm.Array.prototype.includes = undefined;
  realm.Promise.prototype.finally = undefined;

  installLegacyLanguageSupport(realm);

  assert.equal(realm.TextEncoder.__ytafPolyfill, true);
  assert.deepEqual(
    Array.from(new realm.TextEncoder().encode('\u2713\ud83d\ude42\u042f')),
    [0xe2, 0x9c, 0x93, 0xf0, 0x9f, 0x99, 0x82, 0xd0, 0xaf]
  );
  assert.deepEqual(
    Array.from(new realm.TextEncoder().encode('\ud800A\udc00')),
    [0xef, 0xbf, 0xbd, 0x41, 0xef, 0xbf, 0xbd]
  );
  assert.deepEqual(
    Array.from(realm.Object.entries({ a: 1, b: 2 }), (entry) =>
      Array.from(entry)
    ),
    [
      ['a', 1],
      ['b', 2]
    ]
  );
  assert.deepEqual(Array.from(realm.Object.values({ a: 1, b: 2 })), [1, 2]);
  assert.throws(() => realm.Object.entries(null), TypeError);
  assert.equal(realm.Array.prototype.includes.call([1, Number.NaN], NaN), true);

  const calls = [];
  const fulfilled = await realm.Promise.resolve('ok').finally(() =>
    calls.push('fulfilled')
  );
  assert.equal(fulfilled, 'ok');
  await assert.rejects(
    realm.Promise.reject(new Error('expected')).finally(() =>
      calls.push('rejected')
    ),
    /expected/
  );
  assert.deepEqual(calls, ['fulfilled', 'rejected']);
});

test('non-constructible TextEncoder is replaced with a UTF-8 encoder', () => {
  function IllegalTextEncoder() {
    throw new TypeError('Illegal constructor');
  }
  const realm = {
    Object,
    Array,
    Promise,
    Uint8Array,
    TextEncoder: IllegalTextEncoder
  };

  installLegacyLanguageSupport(realm);

  assert.notEqual(realm.TextEncoder, IllegalTextEncoder);
  assert.deepEqual(
    Array.from(
      new realm.TextEncoder().encode('\u041f\u0440\u0438\u0432\u0435\u0442')
    ),
    Array.from(new TextEncoder().encode('\u041f\u0440\u0438\u0432\u0435\u0442'))
  );
});

test('modern language methods are not replaced', () => {
  const realm = {
    Object,
    Array,
    Promise,
    TextEncoder
  };
  const entries = Object.entries;
  const values = Object.values;
  const includes = Array.prototype.includes;
  const promiseFinally = Promise.prototype.finally;
  const textEncoder = TextEncoder;

  installLegacyLanguageSupport(realm);

  assert.equal(Object.entries, entries);
  assert.equal(Object.values, values);
  assert.equal(Array.prototype.includes, includes);
  assert.equal(Promise.prototype.finally, promiseFinally);
  assert.equal(realm.TextEncoder, textEncoder);
});
