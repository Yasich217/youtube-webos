import { getVideoId } from './utils';
import { Segment } from './types';

interface SponsorblockSkipperProps {
  onSkipSegment: (segment: Segment) => void;
  video: HTMLVideoElement;
}

export class SponsorblockSkipper {
  handleSkipSegment: (segment: Segment) => void;
  observer?: MutationObserver;
  segments: Segment[] = [];
  video: HTMLVideoElement;
  videoID: string;

  constructor({ video, onSkipSegment }: SponsorblockSkipperProps) {
    this.handleSkipSegment = onSkipSegment;

    this.video = video;

    const videoID = getVideoId();

    if (!videoID) {
      throw new Error('get videoID failed');
    }

    this.videoID = videoID;

    this.video.addEventListener('timeupdate', this.onTimeupdateEvent);
  }

  setSegments = (segments: Segment[]) => {
    this.segments = segments;
  }

  onTimeupdateEvent = (e: Event) => {
    const gap = 0.5;
    const currentTime = this.video.currentTime;
    // Sometimes timeupdate event (that calls scheduleSkip) gets fired right before
    // already scheduled skip routine below. Let's just look back a little bit
    // and, in worst case, perform a skip at negative interval (immediately)...
    const nextSegments = this.segments
      .filter(({ segment: [start, end] }) => start > currentTime - gap && end > currentTime - gap)
      .sort(({ segment: [a] }, { segment: [b] }) => a - b);

    if (!nextSegments.length) {
      // console.info(this.videoID, 'No more segments', this.segments.length);

      return;
    }

    const [segment] = nextSegments;
    const [start, end] = segment.segment;

    if (currentTime - gap <= start && currentTime + gap >= start) {
      this.video.currentTime = end;

      console.info(this.videoID, 'Skipping', segment);
      this.handleSkipSegment(segment);
    }
  }
}
