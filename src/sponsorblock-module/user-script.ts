import { showNotification } from '../ui';
import { BAR_TYPES } from './constants';
import { fetchSegments, getVideoId } from './utils';
import { VideoEventListener } from './video-event-listener';
import { SliderOverlay } from './slider';
import { SponsorblockSkipper } from './skipper';
import { Segment } from './types';
import { ControlsEventListener } from './controls-button';

export const run = () => {
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

    const onPlayerStart = async () => {
      const videoID = getVideoId();

      if (!videoID) {
        throw Error('videoID not found');
      }

      console.log('watch video', videoID);

      const segments = await fetchSegments(videoID);

      sponsorblock.setSegments(segments);

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
};
