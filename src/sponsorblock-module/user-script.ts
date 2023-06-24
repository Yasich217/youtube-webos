// @ts-ignore
import sha256 from 'tiny-sha256';
import { VideoEventListener } from './video-event-listener';
import { SegmentRecord } from './types';
import { SPONSOR_BLOCK_API } from '../constants';
import { SliderComponent } from './slider-event-listener';
import { SponsorblockSkipper } from './skipper';

export const getVideoId = () => {
  const newURL = new URL(location.hash.substring(1), location.href);
  const videoID = newURL.searchParams.get('v');

  return videoID;
}

const fetchSegments = async () => {
  const videoID = getVideoId();

  if (!videoID) {
    throw Error('videoID not found');
  }

  const videoHash = sha256(videoID).substring(0, 4);
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
      `${SPONSOR_BLOCK_API}/skipSegments/${videoHash}?categories=${encodeURIComponent(
        JSON.stringify(categories)
      )}`
    );
    results = await response.json() as SegmentRecord[];
  } catch (e) {
    console.error('loadSegments: fetch error', e);
  }

  const result = results.find((v) => v.videoID === videoID);

  if (!result || !result.segments || !result.segments.length) {
    console.info(videoID, 'No segments found.');

    return;
  }

  console.info(videoID, 'Got it:', result);

  return result.segments;
}

const getSegments = async () => {
  const segments = await fetchSegments();

  if (!segments?.length) {
    throw Error('segments not found');
  }

  return segments;
}

export const run = () => {
  const player = new VideoEventListener();

  player.addEventListener('error', (e) => {
    console.error('VideoEventListener emit error', e);
  });

  player.addEventListener('ready', async (e) => {
    const video = player.video;

    if (!video) {
      throw Error('video tag required');
    }

    const slider = new SliderComponent({ video });

    const sponsorblock = new SponsorblockSkipper({ video });

    console.log('sponsorblock instance', sponsorblock);

    player.addEventListener('playing', async () => {
      const videoID = getVideoId();

      console.log('watch video', videoID);

      const segments = await getSegments();

      sponsorblock.setSegments(segments);

      slider.rebuild(segments);
    });

    player.addEventListener('finished', () => {
      const videoID = getVideoId();
      sponsorblock.setSegments([]);
      slider.unmount();
      console.log('close video', videoID);
    });

    slider.mount();
  });
};
