import { Segment } from "./sponsorblock-types";

const enum SliderType {
  Chapters = 'chapters',
  Default = 'default'
}

interface SliderComponentProps {
  video: HTMLVideoElement;
  segments: Segment[];
}

export class SliderComponent extends EventTarget {
  slider: HTMLDivElement;
  type: SliderType;
  observer: MutationObserver;
  video: HTMLVideoElement;
  segments: Segment[];
  segmentsoverlay: HTMLDivElement;

  constructor(props: SliderComponentProps) {
    super();

    const chaptersSlider = document.querySelector('.ytlr-progress-bar__slider-base');
    const defaultSlider = document.querySelector('.ytlr-progress-bar__slider');

    const slider = (chaptersSlider ?? defaultSlider) as HTMLDivElement | null;

    if (!slider) {
      throw new Error('slider not found');
    }
    this.slider = slider;

    this.type = chaptersSlider ? SliderType.Chapters : SliderType.Default;

    this.video = props.video;
    this.segments = props.segments;

    this.segmentsoverlay = document.createElement('div');

    this.observer = new MutationObserver(this.onMutationCallback);

    if (this.slider.classList.contains('ytlr-progress-bar__slider-base')) {
      this.segmentsoverlay.style.marginTop = '-1.18em';
    } else {
      this.segmentsoverlay.style.marginTop = '';
    }

    /** Сначала создаем элемент наложения. */
    this.createOverlay();

    /** Теперь можно подписываться. */
    this.observe();
  }

  onMutationCallback: MutationCallback = (mutations) => {
    for (const mutation of mutations) {
      if (mutation.removedNodes) {
        for (const node of mutation.removedNodes) {
          if (node === this.segmentsoverlay) {
            console.info('bringing back segments overlay');
            // this.slider.appendChild(this.segmentsoverlay);
            this.mount();
            // break; // TODO: REQUIRED?
          }
        }
      }
    }
  }

  check = () => { }

  doSomething() {
    this.dispatchEvent(new Event('something'));
  }

  observe = () => {
    console.log('observe slider listen');

    this.observer.observe(this.slider, {
      childList: true,
    });
  }

  mount = () => {
    this.observer.disconnect();

    this.slider.appendChild(this.segmentsoverlay);

    this.observe();
  }

  createOverlay = () => {
    const videoDuration = this.video.duration;

    this.segments.forEach((segment) => {
      const [start, end] = segment.segment;

      const barType = {
        color: 'blue',
        opacity: 0.7
      };

      const transform = `translateX(${(start / videoDuration) * 100.0}%) scaleX(${(end - start) / videoDuration})`;

      const elm = document.createElement('div');
      elm.classList.add('ytlr-progress-bar__played');
      elm.style['background'] = barType.color;
      elm.style['opacity'] = barType.opacity.toString();
      elm.style.webkitTransform = transform;

      console.info('Generated element', { segment, elm, transform });

      this.segmentsoverlay.appendChild(elm);
    });
  }
}

// const instance = new SliderComponent();
// instance.addEventListener('something', (e) => {
//   console.log('Instance fired "something".', e);
// });
// instance.doSomething();
