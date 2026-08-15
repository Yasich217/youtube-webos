import QRCode from './vendor/qrcode-terminal/QRCode/index.cjs';
import QRErrorCorrectLevel from './vendor/qrcode-terminal/QRCode/QRErrorCorrectLevel.cjs';

import {
  PairingClientError,
  type PairingSession,
  type PairingStatus,
  votPairingClient
} from './pairing-client';

const DIALOG_ID = 'ytaf-vot-pairing-dialog';
const STYLE_ID = 'ytaf-vot-pairing-dialog-style';
const SUCCESS_VISIBLE_MS = 1_200;
const QR_QUIET_ZONE = 4;

const EMPTY_STATUS: PairingStatus = {
  configured: false,
  valid: false,
  accountLabel: null,
  state: 'idle',
  expiresAt: null
};

const DIALOG_CSS = `
#${DIALOG_ID} {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 5vh 5vw;
  color: #f7f7f7;
  background: rgba(0, 0, 0, 0.84);
  font-family: Roboto, Arial, sans-serif;
}
#${DIALOG_ID}, #${DIALOG_ID} * { box-sizing: border-box; }
#${DIALOG_ID} .ytaf-vot-pair-card {
  width: min(1120px, 90vw);
  min-height: 540px;
  padding: 42px 50px 36px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 22px;
  background: #171717;
  box-shadow: 0 26px 80px rgba(0, 0, 0, 0.7);
}
#${DIALOG_ID} .ytaf-vot-pair-title {
  margin: 0 0 28px;
  font-size: 38px;
  font-weight: 600;
  line-height: 1.18;
}
#${DIALOG_ID} .ytaf-vot-pair-content {
  min-height: 350px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
#${DIALOG_ID} .ytaf-vot-pair-columns {
  display: flex;
  align-items: center;
  gap: 46px;
}
#${DIALOG_ID} .ytaf-vot-pair-copy {
  flex: 1 1 auto;
  min-width: 0;
}
#${DIALOG_ID} .ytaf-vot-pair-copy p {
  margin: 0 0 18px;
  color: #d4d4d4;
  font-size: 25px;
  line-height: 1.42;
}
#${DIALOG_ID} .ytaf-vot-pair-copy .ytaf-vot-pair-note {
  color: #a8a8a8;
  font-size: 19px;
}
#${DIALOG_ID} .ytaf-vot-pair-qr {
  flex: 0 0 auto;
  width: 330px;
  height: 330px;
  padding: 13px;
  border-radius: 14px;
  background: #fff;
}
#${DIALOG_ID} .ytaf-vot-pair-qr svg {
  display: block;
  width: 100%;
  height: 100%;
}
#${DIALOG_ID} .ytaf-vot-pair-code-label {
  margin-top: 26px;
  color: #a8a8a8;
  font-size: 18px;
}
#${DIALOG_ID} .ytaf-vot-pair-code {
  margin-top: 5px;
  color: #fff;
  font-size: 38px;
  font-weight: 700;
  letter-spacing: 8px;
}
#${DIALOG_ID} .ytaf-vot-pair-countdown {
  margin-top: 18px;
  color: #bdbdbd;
  font-size: 21px;
}
#${DIALOG_ID} .ytaf-vot-pair-status-icon {
  width: 82px;
  height: 82px;
  margin-bottom: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: #2f7d32;
  font-size: 49px;
}
#${DIALOG_ID} .ytaf-vot-pair-status-icon.ytaf-vot-pair-error {
  background: #9d2626;
}
#${DIALOG_ID} .ytaf-vot-pair-spinner {
  width: 72px;
  height: 72px;
  margin-bottom: 30px;
  border: 7px solid rgba(255, 255, 255, 0.18);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ytaf-vot-pair-spin 1s linear infinite;
}
#${DIALOG_ID} .ytaf-vot-pair-message {
  margin: 0;
  color: #d4d4d4;
  font-size: 26px;
  line-height: 1.42;
}
#${DIALOG_ID} .ytaf-vot-pair-account {
  margin-top: 12px;
  color: #fff;
  font-size: 30px;
  font-weight: 600;
}
#${DIALOG_ID} .ytaf-vot-pair-actions {
  min-height: 68px;
  margin-top: 30px;
  display: flex;
  align-items: center;
  gap: 18px;
}
#${DIALOG_ID} .ytaf-vot-pair-button {
  min-width: 190px;
  height: 64px;
  padding: 0 28px;
  border: 3px solid transparent;
  border-radius: 12px;
  color: #f2f2f2;
  background: #363636;
  font: inherit;
  font-size: 23px;
  font-weight: 600;
  outline: none;
}
#${DIALOG_ID} .ytaf-vot-pair-button.ytaf-vot-pair-primary {
  color: #151515;
  background: #f1f1f1;
}
#${DIALOG_ID} .ytaf-vot-pair-button:focus {
  border-color: #35a7ff;
  box-shadow: 0 0 0 5px rgba(53, 167, 255, 0.34);
  transform: scale(1.035);
}
#${DIALOG_ID} .ytaf-vot-pair-hint {
  margin-top: 24px;
  color: #8d8d8d;
  font-size: 18px;
}
@keyframes ytaf-vot-pair-spin { to { transform: rotate(360deg); } }
`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = DIALOG_CSS;
  (document.head ?? document.documentElement).append(style);
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createQrCode(pairingUrl: string): SVGSVGElement {
  const qrCode = new QRCode(0, QRErrorCorrectLevel.M);
  qrCode.addData(pairingUrl);
  qrCode.make();

  const moduleCount = qrCode.getModuleCount();
  const imageSize = moduleCount + QR_QUIET_ZONE * 2;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${imageSize} ${imageSize}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Pairing QR code');
  svg.setAttribute('shape-rendering', 'crispEdges');

  const background = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'rect'
  );
  background.setAttribute('width', String(imageSize));
  background.setAttribute('height', String(imageSize));
  background.setAttribute('fill', '#fff');
  svg.append(background);

  let pathData = '';
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (!qrCode.isDark(row, column)) continue;
      const x = column + QR_QUIET_ZONE;
      const y = row + QR_QUIET_ZONE;
      pathData += `M${x} ${y}h1v1h-1z`;
    }
  }

  const modules = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'path'
  );
  modules.setAttribute('d', pathData);
  modules.setAttribute('fill', '#000');
  svg.append(modules);
  return svg;
}

