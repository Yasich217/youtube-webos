// @ts-ignore
import sha256 from 'tiny-sha256';
import { VideoEventListener } from './video-event-listener';
import { SegmentRecord } from './sponsorblock-types';
import { SPONSOR_BLOCK_API } from './constants';
import { SliderComponent } from './slider-event-listener';

const getVideoId = () => {
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

export const run = () => {
  const video = new VideoEventListener();

  video.addEventListener('ready', async (e) => {
    console.log('Event VideoEventListener ready');

    const segments = await fetchSegments();

    if (!segments) {
      throw Error('segments not found');
    }

    const slider = new SliderComponent({
      segments,
      video: video.video as HTMLVideoElement,
    });

    slider.mount();
  })
};
