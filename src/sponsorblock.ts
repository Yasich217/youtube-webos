// @ts-ignore
import sha256 from 'tiny-sha256';
import { configRead } from './config';
import { showNotification } from './ui';
import { CustomWatcher } from './custom-watcher';

// Copied from https://github.com/ajayyy/SponsorBlock/blob/9392d16617d2d48abb6125c00e2ff6042cb7bebe/src/config.ts#L179-L233
const barTypes = {
  sponsor: {
    color: '#00d400',
    opacity: '0.7',
    name: 'sponsored segment'
  },
  intro: {
    color: '#00ffff',
    opacity: '0.7',
    name: 'intro'
  },
  outro: {
    color: '#0202ed',
    opacity: '0.7',
    name: 'outro'
  },
  interaction: {
    color: '#cc00ff',
    opacity: '0.7',
    name: 'interaction reminder'
  },
  selfpromo: {
    color: '#ffff00',
    opacity: '0.7',
    name: 'self-promotion'
  },
  music_offtopic: {
    color: '#ff9900',
    opacity: '0.7',
    name: 'non-music part'
  }
};

const sponsorblockAPI = 'https://sponsorblock.inf.re/api';

type TProcedure = () => void;

type TSegment = {
  segment: [start: number, end: number]
  category: string;
}

class SponsorBlockHandler {
  video: HTMLVideoElement | null = null;
  active = true;

  attachVideoTimeout: number | undefined = undefined;
  nextSkipTimeout: number | undefined = undefined;
  sliderInterval: number | undefined = undefined;

  observer: MutationObserver | null = null;
  scheduleSkipHandler: TProcedure | null = null;
  durationChangeHandler: TProcedure | null = null;
  segments: TSegment[] = [];
  skippableCategories: string[] = [];
  videoID: string;

  segmentsoverlay: HTMLDivElement | null = null;
  slider: Element | null = null;
  prevSlider: Element | null = null;

  constructor(videoID: string) {
    this.videoID = videoID;
  }

  async init() {
    const videoHash = sha256(this.videoID)?.substring(0, 4);
    const categories = [
      'sponsor',
      'intro',
      'outro',
      'interaction',
      'selfpromo',
      'music_offtopic'
    ];

    console.info('Initialize sponsorblock', videoHash);
    const resp = await fetch(
      `${sponsorblockAPI}/skipSegments/${videoHash}?categories=${encodeURIComponent(
        JSON.stringify(categories)
      )}`
    );
    const results = await resp.json();

    const result = results.find((v: { videoID: string }) => v.videoID === this.videoID);
    console.info(this.videoID, 'Got it:', result);

    if (!result || !result.segments || !result.segments.length) {
      console.info(this.videoID, 'No segments found.');
      return;
    }

    this.segments = result.segments;
    this.skippableCategories = this.getSkippableCategories();

    this.scheduleSkipHandler = () => this.scheduleSkip();
    this.durationChangeHandler = () => this.buildOverlay();

    this.attachVideo();
    this.buildOverlay();
  }

  getSkippableCategories() {
    const skippableCategories = [];
    if (configRead('enableSponsorBlockSponsor')) {
      skippableCategories.push('sponsor');
    }
    if (configRead('enableSponsorBlockIntro')) {
      skippableCategories.push('intro');
    }
    if (configRead('enableSponsorBlockOutro')) {
      skippableCategories.push('outro');
    }
    if (configRead('enableSponsorBlockInteraction')) {
      skippableCategories.push('interaction');
    }
    if (configRead('enableSponsorBlockSelfPromo')) {
      skippableCategories.push('selfpromo');
    }
    if (configRead('enableSponsorBlockMusicOfftopic')) {
      skippableCategories.push('music_offtopic');
    }
    return skippableCategories;
  }