function countdownText(expiresAt: number | null): string {
  if (expiresAt === null) return 'Pairing link is active for a short time';
  const remainingSeconds = Math.max(
    0,
    Math.ceil((expiresAt - Date.now()) / 1_000)
  );
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, '0');
  return `Link expires in ${minutes}:${seconds}`;
}

function cancelledStatus(status: PairingStatus): PairingStatus {
  if (status.valid) {
    return { ...status, state: 'paired', expiresAt: null };
  }
  return {
    configured: status.configured,
    valid: false,
    accountLabel: status.accountLabel,
    state: 'cancelled',
    expiresAt: null
  };
}

function userFacingError(error: unknown): string {
  if (!(error instanceof PairingClientError)) {
    return 'Could not start Yandex pairing';
  }
  switch (error.code) {
    case 'timeout':
      return 'The pairing service did not respond in time';
    case 'unavailable':
      return 'The pairing service is unavailable';
    case 'invalid-response':
      return 'The pairing service returned an invalid response';
    case 'request-failed':
      return error.status === 429
        ? 'Too many pairing attempts. Please wait and try again'
        : 'The pairing request was rejected';
    case 'cancelled':
      return 'Pairing was cancelled';
  }
}

class PairingDialog {
  readonly #root: HTMLDivElement;
  readonly #card: HTMLDivElement;
  readonly #previousFocus: HTMLElement | null;
  readonly #finishPromise: Promise<PairingStatus>;
  #finishResolver: ((status: PairingStatus) => void) | null = null;
  #operationController: AbortController | null = null;
  #session: PairingSession | null = null;
  #lastStatus: PairingStatus = EMPTY_STATUS;
  #countdownTimer: number | null = null;
  #successTimer: number | null = null;
  #closed = false;
  #generation = 0;

