import { SponsorBlock } from "./blocker";
import { VideoEventListener } from "./video-event-listener";

enum PageMode {
  Watch = 'watch',
  Default = 'browse'
}

export class CustomWatcher {
  observer: MutationObserver;

  bar: Element | null = null;

  slider: HTMLDivElement | null = null;

  body: HTMLBodyElement;

  mode: PageMode = PageMode.Default;

  videoID: string | null = null;

  blocker?: SponsorBlock;

  constructor() {
    this.observer = new MutationObserver(this.onMutationEvent);

    const body = document.querySelector('body');

    if (!body) {
      throw Error('body not found... exit');
    }

    this.body = body;

    window.addEventListener('hashchange', this.onHashChange);
    this.observeChangeMode();

    /** Если режим воспроизведения видео. (при инициализации наверно невозможен) */
    // if (this.body.classList.contains('WEB_PAGE_TYPE_WATCH')) {
    //   console.log('watching already... initialization');

    //   this.mode = PageMode.Watch;
    //   this.initializeForWatch();
    // }

    const instance = new VideoEventListener();
    console.log('VideoEventListener instance', instance);
  }

  observeChangeMode = () => {
    this.observer.observe(this.body, {
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    });
  }

  getSliderQuerySelector = () => {
    if (!this.bar) {
      throw Error('getSliderQuerySelector bar is not defined');
    }

    const isMarkedBar = this.bar.classList.contains('ytlr-progress-bar--has-multi-markers');

    if (isMarkedBar) {
      return '.ytlr-progress-bar__slider-base';
    }

    return '.ytlr-progress-bar__slider';
  }

  setSlider = () => {
    if (!this.bar) {
      throw Error('setSlider bar is not defined');
    }

    let slider = this.bar.querySelector(this.getSliderQuerySelector());

    if (!slider) {
      throw Error('slider not found in progress bar');
    }

    this.slider = slider as HTMLDivElement;

    console.log('setSlider found', this.slider);
  }

  initializeForWatch = () => {
    const bar = document.querySelector('.ytlr-progress-bar');

    if (!bar) {
      throw new Error('progress bar not found');
    }

    this.bar = bar;

    console.info('progress bar found', this.bar);

    this.setObserve();
  }

  setObserve = () => {
    if (!this.bar) {
      throw Error('setObserve bar is not defined');
    }

    this.observer.observe(this.bar, {
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    });

    this.setSlider();

    if (!this.slider) {
      throw Error('setObserve slider is not defined');
    }

    this.observer.observe(this.slider, {
      // childList: true,
      attributeOldValue: true,
    });
  }

  reset = () => {
    this.observer.disconnect();
    this.observeChangeMode();
    this.setObserve();

    if (!this.slider) {
      console.error('Slider not found');
    } else {
      // this.blocker?.setSlider(this.slider);
    }
  }

  onHashChange = (ev: HashChangeEvent) => {
    const newURL = new URL(location.hash.substring(1), location.href);
    const videoID = newURL.searchParams.get('v');

    this.videoID = videoID;

    // console.warn('onHashChange', { videoID, event, instance: this, newURL });

    /** Значит запустился просмотр. */
    if (this.mode === PageMode.Watch && videoID) {
      const player = this.getSliderQuerySelector() === '.ytlr-progress-bar__slider'
        ? 'обычный плеер'
        : 'плеер с главами'

      console.log(`Запустился просмотр через ${player}`, newURL.toString());

      if (!this.slider) {
        throw Error('onHashChange: slider undefined');
      }

      if (!this.blocker) {
        console.log('create sponsor block instance');

        this.blocker = new SponsorBlock({
          videoID,
          slider: this.slider,
        });

        this.blocker.init();
      } else {
        console.log('reinitialize sponsor block instance');

        this.blocker.setSlider(this.slider);
        this.blocker.reinit(videoID);
      }
    }

    /** Значит произошёл переход на роут без видео. */
    if (this.mode === PageMode.Default && !videoID && !this.slider) {
      console.info('go to non video page', newURL.toString());
    }

    /** Значит просмотр закончился. */
    if (this.mode === PageMode.Default && !videoID && this.bar && this.slider) {
      const player = this.getSliderQuerySelector() === '.ytlr-progress-bar__slider'
        ? 'обычный плеер'
        : 'плеер с главами'

      console.log(`Просмотр через ${player} закончился`, ev.oldURL);
      this.slider = null;
      this.videoID = null;
      this.blocker?.unbuild();
    }
  }

