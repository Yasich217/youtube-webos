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
  delta: number;

  constructor({ video, onSkipSegment }: SponsorblockSkipperProps) {
    this.handleSkipSegment = onSkipSegment;

    this.video = video;

    this.delta = 0;

    const videoID = getVideoId();

    if (!videoID) {
      throw new Error('get videoID failed');
    }

    this.videoID = videoID;

    this.video.addEventListener('timeupdate', this.onTimeupdateEvent);
  }

  setSegments = (segments: Segment[], delta = this.delta) => {
    this.segments = segments;
    this.delta = delta;

    /** Сбрасываем дельту, если ее не сбросили раньше? */
    setTimeout(() => {
      /** Вдруг уже установили с другим значением? */
      if (this.delta === delta) {
        this.delta = 0;
      }
    }, delta);

    console.log('SponsorblockSkipper.setSegments() load time:', delta);
  }

  onTimeupdateEvent = (e: Event) => {
    const factor = (this.delta / 1000);
    const gap = 0.5;
    const currentTime = this.video.currentTime;
    // Sometimes timeupdate event (that calls scheduleSkip) gets fired right before
    // already scheduled skip routine below. Let's just look back a little bit
    // and, in worst case, perform a skip at negative interval (immediately)...
    const nextSegments = this.segments
      .filter(({ segment: [start, end] }) => start > (currentTime - gap - factor) && end > currentTime - gap)
      .sort(({ segment: [a] }, { segment: [b] }) => a - b);

    if (!nextSegments.length) {
      console.info('SponsorblockSkipper.onTimeupdateEvent():', this.videoID, 'No more segments', this.segments.length);

      return;
    }

    const [segment] = nextSegments;
    const [start, end] = segment.segment;

    if (currentTime - gap <= start && currentTime + gap >= start) {
      this.video.currentTime = end;

      // Сбрасываем дельту после скипа.
      this.delta = 0;

      console.info('SponsorblockSkipper.onTimeupdateEvent():', this.videoID, 'Skipping', segment);
      this.handleSkipSegment(segment);
    }
  }
}
