// import EventTarget from '@ungap/event-target';

export class VideoEventListener extends EventTarget {
  video?: HTMLVideoElement;
  observer?: MutationObserver;
  started: boolean;

  constructor() {
    super();

    this.started = false;

    this.waitToVideo().then(
      () => {
        const video = document.querySelector('video');

        if (!video) {
          throw new Error("video element not found");
        }

        this.video = video;

        this.observer = new MutationObserver(this.onMutationCallback);

        this.observer.observe(this.video, {
          attributeFilter: ['src', 'controlslist'],
          attributeOldValue: true,
          attributes: true,
        });

        this.dispatchEvent(new Event('ready'));
      }
    );
  }

  waitToVideo = () => new Promise<void>((resolve, reject) => {
    const body = document.querySelector('body') as HTMLBodyElement;

    if (body.classList.contains('WEB_PAGE_TYPE_WATCH')) {
      console.log('VideoEventListener.waitToVideo(): already watch', body);

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
          console.log('VideoEventListener.waitToVideo(): Режим воспроизведения');

          callback();
        }

        /** Если режим воспроизведения прекращён. */
        if (classList.contains('WEB_PAGE_TYPE_BROWSE') && mutation.oldValue?.includes('WEB_PAGE_TYPE_WATCH')) {
          console.log('VideoEventListener.waitToVideo(): Выход из режима воспроизведения');
        }

        const base = mutation.attributeName === 'class' && mutation.type === 'attributes';

        /** Если произошла первая загрузка страницы. */
        if (base && classList.contains('WEB_PAGE_TYPE_BROWSE') && mutation.oldValue === null) {
          console.log('VideoEventListener.waitToVideo(): Первая загрузка страницы');
        }
      }
    });

    observer.observe(body, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['class'],
    });
  });

  waitToCloseVideo = () => new Promise<void>((resolve, reject) => {
    const body = document.querySelector('body') as HTMLBodyElement;

    const callback = () => {
      observer.disconnect();
      resolve();
    }

    const observer = new MutationObserver((mutations, _observer) => {
      for (const mutation of mutations) {
        const classList = (mutation.target as HTMLBodyElement).classList;

        /** Если режим воспроизведения прекращён. */
        if (classList.contains('WEB_PAGE_TYPE_BROWSE') && mutation.oldValue?.includes('WEB_PAGE_TYPE_WATCH')) {
          console.log('VideoEventListener.waitToCloseVideo(): Выход из режима воспроизведения');
          callback();
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
      const targetMutation = mutation.target as HTMLVideoElement;
      const isEmptyTargetSrc = !targetMutation.src.length;
      const isNewSrc = mutation.attributeName === 'src' && mutation.oldValue === null;

      const isStartPlay = [
        isNewSrc || (
          mutation.attributeName === 'controlslist' && mutation.oldValue === "nodownload"
        ),
        !!this.video?.duration,
        !this.started,
        !isEmptyTargetSrc
      ];

      if (isStartPlay.every(Boolean)) {
        const ev = new Event('playing');

        this.started = true;

        this.dispatchEvent(ev);

        this.waitToCloseVideo().then(() => {
          const ev = new Event('finished');

          this.started = false;

          console.log('VideoEventListener: emit finished event', ev);

          this.dispatchEvent(ev);
        });

        continue; // TODO: REMOVE?
      }

      console.warn('VideoEventListener.onMutationCallback():', [
        `src ${targetMutation.src}`,
        `oldValue ${mutation.oldValue}`,
        `attributeName ${mutation.attributeName}`,
        `video.duration ${this.video?.duration}`,
      ]);
    }
  }
}
