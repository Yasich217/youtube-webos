/**
 * Legacy webOS (Chrome 38 / webOS 3 and Chrome 53 / webOS 4) polyfills.
 *
 * Imported at the top of utils.js, which every feature module imports, so the
 * guarantee is explicit rather than dependent on import order in userScript.js.
 * Feature modules may therefore use Element#matches, Element#closest and
 * Node#isConnected directly instead of carrying private fallback chains.
 */

// core-js normally supplies this while compiling third-party modules, but it
// must also exist before those modules are evaluated. webOS 4's Chromium 53
// predates the globalThis name.
if (typeof globalThis === 'undefined' && typeof window !== 'undefined') {
  window.globalThis = window;
}

/** Install the language methods still referenced by the legacy bundle. */
export function installLegacyLanguageSupport(target) {
  if (!target) return;

  // @vot.js/shared constructs an encoder while its module is evaluated. Some
  // WAM versions expose a function-shaped TextEncoder which itself throws
  // "Illegal constructor", so check actual UTF-8 output before trusting it.
  let encoderUsable = false;
  if (typeof target.TextEncoder === 'function') {
    try {
      const bytes = new target.TextEncoder().encode('\u2713');
      encoderUsable =
        bytes?.length === 3 &&
        bytes[0] === 0xe2 &&
        bytes[1] === 0x9c &&
        bytes[2] === 0x93;
    } catch {
      encoderUsable = false;
    }
  }
  if (!encoderUsable) {
    function LegacyTextEncoder() {}
    Object.defineProperty(LegacyTextEncoder, '__ytafPolyfill', {
      value: true
    });
    LegacyTextEncoder.prototype.encoding = 'utf-8';
    LegacyTextEncoder.prototype.encode = function (input) {
      const value = input === undefined ? '' : String(input);
      const bytes = [];
      for (let index = 0; index < value.length; index += 1) {
        let point = value.charCodeAt(index);
        if (point >= 0xd800 && point <= 0xdbff) {
          const trail = value.charCodeAt(index + 1);
          if (trail >= 0xdc00 && trail <= 0xdfff) {
            point = 0x10000 + ((point - 0xd800) << 10) + (trail - 0xdc00);
            index += 1;
          } else {
            point = 0xfffd;
          }
        } else if (point >= 0xdc00 && point <= 0xdfff) {
          point = 0xfffd;
        }

        if (point <= 0x7f) {
          bytes.push(point);
        } else if (point <= 0x7ff) {
          bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
        } else if (point <= 0xffff) {
          bytes.push(
            0xe0 | (point >> 12),
            0x80 | ((point >> 6) & 0x3f),
            0x80 | (point & 0x3f)
          );
        } else {
          bytes.push(
            0xf0 | (point >> 18),
            0x80 | ((point >> 12) & 0x3f),
            0x80 | ((point >> 6) & 0x3f),
            0x80 | (point & 0x3f)
          );
        }
      }
      return new target.Uint8Array(bytes);
    };
    target.TextEncoder = LegacyTextEncoder;
  }

  const ObjectConstructor = target.Object;
  if (ObjectConstructor && typeof ObjectConstructor.entries !== 'function') {
    ObjectConstructor.entries = function (value) {
      if (value === null || value === undefined) {
        throw new TypeError('Cannot convert undefined or null to object');
      }
      const object = ObjectConstructor(value);
      return ObjectConstructor.keys(object).map((key) => [key, object[key]]);
    };
  }
  if (ObjectConstructor && typeof ObjectConstructor.values !== 'function') {
    ObjectConstructor.values = function (value) {
      if (value === null || value === undefined) {
        throw new TypeError('Cannot convert undefined or null to object');
      }
      const object = ObjectConstructor(value);
      return ObjectConstructor.keys(object).map((key) => object[key]);
    };
  }

  const ArrayConstructor = target.Array;
  if (
    ArrayConstructor &&
    typeof ArrayConstructor.prototype.includes !== 'function'
  ) {
    ArrayConstructor.prototype.includes = function (search, fromIndex) {
      const value = Object(this);
      const length = Number(value.length) || 0;
      if (length <= 0) return false;
      let index = Number(fromIndex) || 0;
      if (index < 0) index = Math.max(length + index, 0);
      for (; index < length; index += 1) {
        const candidate = value[index];
        if (
          candidate === search ||
          (candidate !== candidate && search !== search)
        ) {
          return true;
        }
      }
      return false;
    };
  }

  const PromiseConstructor = target.Promise;
  if (
    PromiseConstructor &&
    typeof PromiseConstructor.prototype.finally !== 'function'
  ) {
    PromiseConstructor.prototype.finally = function (onFinally) {
      const callback =
        typeof onFinally === 'function' ? onFinally : function () {};
      const constructor = this.constructor || PromiseConstructor;
      return this.then(
        (value) => constructor.resolve(callback()).then(() => value),
        (reason) =>
          constructor.resolve(callback()).then(() => {
            throw reason;
          })
      );
    };
  }
}

