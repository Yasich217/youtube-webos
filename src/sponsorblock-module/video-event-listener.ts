// import EventTarget from '@ungap/event-target';

export class VideoEventListener extends EventTarget {
  video?: HTMLVideoElement;
  observer?: MutationObserver;

  constructor() {
    super();

    this.waitToVideo().then(
      () => {
        const video = document.querySelector('video');

        if (!video) {
          throw new Error("video element not found");
        }

        this.video = video;

        this.observer = new MutationObserver(this.onMutationCallback);

        this.observer.observe(this.video, {
          attributeFilter: ['src'],
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

  onMutationCallback: MutationCallback = (mutations) => {
    for (const mutation of mutations) {
      const isEmptyTargetSrc = !(mutation.target as HTMLVideoElement).src?.length;

      const isStartPlay = [
        mutation.attributeName === 'src',
        mutation.oldValue === null,
        !isEmptyTargetSrc
      ];

      const isFinishPlay = [
        mutation.attributeName === 'src',
        !!mutation.oldValue?.length,
        isEmptyTargetSrc
      ];

      if (isStartPlay.every(Boolean)) {
        const ev = new Event('playing');

        // console.log('VideoEventListener: emit playing event', ev);

        this.dispatchEvent(ev);

        continue; // TODO: REMOVE?
      }

      if (isFinishPlay.every(Boolean)) {
        const ev = new Event('finished');

        // console.log('VideoEventListener: emit finished event', ev);

        this.dispatchEvent(ev);

        continue; // TODO: REMOVE?
      }

      // console.warn('VideoEventListener.onMutationCallback():');
      // console.log('mutation:', mutation);
    }
  }
}
