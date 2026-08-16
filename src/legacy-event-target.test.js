import assert from 'node:assert/strict';
import test from 'node:test';

import { createCustomEventTargetConstructor } from './legacy-event-target.js';

test('uses a constructible native EventTarget without replacing it', () => {
  class NativeEventTarget {
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {}
  }

  assert.equal(
    createCustomEventTargetConstructor(NativeEventTarget),
    NativeEventTarget
  );
});

test('falls back when the legacy native constructor is illegal', () => {
  function IllegalEventTarget() {
    throw new TypeError('Illegal constructor');
  }

  const EventBus = createCustomEventTargetConstructor(IllegalEventTarget);
  const bus = new EventBus();
  const calls = [];
  const retained = (event) => {
    calls.push(`retained:${event.detail}`);
    event.preventDefault();
  };
  const once = { handleEvent: (event) => calls.push(`once:${event.detail}`) };
  bus.addEventListener('data', retained);
  bus.addEventListener('data', retained);
  bus.addEventListener('data', once, { once: true });

  assert.equal(
    bus.dispatchEvent(
      new CustomEvent('data', { detail: 'first', cancelable: true })
    ),
    false
  );
  assert.equal(
    bus.dispatchEvent(
      new CustomEvent('data', { detail: 'second', cancelable: true })
    ),
    false
  );
  bus.removeEventListener('data', retained);
  assert.deepEqual(calls, ['retained:first', 'once:first', 'retained:second']);
});
