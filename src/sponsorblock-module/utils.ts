// @ts-ignore
import sha256 from 'tiny-sha256';
import { SPONSOR_BLOCK_API } from './constants';
import { SegmentRecord } from './types';

export const getVideoId = () => {
  const newURL = new URL(location.hash.substring(1), location.href);
  const videoID = newURL.searchParams.get('v');

  return videoID;
};

export const fetchSegments = async (videoID: string) => {
  const videoHash = sha256(videoID)?.substring(0, 4);
  const categories = [
    'sponsor',
    'intro',
    'outro',
    'interaction',
    'selfpromo',
    'music_offtopic'
  ];

  try {
    const response = await fetch(
      `${SPONSOR_BLOCK_API}/skipSegments/${videoHash}?categories=${encodeURIComponent(
        JSON.stringify(categories)
      )}`
    );

    const results = await response.json() as SegmentRecord[];

    const result = results.find((v) => v.videoID === videoID);

    if (!result || !result.segments || !result.segments.length) {
      console.info(videoID, 'No segments found.', results);

      return [];
    }

    console.info(videoID, 'Got it:', result);

    return result.segments;
  } catch (e) {
    console.warn(videoID, 'fetchSegments error', e);

    return [];
  }
};