  attachVideo() {
    clearTimeout(this.attachVideoTimeout);
    this.attachVideoTimeout = undefined;

    this.video = document.querySelector('video');
    if (!this.video) {
      console.info(this.videoID, 'No video yet...');
      this.attachVideoTimeout = setTimeout(() => this.attachVideo(), 100) as unknown as number;
      return;
    }

    console.info(this.videoID, 'Video found, binding...');

    if (this.scheduleSkipHandler) {
      this.video.addEventListener('play', this.scheduleSkipHandler);
      this.video.addEventListener('pause', this.scheduleSkipHandler);
      this.video.addEventListener('timeupdate', this.scheduleSkipHandler);
    } else {
      console.warn('Event handlers not defined for listen');
    }

    if (this.durationChangeHandler) {
      this.video.addEventListener('durationchange', this.durationChangeHandler);
    } else {
      console.warn('Event durationchange handler not defined for listen');
    }
  }

  buildOverlay() {
    if (this.segmentsoverlay) {
      console.info('Overlay already built');
      return;
    }

    if (!this.video || !this.video.duration) {
      console.info('No video duration yet');
      return;
    }

    const videoDuration = this.video.duration;

    const segmentsoverlay = document.createElement('div');

    this.segmentsoverlay = segmentsoverlay;
    this.segments.forEach((segment) => {
      const [start, end] = segment.segment;
      const barType = barTypes[segment.category as keyof typeof barTypes] || {
        color: 'blue',
        opacity: 0.7
      };
      const transform = `translateX(${(start / videoDuration) * 100.0
        }%) scaleX(${(end - start) / videoDuration})`;
      const elm = document.createElement('div');
      elm.classList.add('ytlr-progress-bar__played');
      elm.style['background'] = barType.color;
      elm.style['opacity'] = barType.opacity;
      elm.style.webkitTransform = transform;
      console.info('Generated element', elm, 'from', segment, transform);
      segmentsoverlay.appendChild(elm);
    });

    this.observer = new MutationObserver((mutations) => {
      // console.warn('mutations', mutations);
      mutations.forEach((m) => {
        if (m.removedNodes) {
          for (const node of m.removedNodes) {
            if (node === this.segmentsoverlay) {
              console.info('bringing back segments overlay');
              if (this.slider) {
                this.slider.appendChild(this.segmentsoverlay);
              } else {
                console.warn('slider not defined, skip segment overlay adding');
              }
            }
          }
        }
      });
    });

    this.sliderInterval = setInterval(() => {
      const sliderWithMarkers = document.querySelector('.ytlr-progress-bar__slider-base');
      const sliderWithoutMarkers = document.querySelector('.ytlr-progress-bar__slider');

      console.warn('sliders', sliderWithMarkers, sliderWithoutMarkers);

      if (this.prevSlider) {
        if (this.slider !== this.prevSlider) {
          console.log('this.slider !== this.prevSlider', 'DISCONNECT');
          this.observer?.disconnect();
        }
      }

      this.slider = sliderWithoutMarkers ?? sliderWithMarkers;
      this.prevSlider = this.slider;
      if (this.slider) {
        clearInterval(this.sliderInterval);
        this.sliderInterval = undefined;
        if (this.observer) {
          this.observer.observe(this.slider, {
            childList: true,
          });
        } else {
          console.warn('observer not defined');
        }

        if (sliderWithMarkers) {
          console.info('Apply margin for chapters slider');

          if (this.segmentsoverlay) {
            this.segmentsoverlay.style.marginTop = '-1.19em';
          } else {
            console.warn('segmentsoverlay not defined for apply margin');
          }
        }

        if (this.segmentsoverlay) {
          this.slider.appendChild(this.segmentsoverlay);
        } else {
          console.warn('segmentsoverlay not defined for slider append');
        }
      }
    }, 500) as unknown as number;
  }

