export class SponsorblockSkipper extends EventTarget {
  video?: HTMLVideoElement;
  observer?: MutationObserver;

  constructor() {
    super();

    this.waitToVideo().then(
      () => {
        try {
          const video = document.querySelector('video');

          if (!video) {
            throw new Error("video element not found");
          }

          this.video = video;

          this.observer = new MutationObserver(this.onMutationCallback);

          this.observer.observe(this.video, {
            attributes: true,
            attributeOldValue: true,
            attributeFilter: ['src'],
          });

          // this.video.addEventListener('play', this.onPlayEvent);
          // this.video.addEventListener('pause', this.onPauseEvent);
          // this.video.addEventListener('timeupdate', this.onTimeupdateEvent);
          // this.video.addEventListener('durationchange', this.onDurationChangeEvent);

          // console.log('inititalize video completed');

          this.dispatchEvent(new Event('ready'));
        } catch (e) {
          console.error('inititalize video failed', e);
        }
      }
    ).catch((e) => {
      console.error('waitToVideo failed', e);
      throw Error(e);
    });
  }

  waitToVideo = () => new Promise<void>((resolve, reject) => {
    const body = document.querySelector('body') as HTMLBodyElement;

    if (body.classList.contains('WEB_PAGE_TYPE_WATCH')) {
      console.log('SponsorblockSkipper.waitToVideo(): already watch', body);

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
          console.log('SponsorblockSkipper.waitToVideo(): Режим воспроизведения');

          callback();
        }

        /** Если режим воспроизведения прекращён. */
        if (classList.contains('WEB_PAGE_TYPE_BROWSE') && mutation.oldValue?.includes('WEB_PAGE_TYPE_WATCH')) {
          console.log('SponsorblockSkipper.waitToVideo(): Выход из режима воспроизведения');
        }

        const base = mutation.attributeName === 'class' && mutation.type === 'attributes';

        /** Если произошла первая загрузка страницы. */
        if (base && classList.contains('WEB_PAGE_TYPE_BROWSE') && mutation.oldValue === null) {
          console.log('SponsorblockSkipper.waitToVideo(): Первая загрузка страницы');
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

        // console.log('SponsorblockSkipper: emit playing event', ev);

        this.dispatchEvent(ev);

        continue; // TODO: REMOVE?
      }

      if (isFinishPlay.every(Boolean)) {
        const ev = new Event('finished');

        // console.log('SponsorblockSkipper: emit finished event', ev);

        this.dispatchEvent(ev);

        continue; // TODO: REMOVE?
      }

      console.warn('SponsorblockSkipper.onMutationCallback():');
      console.log('mutation:', mutation);
    }
  }

  // onPlayEvent = (...args: unknown[]) => { console.log('SponsorblockSkipper play event', args) }
  // onPauseEvent = (...args: unknown[]) => { console.log('SponsorblockSkipper pause event', args) }
  // onDurationChangeEvent = (...args: unknown[]) => { console.log('SponsorblockSkipper timeupdate event', args) }
  // onTimeupdateEvent = (...args: unknown[]) => { console.log('SponsorblockSkipper durationchange event', args) }
}
