/**
 * Return an EventTarget constructor that can safely be subclassed.
 *
 * Chromium 53 exposes window.EventTarget, but calling its constructor throws
 * "Illegal constructor". Replacing the global would break DOM instanceof
 * checks, so only our in-process event buses use this small fallback.
 */
export function createCustomEventTargetConstructor(NativeEventTarget) {
  if (typeof NativeEventTarget === 'function') {
    try {
      const probe = new NativeEventTarget();
      if (
        typeof probe.addEventListener === 'function' &&
        typeof probe.removeEventListener === 'function' &&
        typeof probe.dispatchEvent === 'function'
      ) {
        return NativeEventTarget;
      }
    } catch {
      // Use the private fallback below.
    }
  }

  function LegacyEventTarget() {
    this.__ytafListeners = Object.create(null);
  }

  LegacyEventTarget.prototype.addEventListener = function (
    type,
    callback,
    options
  ) {
    if (!callback) return;
    const name = String(type);
    const capture =
      typeof options === 'boolean' ? options : Boolean(options?.capture);
    const once = Boolean(
      typeof options === 'object' && options !== null && options.once
    );
    const listeners =
      this.__ytafListeners[name] || (this.__ytafListeners[name] = []);
    if (
      listeners.some(
        (entry) => entry.callback === callback && entry.capture === capture
      )
    ) {
      return;
    }
    listeners.push({ callback, capture, once });
  };

  LegacyEventTarget.prototype.removeEventListener = function (
    type,
    callback,
    options
  ) {
    const name = String(type);
    const listeners = this.__ytafListeners[name];
    if (!listeners || !callback) return;
    const capture =
      typeof options === 'boolean' ? options : Boolean(options?.capture);
    this.__ytafListeners[name] = listeners.filter(
      (entry) => entry.callback !== callback || entry.capture !== capture
    );
  };

  LegacyEventTarget.prototype.dispatchEvent = function (event) {
    if (!event || typeof event.type !== 'string') {
      throw new TypeError('Invalid event');
    }
    const listeners = (this.__ytafListeners[event.type] || []).slice();
    listeners.forEach((entry) => {
      if (entry.once) {
        this.removeEventListener(event.type, entry.callback, entry.capture);
      }
      if (typeof entry.callback === 'function') {
        entry.callback.call(this, event);
      } else if (typeof entry.callback.handleEvent === 'function') {
        entry.callback.handleEvent.call(entry.callback, event);
      }
    });
    return !event.defaultPrevented;
  };

  return LegacyEventTarget;
}