  constructor() {
    ensureStyles();
    this.#previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    this.#root = createElement('div');
    this.#root.id = DIALOG_ID;
    this.#root.setAttribute('role', 'dialog');
    this.#root.setAttribute('aria-modal', 'true');
    this.#root.setAttribute('aria-labelledby', `${DIALOG_ID}-title`);
    this.#card = createElement('div', 'ytaf-vot-pair-card');
    this.#root.append(this.#card);
    this.#finishPromise = new Promise((resolve) => {
      this.#finishResolver = resolve;
    });

    this.#root.addEventListener('click', this.#handleBackdropClick);
    window.addEventListener('keydown', this.#handleKeyDown, true);
    (document.body ?? document.documentElement).append(this.#root);
  }

  open(): Promise<PairingStatus> {
    this.#renderLoading('Checking Yandex live voices…');
    void this.#initialize();
    return this.#finishPromise;
  }

  async #initialize(): Promise<void> {
    const generation = ++this.#generation;
    this.#replaceOperationController();
    this.#renderLoading('Checking Yandex live voices…');
    try {
      const status = await votPairingClient.status(
        this.#operationController?.signal
      );
      if (!this.#isCurrent(generation)) return;
      this.#lastStatus = status;
      if (status.valid) this.#renderConnected(status);
      else await this.#startPairing();
    } catch (error) {
      if (!this.#isCurrent(generation) || this.#isCancelledError(error)) return;
      this.#renderError(userFacingError(error));
    }
  }

  async #startPairing(): Promise<void> {
    const previousStatus = this.#lastStatus;
    const previousSession = this.#session;
    this.#session = null;
    this.#clearTimers();
    this.#operationController?.abort();
    if (previousSession) {
      void votPairingClient.cancel(previousSession.id).catch(() => undefined);
    }

    const generation = ++this.#generation;
    this.#replaceOperationController();
    this.#renderLoading('Creating a local pairing link…');
    try {
      const session = await votPairingClient.start(
        this.#operationController?.signal
      );
      if (!this.#isCurrent(generation)) return;
      this.#session = session;
      this.#lastStatus = previousStatus.valid
        ? {
            ...previousStatus,
            state: 'waiting',
            expiresAt: session.status.expiresAt
          }
        : session.status;
      if (!this.#renderPairing(session)) return;
      this.#startCountdown(session, generation);

      const status = await votPairingClient.poll(session.id, {
        signal: this.#operationController?.signal,
        expiresAt: session.status.expiresAt,
        onStatus: (nextStatus) => {
          if (this.#isCurrent(generation)) this.#lastStatus = nextStatus;
        }
      });
      if (!this.#isCurrent(generation)) return;
      this.#lastStatus = status;
      if (status.valid) this.#renderSuccess(status);
      else if (status.state === 'expired') this.#renderExpired();
      else this.#renderError('Yandex token validation failed');
    } catch (error) {
      if (!this.#isCurrent(generation) || this.#isCancelledError(error)) return;
      this.#renderError(userFacingError(error));
    }
  }

  #renderFrame(
    title: string,
    content: HTMLElement,
    buttons: readonly HTMLButtonElement[] = []
  ): void {
    const heading = createElement('h2', 'ytaf-vot-pair-title', title);
    heading.id = `${DIALOG_ID}-title`;
    const contentContainer = createElement('div', 'ytaf-vot-pair-content');
    contentContainer.append(content);
    const actions = createElement('div', 'ytaf-vot-pair-actions');
    actions.append(...buttons);
    const hint = createElement(
      'div',
      'ytaf-vot-pair-hint',
      'Use arrow keys to move · OK to select · Back to cancel'
    );
    this.#card.replaceChildren(heading, contentContainer, actions, hint);
    this.#focusFirstButton();
  }

  #renderLoading(message: string): void {
    const content = createElement('div');
    content.append(
      createElement('div', 'ytaf-vot-pair-spinner'),
      createElement('p', 'ytaf-vot-pair-message', message)
    );
    this.#renderFrame('Yandex live voices', content, [
      this.#button('Cancel', false, () => this.#cancelAndClose())
    ]);
  }

  #renderPairing(session: PairingSession): boolean {
    let qrCode: SVGSVGElement;
    try {
      qrCode = createQrCode(session.pairingUrl);
    } catch {
      this.#renderError('Could not render the pairing QR code');
      return false;
    }

    const columns = createElement('div', 'ytaf-vot-pair-columns');
    const qrContainer = createElement('div', 'ytaf-vot-pair-qr');
    qrContainer.append(qrCode);
    const copy = createElement('div', 'ytaf-vot-pair-copy');
    copy.append(
      createElement(
        'p',
        undefined,
        'Scan the QR code with your phone, then enter your Yandex OAuth token on the TV pairing page.'
      ),
      createElement(
        'p',
        'ytaf-vot-pair-note',
        'The token is sent only to this TV, stored by the root service, and is never exposed to YouTube.'
      ),
      createElement(
        'p',
        'ytaf-vot-pair-note',
        'Manual pairing uses local HTTP. Use it only on a trusted home Wi-Fi network.'
      )
    );

    if (session.verificationCode) {
      copy.append(
        createElement('div', 'ytaf-vot-pair-code-label', 'Confirmation code'),
        createElement('div', 'ytaf-vot-pair-code', session.verificationCode)
      );
    }
    const countdown = createElement(
      'div',
      'ytaf-vot-pair-countdown',
      countdownText(session.status.expiresAt)
    );
    countdown.dataset.pairingCountdown = 'true';
    copy.append(countdown);
    columns.append(qrContainer, copy);
    this.#renderFrame('Connect Yandex live voices', columns, [
      this.#button('Cancel', false, () => this.#cancelAndClose())
    ]);
    return true;
  }

  #renderConnected(status: PairingStatus): void {
    const content = createElement('div');
    content.append(
      createElement('div', 'ytaf-vot-pair-status-icon', '✓'),
      createElement(
        'p',
        'ytaf-vot-pair-message',
        'Yandex live voices are already connected.'
      )
    );
    if (status.accountLabel) {
      content.append(
        createElement('div', 'ytaf-vot-pair-account', status.accountLabel)
      );
    }
    this.#renderFrame('Yandex live voices', content, [
      this.#button('Use this account', true, () => this.#finish(status)),
      this.#button('Pair another account', false, () => {
        void this.#startPairing();
      }),
      this.#button('Cancel', false, () => this.#cancelAndClose())
    ]);
  }

  #renderSuccess(status: PairingStatus): void {
    this.#session = null;
    this.#clearTimers();
    const content = createElement('div');
    content.append(
      createElement('div', 'ytaf-vot-pair-status-icon', '✓'),
      createElement(
        'p',
        'ytaf-vot-pair-message',
        'Yandex live voices are connected.'
      )
    );
    if (status.accountLabel) {
      content.append(
        createElement('div', 'ytaf-vot-pair-account', status.accountLabel)
      );
    }
    this.#renderFrame('Pairing complete', content);
    this.#successTimer = window.setTimeout(
      () => this.#finish(status),
      SUCCESS_VISIBLE_MS
    );
  }

  #renderExpired(): void {
    this.#operationController?.abort();
    this.#clearTimers();
    const status: PairingStatus = {
      configured: false,
      valid: false,
      accountLabel: null,
      state: 'expired',
      expiresAt: this.#session?.status.expiresAt ?? null
    };
    this.#lastStatus = status;
    const content = createElement('div');
    content.append(
      createElement(
        'div',
        'ytaf-vot-pair-status-icon ytaf-vot-pair-error',
        '!'
      ),
      createElement(
        'p',
        'ytaf-vot-pair-message',
        'The pairing link expired. Create a new QR code and try again.'
      )
    );
    this.#renderFrame('Pairing link expired', content, [
      this.#button('Try again', true, () => {
        void this.#startPairing();
      }),
      this.#button('Cancel', false, () => this.#cancelAndClose())
    ]);
  }

  #renderError(message: string): void {
    this.#operationController?.abort();
    this.#clearTimers();
    const content = createElement('div');
    content.append(
      createElement(
        'div',
        'ytaf-vot-pair-status-icon ytaf-vot-pair-error',
        '!'
      ),
      createElement('p', 'ytaf-vot-pair-message', message)
    );
    this.#renderFrame('Could not connect', content, [
      this.#button('Try again', true, () => {
        void this.#initialize();
      }),
      this.#button('Cancel', false, () => this.#cancelAndClose())
    ]);
  }

  #button(
    label: string,
    primary: boolean,
    action: () => void
  ): HTMLButtonElement {
    const button = createElement(
      'button',
      `ytaf-vot-pair-button${primary ? ' ytaf-vot-pair-primary' : ''}`,
      label
    );
    button.type = 'button';
    button.addEventListener('click', action);
    return button;
  }

  #focusFirstButton(): void {
    window.setTimeout(() => {
      if (this.#closed) return;
      this.#buttons()[0]?.focus();
    }, 0);
  }

  #buttons(): HTMLButtonElement[] {
    return Array.from(
      this.#root.querySelectorAll<HTMLButtonElement>(
        '.ytaf-vot-pair-button:not(:disabled)'
      )
    );
  }

  #startCountdown(session: PairingSession, generation: number): void {
    const update = (): void => {
      if (!this.#isCurrent(generation) || this.#session !== session) return;
      const countdown = this.#root.querySelector<HTMLElement>(
        '[data-pairing-countdown="true"]'
      );
      if (countdown)
        countdown.textContent = countdownText(session.status.expiresAt);
      if (
        session.status.expiresAt !== null &&
        Date.now() >= session.status.expiresAt
      ) {
        this.#renderExpired();
        return;
      }
      this.#countdownTimer = window.setTimeout(update, 1_000);
    };
    update();
  }

  #replaceOperationController(): void {
    this.#operationController?.abort();
    this.#operationController = new AbortController();
  }

  #isCurrent(generation: number): boolean {
    return !this.#closed && generation === this.#generation;
  }

  #isCancelledError(error: unknown): boolean {
    return error instanceof PairingClientError && error.code === 'cancelled';
  }

  #clearTimers(): void {
    if (this.#countdownTimer !== null) {
      window.clearTimeout(this.#countdownTimer);
      this.#countdownTimer = null;
    }
    if (this.#successTimer !== null) {
      window.clearTimeout(this.#successTimer);
      this.#successTimer = null;
    }
  }

  #cancelAndClose(): void {
    if (this.#closed) return;
    const session = this.#session;
    this.#operationController?.abort();
    if (session) {
      void votPairingClient.cancel(session.id).catch(() => undefined);
    }
    this.#finish(cancelledStatus(this.#lastStatus));
  }

  #finish(status: PairingStatus): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#generation += 1;
    this.#operationController?.abort();
    this.#clearTimers();
    this.#root.removeEventListener('click', this.#handleBackdropClick);
    window.removeEventListener('keydown', this.#handleKeyDown, true);
    this.#root.remove();
    if (this.#previousFocus?.isConnected) this.#previousFocus.focus();
    const resolve = this.#finishResolver;
    this.#finishResolver = null;
    resolve?.(status);
  }

  readonly #handleBackdropClick = (event: MouseEvent): void => {
    if (event.target === this.#root) this.#cancelAndClose();
  };

  readonly #handleKeyDown = (event: KeyboardEvent): void => {
    const code = event.keyCode || event.which;
    const isBack =
      event.key === 'Escape' ||
      event.key === 'BrowserBack' ||
      event.key === 'GoBack' ||
      code === 8 ||
      code === 27 ||
      code === 461;
    const isPrevious =
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowUp' ||
      code === 37 ||
      code === 38;
    const isNext =
      event.key === 'ArrowRight' ||
      event.key === 'ArrowDown' ||
      code === 39 ||
      code === 40;
    const isEnter = event.key === 'Enter' || code === 13;
    if (!isBack && !isPrevious && !isNext && !isEnter) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (isBack) {
      this.#cancelAndClose();
      return;
    }

    const buttons = this.#buttons();
    if (!buttons.length) return;
    const activeIndex = buttons.indexOf(
      document.activeElement as HTMLButtonElement
    );
    if (isEnter) {
      const activeButton = activeIndex >= 0 ? buttons[activeIndex] : buttons[0];
      activeButton?.click();
      return;
    }
    const direction = isPrevious ? -1 : 1;
    const nextIndex =
      activeIndex < 0
        ? 0
        : (activeIndex + direction + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  };
}

let activePairingDialog: Promise<PairingStatus> | null = null;

export function openPairingDialog(): Promise<PairingStatus> {
  if (activePairingDialog) return activePairingDialog;
  const dialog = new PairingDialog();
  const result = dialog.open();
  activePairingDialog = result.finally(() => {
    activePairingDialog = null;
  });
  return activePairingDialog;
}
