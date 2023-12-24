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

    let lastVideoId: string | null = null;

    const onPlayerStart = async () => {
      lastVideoId = getVideoId();

      if (!lastVideoId) {
        throw Error('videoID not found');
      }

      console.log('watch video', lastVideoId);

      const startTime = performance.now();

      const segments = await fetchSegments(lastVideoId);

      const endTime = performance.now();

      const loadTime = endTime - startTime;

      sponsorblock.setSegments(segments, loadTime);

      slider.rebuild(segments);
    };

    const onPlayerClose = () => {
      sponsorblock.setSegments([]);
      slider.unmount();
      console.log('close video', lastVideoId);
    };

    player.addEventListener('playing', onPlayerStart);
    player.addEventListener('finished', onPlayerClose);

    slider.mount();
  };

  player.addEventListener('ready', onPlayerReady);
  player.addEventListener('error', (e) => {
    console.error('VideoEventListener emited error', e);
  });
};