  scheduleSkip() {
    clearTimeout(this.nextSkipTimeout);
    this.nextSkipTimeout = undefined;

    if (!this.active) {
      console.info(this.videoID, 'No longer active, ignoring...');
      return;
    }

    if (!this.video) {
      console.warn('video entity not defined, return');
      return;
    }

    if (this.video.paused) {
      console.info(this.videoID, 'scheduleSkip: Currently paused, ignoring...');
      return;
    }

    // Sometimes timeupdate event (that calls scheduleSkip) gets fired right before
    // already scheduled skip routine below. Let's just look back a little bit
    // and, in worst case, perform a skip at negative interval (immediately)...
    const nextSegments = this.segments.filter(
      (seg) =>
        this.video && seg.segment[0] > this.video.currentTime - 0.3 &&
        seg.segment[1] > this.video.currentTime - 0.3
    );
    nextSegments.sort((s1, s2) => s1.segment[0] - s2.segment[0]);

    if (!nextSegments.length) {
      console.info(this.videoID, 'No more segments');
      return;
    }

    const [segment] = nextSegments;
    const [start, end] = segment.segment;
    // console.info(
    //   this.videoID,
    //   'Scheduling skip of',
    //   segment,
    //   'in',
    //   start - this.video.currentTime
    // );

    this.nextSkipTimeout = setTimeout(() => {
      if (this.video?.paused) {
        console.info(this.videoID, 'nextSkipTimeout: Currently paused, ignoring...');
        return;
      }
      if (!this.skippableCategories.includes(segment.category)) {
        console.info(
          this.videoID,
          'Segment',
          segment.category,
          'is not skippable, ignoring...'
        );
        return;
      }

      const skipName = barTypes[segment.category as keyof typeof barTypes]?.name || segment.category;
      console.info(this.videoID, 'Skipping', segment);
      showNotification(`Skipping ${skipName}`);

      if (this.video) {
        this.video.currentTime = end;
      } else {
        console.warn('skipping failed when video is not defined');
      }
      this.scheduleSkip();
    }, (start - this.video.currentTime) * 1000) as unknown as number;
  }

  destroy() {
    console.info(this.videoID, 'Destroying');

    this.active = false;

    if (this.nextSkipTimeout) {
      clearTimeout(this.nextSkipTimeout);
      this.nextSkipTimeout = undefined;
    }

    if (this.attachVideoTimeout) {
      clearTimeout(this.attachVideoTimeout);
      this.attachVideoTimeout = undefined;
    }

    if (this.sliderInterval) {
      clearInterval(this.sliderInterval);
      this.sliderInterval = undefined;
    }

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.segmentsoverlay) {
      this.segmentsoverlay.remove();
      this.segmentsoverlay = null;
    }

    if (this.video) {
      if (this.scheduleSkipHandler) {
        this.video.removeEventListener('play', this.scheduleSkipHandler);
        this.video.removeEventListener('pause', this.scheduleSkipHandler);
        this.video.removeEventListener('timeupdate', this.scheduleSkipHandler);
      } else {
        console.warn('Event handlers not defined for remove listen');
      }

      if (this.durationChangeHandler) {
        this.video.removeEventListener(
          'durationchange',
          this.durationChangeHandler
        );
      } else {
        console.warn('Event durationchange handler not defined for remove listen');
      }
    }
  }
}

// When this global variable was declared using let and two consecutive hashchange
// events were fired (due to bubbling? not sure...) the second call handled below
// would not see the value change from first call, and that would cause multiple
// SponsorBlockHandler initializations... This has been noticed on Chromium 38.
// This either reveals some bug in chromium/webpack/babel scope handling, or
// shows my lack of understanding of javascript. (or both)
(window as any).sponsorblock = null;

window.addEventListener(
  'hashchange',
  () => {
    return;

    const newURL = new URL(location.hash.substring(1), location.href);
    const videoID = newURL.searchParams.get('v');

    const sponsorblockInstance = (window as any).sponsorblock;

    const needsReload =
      videoID &&
      (!sponsorblockInstance || sponsorblockInstance.videoID != videoID);

    console.info(
      'hashchange',
      videoID,
      sponsorblockInstance,
      sponsorblockInstance ? sponsorblockInstance.videoID : null,
      needsReload
    );

    if (needsReload) {
      if (sponsorblockInstance) {
        try {
          sponsorblockInstance.destroy();
        } catch (err) {
          console.warn('window.sponsorblock.destroy() failed!', err);
        }
        (window as any).sponsorblock = null;
      }

      if (configRead('enableSponsorBlock')) {
        (window as any).sponsorblock = new SponsorBlockHandler(videoID);
        (window as any).sponsorblock.init();
      } else {
        console.info('SponsorBlock disabled, not loading');
      }
    }
  },
  false
);


!(window as any).customWatcher && (
  (window as any).customWatcher = new CustomWatcher()
);

console.log('Create CustomWatcher', (window as any).customWatcher);
