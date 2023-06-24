// @ts-ignore
import sha256 from 'tiny-sha256';
import { Segment, SegmentRecord } from './sponsorblock-module/types';

export class SponsorBlock {
  videoID: string;
  sponsorblockAPI = 'https://sponsorblock.inf.re/api';
  segments: Segment[] = [];
  slider: Element;
  video: HTMLVideoElement | null = null;
  segmentsoverlay: HTMLDivElement | null = null;
  observer: MutationObserver;

  constructor({ videoID, slider }: { videoID: string; slider: HTMLDivElement }) {
    this.videoID = videoID;
    this.slider = slider;
    this.observer = new MutationObserver(this.onMutationEvent);
    this.setVideoPlayer();
  }

  onMutationEvent: MutationCallback = (mutations) => {
    // console.warn('mutations', mutations);

    for (const mutation of mutations) {
      if (mutation.removedNodes) {
        for (const node of mutation.removedNodes) {
          if (node === this.segmentsoverlay) {
            console.info('bringing back segments overlay');
            this.slider.appendChild(this.segmentsoverlay);
            // break; // TODO: REQUIRED?
          }
        }
      }
    }
  }

  setSlider = (slider: Element) => {
    // console.info('sponsor: setSlider: add new slider', slider);

    // this.slider && this.segmentsoverlay && this.slider.removeChild(this.segmentsoverlay);

    this.remove();
    this.slider = slider;
    this.handleFirstInit();
  }

  handleFirstInit = () => {
    this.remove();
    this.build();
  }

  init = async () => {
    return;
    await this.loadSegments();

    if (this.segments.length) {
      this.handleFirstInit();
    } else {
      this.unbuild();
    }
  }

  observe = () => {
    this.observer.observe(this.slider, {
      childList: true,
    });
    // console.log('observe slider listen');
  }

  loadSegments = async () => {
    const videoHash = sha256(this.videoID)?.substring(0, 4);
    const categories = [
      'sponsor',
      'intro',
      'outro',
      'interaction',
      'selfpromo',
      'music_offtopic'
    ];

    let results: SegmentRecord[] = [];

    try {
      const response = await fetch(
        `${this.sponsorblockAPI}/skipSegments/${videoHash}?categories=${encodeURIComponent(
          JSON.stringify(categories)
        )}`
      );
      results = await response.json() as SegmentRecord[];
    } catch (e) {
      console.error('loadSegments: fetch error', e);
    }

    const result = results.find((v) => v.videoID === this.videoID);

    if (!result || !result.segments || !result.segments.length) {
      console.info(this.videoID, 'No segments found.');

      return;
    }

    console.info(this.videoID, 'Got it:', result);

    this.segments = result.segments;
  }

  onPlayEvent = () => { }
  onPauseEvent = () => { }
  onDurationChangeEvent = () => { }
  onTimeupdateEvent = () => { }

  setVideoPlayer = () => {
    this.video = document.querySelector('video');

    if (!this.video) {
      throw Error(this.videoID + ' No video yet...');
    }

    console.info(this.videoID, 'Video found, binding...');

    this.video.addEventListener('play', this.onPlayEvent);
    this.video.addEventListener('pause', this.onPauseEvent);
    this.video.addEventListener('timeupdate', this.onTimeupdateEvent);
    this.video.addEventListener('durationchange', this.onDurationChangeEvent);
  }

  reinit = async (videoID: string) => {
    if (this.videoID === videoID) {
      console.warn('reinit easy ', this);
      this.handleFirstInit();

      return;
    }

    this.segments = [];
    this.videoID = videoID;

    await this.init();
  }

  waitPlayerReady = () => new Promise((resolve, reject) => {
    let timeout: number | undefined;

    const observer = new MutationObserver((mutations, observer) => {
      console.log('waitPlayerReady: mutations', mutations);
      // observer.disconnect();
      clearTimeout(timeout);
      // resolve(mutations);
    });

    timeout = window.setTimeout(() => {
      observer.disconnect();
      reject('wait ready failed');
    }, 3000);

    observer.observe(this.video as HTMLVideoElement, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['src'],
    });
  });

  build = () => {
    if (!this.video) {
      throw Error('build: video element not found');
    }

    if (!this.video.duration) {
      console.info('video player not duration... skip');

      this.waitPlayerReady().then(this.build).catch(console.error);

      return;
    }

    if (!this.segments.length) {
      console.info('segments empty... skip');

      return;
    }

    this.disconnect();

    const videoDuration = this.video.duration;

    const segmentsoverlay = this.segmentsoverlay ?? document.createElement('div');

    this.segments.forEach((segment) => {
      const [start, end] = segment.segment;
      const barType = {
        color: 'blue',
        opacity: 0.7
      };
      const transform = `translateX(${(start / videoDuration) * 100.0
        }%) scaleX(${(end - start) / videoDuration})`;
      const elm = document.createElement('div');
      elm.classList.add('ytlr-progress-bar__played');
      elm.style['background'] = barType.color;
      elm.style['opacity'] = barType.opacity.toString();
      elm.style.webkitTransform = transform;
      console.info('Generated element', { segment, elm, transform });
      segmentsoverlay.appendChild(elm);
    });

    this.segmentsoverlay = segmentsoverlay;

    if (this.slider.classList.contains('ytlr-progress-bar__slider-base')) {
      // console.info('apply margin for chapters slider');
      this.segmentsoverlay.style.marginTop = '-1.18em';
    } else {
      this.segmentsoverlay.style.marginTop = '';
    }

    this.slider.appendChild(this.segmentsoverlay);

    this.observe();
  }

  disconnect = () => {
    this.observer.disconnect();
    console.log('blocker observe disconnect');
  }

  remove = () => {
    if (!this.segmentsoverlay) {
      console.log('remove: segmentsoverlay is not defined');

      return;
    }

    Array.from(this.segmentsoverlay.children).forEach(ch => ch.remove());
    this.segmentsoverlay.remove();
  }

  unbuild = () => {
    console.log('unbilding', this.slider, this.segmentsoverlay);

    this.disconnect();
    this.remove();

    console.log('unbilded', this.slider, this.segmentsoverlay);
  }
}