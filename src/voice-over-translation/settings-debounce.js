export const LANGUAGE_SETTINGS_DEBOUNCE_MS = 2_500;

/**
 * Debounces only the expensive translation restart. Config/UI writes remain
 * synchronous; the first change immediately tears down the stale session.
 */
export class TranslationSettingsDebounce {
  #timer = null;
  #setTimeout;
  #clearTimeout;
  #onFirstChange;
  #onSettled;
  #delayMs;

  constructor({
    onFirstChange,
    onSettled,
    delayMs = LANGUAGE_SETTINGS_DEBOUNCE_MS,
    // Chromium 53 requires Window timer functions to be called without an
    // arbitrary object receiver. Wrappers keep the native lookup/call in its
    // original global environment even though these callbacks are stored in
    // private fields and later invoked as instance methods.
    setTimeoutFn = (callback, delay) => setTimeout(callback, delay),
    clearTimeoutFn = (handle) => clearTimeout(handle)
  }) {
    this.#onFirstChange = onFirstChange;
    this.#onSettled = onSettled;
    this.#delayMs = delayMs;
    this.#setTimeout = setTimeoutFn;
    this.#clearTimeout = clearTimeoutFn;
  }

  change() {
    if (this.#timer === null) this.#onFirstChange();
    else this.#clearTimeout(this.#timer);

    this.#timer = this.#setTimeout(() => {
      this.#timer = null;
      this.#onSettled();
    }, this.#delayMs);
  }

  clear() {
    if (this.#timer === null) return;
    this.#clearTimeout(this.#timer);
    this.#timer = null;
  }

  get pending() {
    return this.#timer !== null;
  }
}
