import { BAR_TYPES } from './constants';
import { Segment, SliderType } from './types';

interface SliderComponentProps {
  video: HTMLVideoElement;
}

export class SliderComponent {
  slider: HTMLDivElement;
  type: SliderType;
  observer: MutationObserver;
  video: HTMLVideoElement;
  segments: Segment[] = [];
  segmentsoverlay: HTMLDivElement;
  progressbar: HTMLElement;

  constructor(props: SliderComponentProps) {
    const params = this.createSliderOverlay();

    this.slider = params.slider;
    this.type = params.type;

    this.video = props.video;

    this.progressbar = this.createProgressBar();

    this.segmentsoverlay = document.createElement('div');

    this.observer = new MutationObserver(this.onMutationCallback);
  }

  createProgressBar = () => {
    const bar = document.querySelector('.ytlr-progress-bar');

    if (!bar) {
      throw new Error('progress bar not found');
    }

    return bar as HTMLElement;
  }

  createSliderOverlay = () => {
    const chaptersSlider = document.querySelector('.ytlr-progress-bar__slider-base');
    const defaultSlider = document.querySelector('.ytlr-progress-bar__slider');

    const slider = (chaptersSlider ?? defaultSlider) as HTMLDivElement | null;

    if (!slider) {
      throw new Error('SliderComponent -> createSliderOverlay: slider not found');
    }

    const type = chaptersSlider ? SliderType.Chapters : SliderType.Default;

    const result = { slider, type };

    // console.log('createSliderOverlay', result);

    return result;
  }

  onProgressBarEvent = (mutation: MutationRecord) => {
    const isProgressBarMutation = mutation.type === 'attributes' && mutation.attributeName === 'class';

    // console.log('onProgressBarEvent mutation', mutation);

    if (!isProgressBarMutation) {
      throw Error('test if condition');
    }

    const classList = (mutation.target as HTMLElement).classList;
    const sliderClassList = this.slider.classList;

    /**
     * Если мы знаем о баре с главами, то слайдер у нас должен быть соответствующий.
     */
    const isNotCorrectMarkerSlider = classList.contains('ytlr-progress-bar--has-multi-markers') && !sliderClassList.contains('ytlr-progress-bar__slider-base');
    const isNotCorrectDefaultSlider = !classList.contains('ytlr-progress-bar--has-multi-markers') && !sliderClassList.contains('ytlr-progress-bar__slider');

    if (isNotCorrectMarkerSlider || isNotCorrectDefaultSlider) {
      console.warn('Есть различия со слайдером, ререндер');

      if (typeof this.video.duration === 'number') {
        this.remount();
      } else {
        console.warn('video player lost common props');
      }

      return;
    }
  }

  onMutationCallback: MutationCallback = (mutations) => {
    for (const mutation of mutations) {
      if (mutation.target.nodeName === this.progressbar.nodeName) {
        this.onProgressBarEvent(mutation);

        continue;
      }

      if (mutation.removedNodes) {
        for (const node of mutation.removedNodes) {
          if (node === this.segmentsoverlay) {
            console.info('remount overlay');
            this.mount();
          }
        }
      }
    }
  }

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
  }

  remount = () => {
    this.rebuild(this.segments, true);
  }

  unmount = () => {
    this.observer.disconnect();
    this.slider.removeChild(this.segmentsoverlay);
    this.clearSegmentOverlay();
  }

  rebuild = (segments: Segment[], remount = false) => {
    if (!segments.length) {
      console.log('rebuild segments empty');

      return;
    }

    if (!remount && segments === this.segments) {
      console.log('segments already loaded');

      return;
    }

    const params = this.createSliderOverlay();

    this.slider = params.slider;
    this.type = params.type;

    this.mount();

    this.segments = segments;

    this.clearSegmentOverlay();
    this.createSegmentOverlay();
  }

  clearSegmentOverlay = () => {
    // console.log('clearSegmentOverlay:', this.segmentsoverlay.children);

    Array.from(this.segmentsoverlay.children).forEach(child => child.remove());
    this.segmentsoverlay.remove();
  }

  createSegmentOverlay = () => {
    const videoDuration = this.video.duration;

    this.segments.forEach((segment) => {
      const [start, end] = segment.segment;

      const barTypeByMap = BAR_TYPES[segment.category];

      if (!barTypeByMap) {
        console.warn('segment category not mapped', segment);
      }

      const barType = barTypeByMap ?? {
        color: 'blue',
        opacity: 0.7
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

    console.log('createSegmentOverlay segments', this.segments.length);
    // console.log(this.segments, this.segmentsoverlay);
  }
}
