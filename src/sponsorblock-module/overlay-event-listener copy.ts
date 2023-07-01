// import EventTarget from '@ungap/event-target';

export class OverlayEventListener extends EventTarget {
  overlay: HTMLElement;
  observer?: MutationObserver;

  constructor() {
    super();

    this.overlay = document.querySelector('.yt-unified-overlay-stage') as HTMLElement;
    this.observer = new MutationObserver(this.onMutationCallback);

    this.observer.observe(this.overlay, {
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    });
  }

  waitToVideo = () => new Promise<void>((resolve, reject) => {
    const body = document.querySelector('body') as HTMLBodyElement;

    if (body.classList.contains('WEB_PAGE_TYPE_WATCH')) {
      console.log('OverlayEventListener.waitToVideo(): already watch', body);

      resolve();
    }

    const callback = () => {
      observer.disconnect();
      resolve();
    }

    const observer = new MutationObserver((mutations, _observer) => {
      for (const mutation of mutations) {
        const classList = (mutation.target as HTMLBodyElement).classList;

        /** Если изменился режим просмотра на воспроизведение. */
        if (classList.contains('WEB_PAGE_TYPE_WATCH') && mutation.oldValue?.includes('WEB_PAGE_TYPE_BROWSE')) {
          console.log('OverlayEventListener.waitToVideo(): Режим воспроизведения');

          callback();
        }

        /** Если режим воспроизведения прекращён. */
        if (classList.contains('WEB_PAGE_TYPE_BROWSE') && mutation.oldValue?.includes('WEB_PAGE_TYPE_WATCH')) {
          console.log('OverlayEventListener.waitToVideo(): Выход из режима воспроизведения');
        }

        const base = mutation.attributeName === 'class' && mutation.type === 'attributes';

        /** Если произошла первая загрузка страницы. */
        if (base && classList.contains('WEB_PAGE_TYPE_BROWSE') && mutation.oldValue === null) {
          console.log('OverlayEventListener.waitToVideo(): Первая загрузка страницы');
        }
      }
    });

    observer.observe(body, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['class'],
    });
  });

  onMutationCallback: MutationCallback = (mutations) => {
    for (const mutation of mutations) {

      console.warn('OverlayEventListener.onMutationCallback():');
      // console.log('mutation:', mutation);
      console.log('mutation:', mutation);
    }
  }
}
