import { showNotification } from '../ui';
import { BAR_TYPES } from './constants';
import { fetchSegments, getVideoId } from './utils';
import { VideoEventListener } from './video-event-listener';
import { SliderOverlay } from './slider';
import { SponsorblockSkipper } from './skipper';
import { Segment } from './types';
import { ControlsEventListener } from './controls-button';
import { OverlayEventListener } from './overlay-event-listener';

export const run = () => {
  console.log('user-script.run(): RUNNING...');

  const player = new VideoEventListener();

  const onSkipSegment = (segment: Segment) => {
    let skipName = BAR_TYPES[segment.category]?.name as string | undefined;

    if (!skipName) {
      console.warn('segment category not found in bar types', segment);

      skipName = segment.category;
    }

    showNotification(`Skipping ${skipName}`);
  };

  const onPlayerReady = async () => {
    const video = player.video as HTMLVideoElement;

    const slider = new SliderOverlay({ video });
    const sponsorblock = new SponsorblockSkipper({ video, onSkipSegment });

    const controls = new ControlsEventListener();

    console.log('ControlsEventListener created instance', controls);

    const overlay = new OverlayEventListener();

    console.log('OverlayEventListener created instance', overlay);

    const onPlayerStart = async () => {
      const videoID = getVideoId();

      if (!videoID) {
        throw Error('videoID not found');
      }

      console.log('watch video', videoID);

      const startTime = performance.now();

      const segments = await fetchSegments(videoID);

      const endTime = performance.now();

      const loadTime = endTime - startTime;

      sponsorblock.setSegments(segments, loadTime);

      slider.rebuild(segments);
    };

    const onPlayerClose = () => {
      const videoID = getVideoId();
      sponsorblock.setSegments([]);
      slider.unmount();
      console.log('close video', videoID);
    };

    player.addEventListener('playing', onPlayerStart);
    player.addEventListener('finished', onPlayerClose);

    slider.mount();
  };

  player.addEventListener('ready', onPlayerReady);
  player.addEventListener('error', (e) => {
    console.error('VideoEventListener emited error', e);
  });

  window.addEventListener('hashchange', (event) => {
    // https://www.youtube.com/tv?#/watch?v=pj0hHmMR_yQ
    console.log('user-script.run(): on hashchange', new Date(), [event.oldURL, event.newURL], event);
  });
};
