const enum SliderType {
  Chapters = 'chapters',
  Default = 'default'
}

export class SliderComponent extends EventTarget {
  slider: HTMLDivElement;
  type: SliderType;
  observer?: MutationObserver;

  constructor() {
    super();

    let chaptersSlider = document.querySelector('.ytlr-progress-bar__slider-base');
    let defaultSlider = document.querySelector('.ytlr-progress-bar__slider');

    this.type = chaptersSlider ? SliderType.Chapters : SliderType.Default;

    this.slider = chaptersSlider ?? defaultSlider;

    this.waitToVideo().then(
      () => {
        try {
          console.log('SliderComponent: video element found');

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

          this.video.addEventListener('play', this.onPlayEvent);
          this.video.addEventListener('pause', this.onPauseEvent);
          this.video.addEventListener('timeupdate', this.onTimeupdateEvent);
          this.video.addEventListener('durationchange', this.onDurationChangeEvent);

          console.log('inititalize video completed');
        } catch (e) {
          console.error('inititalize video failed', e);
        }
      }
    ).catch((e) => {
      throw Error(e);
    });
  }

  waitToVideo = () => new Promise<void>((resolve, reject) => {
    const body = document.querySelector('body') as HTMLBodyElement;

    if (body.classList.contains('WEB_PAGE_TYPE_WATCH')) {
      console.log('SliderComponent.waitToVideo(): already watch', body);

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
          console.log('SliderComponent.waitToVideo(): Режим воспроизведения');

          callback();
        }

        /** Если режим воспроизведения прекращён. */
        if (classList.contains('WEB_PAGE_TYPE_BROWSE') && mutation.oldValue?.includes('WEB_PAGE_TYPE_WATCH')) {
          console.log('SliderComponent.waitToVideo(): Выход из режима воспроизведения');
        }

        const base = mutation.attributeName === 'class' && mutation.type === 'attributes';

        /** Если произошла первая загрузка страницы. */
        if (base && classList.contains('WEB_PAGE_TYPE_BROWSE') && mutation.oldValue === null) {
          console.log('SliderComponent.waitToVideo(): Первая загрузка страницы');
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
        'SliderComponent.onMutationCallback():',
        mutation.attributeName,
        mutation.oldValue,
        mutation.attributeName ? mutation.target[mutation.attributeName as keyof typeof mutation.target] : undefined
      );
    }
  }

  onPlayEvent = (...args: unknown[]) => { console.log('SliderComponent play event', args) }
  onPauseEvent = (...args: unknown[]) => { console.log('SliderComponent pause event', args) }
  onDurationChangeEvent = (...args: unknown[]) => { console.log('SliderComponent timeupdate event', args) }
  onTimeupdateEvent = (...args: unknown[]) => { console.log('SliderComponent durationchange event', args) }

  check = () => { }

  doSomething() {
    this.dispatchEvent(new Event('something'));
  }

  render = () => {
    
  }
}

// const instance = new SliderComponent();
// instance.addEventListener('something', (e) => {
//   console.log('Instance fired "something".', e);
// });
// instance.doSomething();
