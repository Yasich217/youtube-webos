import { BAR_TYPES } from './constants';
import { Segment, SliderType } from './types';

interface SliderOverlayProps {
  video: HTMLVideoElement;
};

export class SliderOverlay {
  observer: MutationObserver;
  progressbar: HTMLElement;
  segments: Segment[];
  segmentsoverlay: HTMLDivElement;
  slider: HTMLDivElement;
  type: SliderType;
  video: HTMLVideoElement;

  constructor({ video }: SliderOverlayProps) {
    const { slider, type } = this.createSliderOverlay();

    this.progressbar = this.createProgressBar();

    this.video = video;

    this.slider = slider;
    this.type = type;

    this.segments = [];

    this.segmentsoverlay = document.createElement('div');

    this.observer = new MutationObserver(this.onMutationCallback);
  };

  createProgressBar = () => {
    const bar = document.querySelector('.ytlr-progress-bar');

    if (!bar) {
      throw new Error('progress bar not found');
    }

    return bar as HTMLElement;
  };

  createSliderOverlay = () => {
    const chaptersSlider = document.querySelector('.ytlr-progress-bar__slider-base');
    const defaultSlider = document.querySelector('.ytlr-progress-bar__slider');

    const slider = (chaptersSlider ?? defaultSlider) as HTMLDivElement | null;

    if (!slider) {
      throw new Error('Slider.createSliderOverlay: slider not found');
    }

    const type = chaptersSlider ? SliderType.Chapters : SliderType.Default;

    const result = { slider, type };

    return result;
  };

  onProgressBarEvent = (mutation: MutationRecord) => {
    const isProgressBarMutation = mutation.type === 'attributes' && mutation.attributeName === 'class';

    if (!isProgressBarMutation) {
      throw Error('test if condition');
    }

    const targetClassList = (mutation.target as HTMLElement).classList;
    const sliderClassList = this.slider.classList;

    /**
     * Если мы знаем о баре с главами, то слайдер у нас должен быть соответствующий.
     */
    const isNotCorrectMarkerSlider = targetClassList.contains('ytlr-progress-bar--has-multi-markers') && !sliderClassList.contains('ytlr-progress-bar__slider-base');
    const isNotCorrectDefaultSlider = !targetClassList.contains('ytlr-progress-bar--has-multi-markers') && !sliderClassList.contains('ytlr-progress-bar__slider');

    if (isNotCorrectMarkerSlider || isNotCorrectDefaultSlider) {
      console.warn('Есть различия со слайдером, ререндер');

      if (typeof this.video.duration === 'number') {
        this.remount();
      } else {
        console.warn('video player lost common props');
      }

      return;
    }
  };

  onMutationCallback: MutationCallback = (mutations) => {
    for (const mutation of mutations) {
      if (mutation.target.nodeName === this.progressbar.nodeName) {
        this.onProgressBarEvent(mutation);

        continue;
      }

      if (mutation.removedNodes) {
        for (const node of mutation.removedNodes) {
          if (node === this.segmentsoverlay) {
            // console.info('remount overlay');
            this.mount();
          }
        }
      }
    }
  };

  mount = () => {
    this.observer.disconnect();

    this.slider.appendChild(this.segmentsoverlay);

    this.observer.observe(this.slider, {
      childList: true,
    });

    this.observer.observe(this.progressbar, {
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    });
  };

  remount = () => {
    this.rebuild(this.segments, true);
  };

  unmount = () => {
    this.observer.disconnect();
    this.clearSegmentOverlay();
  };

  rebuild = (segments: Segment[], remount = false) => {
    if (!segments.length) {
      console.log('rebuild segments empty');

      return;
    }

    if (!remount && segments === this.segments) {
      console.log('segments already loaded');

      return;
    }

    const { slider, type } = this.createSliderOverlay();

    this.slider = slider;
    this.type = type;

    this.mount();

    this.segments = segments;

    this.clearSegmentOverlay();
    this.createSegmentOverlay();
  };

  clearSegmentOverlay = () => {
    try {
      this.slider.removeChild(this.segmentsoverlay);
    } catch (e) {
      console.warn('slider remove overlay error', e);
    }
    Array.from(this.segmentsoverlay.children).forEach(child => child.remove());
    this.segmentsoverlay.remove(); // look up
  };

  createSegmentOverlay = () => {
    const videoDuration = this.video.duration;

    if (!videoDuration) {
      console.warn('video duration incorrected', this.video.currentTime);
    }

    this.segments.forEach((segment) => {
      const [start, end] = segment.segment;

      const barTypeByMap = BAR_TYPES[segment.category];

      if (!barTypeByMap) {
        console.warn('segment category not mapped', segment);
      }

      const barType = barTypeByMap ?? {
        color: 'blue',
        opacity: 0.7,
      };

      const transform = `translateX(${(start / videoDuration) * 100.0}%) scaleX(${(end - start) / videoDuration})`;

      const elm = document.createElement('div');

      if (this.type === SliderType.Chapters) {
        elm.classList.add('ytlr-multi-markers-player-bar-renderer__segment');
        elm.style.position = 'absolute';
      } else {
        elm.classList.add('ytlr-progress-bar__played');
      }

      elm.style.background = barType.color;
      elm.style.opacity = barType.opacity.toString();
      elm.style.webkitTransform = transform;

      // console.info('Generated element', elm);

      this.segmentsoverlay.appendChild(elm);
    });

    // console.log('createSegmentOverlay segments', this.segments.length);
  };
};
