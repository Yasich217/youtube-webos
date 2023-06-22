export class VideoEventListener extends EventTarget {
  video?: HTMLVideoElement;
  observer?: MutationObserver;

  constructor() {
    super();

    this.waitToVideo().then(
      () => {
        try {
          console.log('VideoEventListener: video element found');

          const video = document.querySelector('video');

          if (!video) {
            console.log('inititalize video completed', video);

            throw new Error("video element not found");
          }

          this.video = video;

          this.observer = new MutationObserver(this.onMutationCallback);

          this.observer.observe(this.video, {
            attributes: true,
            attributeOldValue: true,
            // attributeFilter: ['src', 'style'],
          });

          // this.video.addEventListener('play', this.onPlayEvent);
          // this.video.addEventListener('pause', this.onPauseEvent);
          // this.video.addEventListener('timeupdate', this.onTimeupdateEvent);
          // this.video.addEventListener('durationchange', this.onDurationChangeEvent);

          console.log('inititalize video completed');

          this.dispatchEvent(new Event('ready'));
        } catch (e) {
          console.error('inititalize video failed', e);
        }
      }
    ).catch((e) => {
      console.error(e);
      throw Error(e);
    });
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
      console.log(
        'VideoEventListener.onMutationCallback():',
        mutation.attributeName,
        mutation.oldValue,
        mutation.attributeName ? mutation.target[mutation.attributeName as keyof typeof mutation.target] : undefined
      );
    }
  }

  // onPlayEvent = (...args: unknown[]) => { console.log('VideoEventListener play event', args) }
  // onPauseEvent = (...args: unknown[]) => { console.log('VideoEventListener pause event', args) }
  // onDurationChangeEvent = (...args: unknown[]) => { console.log('VideoEventListener timeupdate event', args) }
  // onTimeupdateEvent = (...args: unknown[]) => { console.log('VideoEventListener durationchange event', args) }

  check = () => { }

  doSomething() {
    this.dispatchEvent(new Event('something'));
  }

  render = () => {

  }
}