function abortException(name, message) {
  if (typeof DOMException === 'function') {
    try {
      return new DOMException(message, name);
    } catch {
      // Fall through to the Error shape used by older WAM versions.
    }
  }
  const error = new Error(message);
  error.name = name;
  return error;
}

/**
 * Install the small Abort API subset used by VOT and make legacy fetch reject
 * promptly when that signal aborts. Chromium 53's native fetch does not know
 * the `signal` option, so the underlying request may finish in the background;
 * its result is deliberately ignored after the abort.
 *
 * Exported for a realm-isolated contract test. Calling this on a modern realm
 * is a no-op for the native controller and fetch implementation.
 */
export function installLegacyAbortSupport(target) {
  if (!target) return;

  const needsController =
    typeof target.AbortController !== 'function' ||
    typeof target.AbortSignal !== 'function';

  if (needsController) {
    function LegacyAbortSignal() {
      this.aborted = false;
      this.reason = undefined;
      this.onabort = null;
      this._listeners = [];
    }

    LegacyAbortSignal.prototype.addEventListener = function (
      type,
      listener,
      options
    ) {
      if (type !== 'abort' || typeof listener !== 'function') return;
      if (this._listeners.some((entry) => entry.listener === listener)) return;
      this._listeners.push({
        listener,
        once: Boolean(options && options.once)
      });
    };

    LegacyAbortSignal.prototype.removeEventListener = function (
      type,
      listener
    ) {
      if (type !== 'abort') return;
      this._listeners = this._listeners.filter(
        (entry) => entry.listener !== listener
      );
    };

    LegacyAbortSignal.prototype.dispatchEvent = function (event) {
      if (!event || event.type !== 'abort') return true;
      const listeners = this._listeners.slice();
      listeners.forEach((entry) => {
        try {
          entry.listener.call(this, event);
        } finally {
          if (entry.once) this.removeEventListener('abort', entry.listener);
        }
      });
      if (typeof this.onabort === 'function') this.onabort.call(this, event);
      return !event.defaultPrevented;
    };

    LegacyAbortSignal.prototype.throwIfAborted = function () {
      if (this.aborted) throw this.reason;
    };

    function LegacyAbortController() {
      this.signal = new LegacyAbortSignal();
    }

    LegacyAbortController.prototype.abort = function (reason) {
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      this.signal.reason =
        reason === undefined
          ? abortException('AbortError', 'The operation was aborted')
          : reason;
      this.signal.dispatchEvent({ type: 'abort', target: this.signal });
    };

    target.AbortSignal = LegacyAbortSignal;
    target.AbortController = LegacyAbortController;
  }

  if (typeof target.AbortSignal.timeout !== 'function') {
    target.AbortSignal.timeout = function (milliseconds) {
      const controller = new target.AbortController();
      const delay = Math.max(0, Number(milliseconds) || 0);
      target.setTimeout(() => {
        controller.abort(
          abortException('TimeoutError', 'The operation timed out')
        );
      }, delay);
      return controller.signal;
    };
  }

  if (
    needsController &&
    typeof target.fetch === 'function' &&
    !target.fetch.__ytafAbortAware
  ) {
    const nativeFetch = target.fetch;
    const abortAwareFetch = function (input, init) {
      const signal = init && init.signal;
      if (!signal) return nativeFetch.call(this, input, init);
      if (signal.aborted) return Promise.reject(signal.reason);

      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          callback(value);
        };
        const onAbort = () => finish(reject, signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(nativeFetch.call(this, input, init)).then(
          (value) => finish(resolve, value),
          (error) => finish(reject, error)
        );
      });
    };
    Object.defineProperty(abortAwareFetch, '__ytafAbortAware', {
      value: true
    });
    target.fetch = abortAwareFetch;
  }
}

const polyfillTarget =
  typeof window !== 'undefined'
    ? window
    : typeof globalThis !== 'undefined'
      ? globalThis
      : undefined;
installLegacyLanguageSupport(polyfillTarget);
installLegacyAbortSupport(polyfillTarget);

if (typeof Element !== 'undefined') {
  if (!Element.prototype.matches) {
    Element.prototype.matches =
      Element.prototype.webkitMatchesSelector ||
      Element.prototype.mozMatchesSelector ||
      Element.prototype.msMatchesSelector ||
      Element.prototype.oMatchesSelector;
  }

  if (!Element.prototype.closest) {
    Element.prototype.closest = function (s) {
      let el = this;
      do {
        if (Element.prototype.matches.call(el, s)) return el;
        el = el.parentElement || el.parentNode;
      } while (el !== null && el.nodeType === 1);
      return null;
    };
  }
}

if (typeof Node !== 'undefined' && !('isConnected' in Node.prototype)) {
  Object.defineProperty(Node.prototype, 'isConnected', {
    get: function () {
      return document.contains(this);
    },
    configurable: true,
    enumerable: true
  });
}