  onChangeMode = (mutation: MutationRecord) => {
    // console.info('onChangeMode mutation', mutation);

    const targetElement = (mutation.target as HTMLElement).classList;

    /** Если изменился режим просмотра на воспроизведение. */
    if (targetElement.contains('WEB_PAGE_TYPE_WATCH') && mutation.oldValue?.includes('WEB_PAGE_TYPE_BROWSE')) {
      console.log('Режим просмотра на воспроизведение', this.bar);

      this.mode = PageMode.Watch;

      if (this.bar) {
        this.setObserve();
      } else {
        this.initializeForWatch();
      }
    }

    /** Если режим воспроизведения прекращён. */
    if (targetElement.contains('WEB_PAGE_TYPE_BROWSE') && mutation.oldValue?.includes('WEB_PAGE_TYPE_WATCH')) {
      this.mode = PageMode.Default;
      console.log('Режим воспроизведения прекращён');
    }
  }

  onChangeSlider = (mutation: MutationRecord) => {
    console.info('onChangeSlider mutation', mutation);
  }

  onChangeProgressBar = (mutation: MutationRecord) => {
    if (!(mutation.target instanceof HTMLElement)) {
      console.warn('target mutation non html element... skip', mutation);

      return;
    }

    const isProgressBarMutation = mutation.type === 'attributes' && mutation.attributeName === 'class';

    /** Если меняется фокус при навигации вверх-вниз, как пример. */
    // attributeFilter class строит!
    // if (isProgressBarMutation && mutation.attributeName === 'hybridnavfocusable') {
    //   console.log('mutation focusable to', mutation.target.attributes.hybridnavfocusable.value);
    // }

    /** Если меняется фокус при навигации вверх-вниз, как пример. */
    if (isProgressBarMutation) {
      const classList = Array.from<string>(mutation.target.classList);

      // console.log('mutation class list to', classList);

      if (!this.slider) {
        throw Error('onChangeProgressBar slider is not defined');
      }

      /**
       * Если мы знаем о баре с главами, то слайдер у нас должен быть соответствующий.
       */
      const isNotCorrectMarkerSlider = classList.includes('ytlr-progress-bar--has-multi-markers') && !this.slider.classList.contains('ytlr-progress-bar__slider-base');
      const isNotCorrectDefaultSlider = !classList.includes('ytlr-progress-bar--has-multi-markers') && !this.slider.classList.contains('ytlr-progress-bar__slider');

      if (isNotCorrectMarkerSlider || isNotCorrectDefaultSlider) {
        console.warn('Переподписка на изменения, есть различия со слайдером');

        // console.log('mode', this.mode);
        // console.log('slider', this.slider);

        this.reset();

        return;
      }

      /** Если блок скрывается. */
      if (classList.includes('ytlr-progress-bar--hidden')) {
        // console.log('Бар будет скрыт');
      }

      /** Если блок с маркерами. */
      if (classList.includes('ytlr-progress-bar--has-multi-markers')) {
        // console.log('Это бар с маркерами');
      } else {
        // console.log('Это стандартный бар');
      }

      /** Если блок в фокусе. */
      if (classList.includes('ytlr-progress-bar--focused')) {
        // console.log('Бар сейчас в фокусе');
      }

      /** Совмещённые условия. */
      if (classList.includes('ytlr-progress-bar--hidden') && classList.includes('ytlr-progress-bar--has-multi-markers')) {
        console.log('Бар с маркерами скрылся');
      }

      if (classList.includes('ytlr-progress-bar--hidden') && !classList.includes('ytlr-progress-bar--has-multi-markers')) {
        console.log('Обычный бар скрылся');
      }

      if (classList.includes('ytlr-progress-bar--focused') && classList.includes('ytlr-progress-bar--has-multi-markers')) {
        console.log('Бар с маркерами в фокусе');
      }

      if (classList.includes('ytlr-progress-bar--focused') && !classList.includes('ytlr-progress-bar--has-multi-markers')) {
        console.log('Обычный бар в фокусе');
      }

      if (!classList.includes('ytlr-progress-bar--focused') && !classList.includes('ytlr-progress-bar--hidden') && classList.includes('ytlr-progress-bar--has-multi-markers')) {
        console.log('Бар с маркерами потерял фокус');
      }

      if (!classList.includes('ytlr-progress-bar--focused') && !classList.includes('ytlr-progress-bar--hidden') && !classList.includes('ytlr-progress-bar--has-multi-markers')) {
        console.log('Обычный бар потерял фокус');
      }
    }
  }

  onMutationEvent: MutationCallback = (mutations, observer) => {
    for (const mutation of mutations) {
      if (!(mutation.target instanceof HTMLElement)) {
        console.warn('mutation instanceof HTMLElement failed... skip', mutation);

        continue;
      }

      switch (mutation.target.localName) {
        case this.body.localName:
          this.onChangeMode(mutation);
          break;
        case this.slider?.localName:
          this.onChangeSlider(mutation);
          break;
        case this.bar?.localName:
          this.onChangeProgressBar(mutation);
          break;
        default:
          console.warn('unknown mutation case');
      }
    }
  }

  destroy = () => {
    console.log('destroy watcher');

    this.observer.disconnect();
    window.removeEventListener('hashchange', this.onHashChange);
  }
}
