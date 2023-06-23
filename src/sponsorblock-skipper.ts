import { BAR_TYPES } from "./constants";
import { Segment } from "./sponsorblock-types";
import { getVideoId } from "./user-script";

interface SponsorblockSkipperProps {
  video: HTMLVideoElement;
}

export class SponsorblockSkipper extends EventTarget {
  video: HTMLVideoElement;
  segments: Segment[] = [];
  observer?: MutationObserver;
  videoID: string;

  constructor({ video }: SponsorblockSkipperProps) {
    super();

    this.video = video;

    const videoID = getVideoId();

    if (!videoID) {
      throw Error('get videoID failed');
    }

    this.videoID = videoID;

    // this.video.addEventListener('play', this.onPlayEvent);
    // this.video.addEventListener('pause', this.onPauseEvent);
    this.video.addEventListener('timeupdate', this.onTimeupdateEvent);
    // this.video.addEventListener('durationchange', this.onDurationChangeEvent);
  }

  setSegments = (segments: Segment[]) => {
    this.segments = segments;
  }

  // onPlayEvent = (...args: unknown[]) => { console.log('SponsorblockSkipper play event', args) }
  // onPauseEvent = (...args: unknown[]) => { console.log('SponsorblockSkipper pause event', args) }
  // onDurationChangeEvent = (...args: unknown[]) => { console.log('SponsorblockSkipper durationchange event', args)  }

  getNextSegment = () => {

  }

  onTimeupdateEvent = (e: Event) => {
    const koef = 0.5;
    // Sometimes timeupdate event (that calls scheduleSkip) gets fired right before
    // already scheduled skip routine below. Let's just look back a little bit
    // and, in worst case, perform a skip at negative interval (immediately)...
    const nextSegments = this.segments.filter(
      ({ segment: [start, end] }) =>
        start > this.video.currentTime - koef &&
        end > this.video.currentTime - koef
    );
    nextSegments.sort((s1, s2) => s1.segment[0] - s2.segment[0]);

    if (!nextSegments.length) {
      console.info(this.videoID, 'No more segments', this.segments.length);

      return;
    }

    const [segment] = nextSegments;
    const [start, end] = segment.segment;

    if (this.video.currentTime - koef <= start && this.video.currentTime + koef >= start) {
      const skipName = BAR_TYPES[segment.category]?.name ?? segment.category;
      console.info(this.videoID, 'Skipping', segment);
      (window as any).sendUiNotifyMessage(`Skipping ${skipName}`);
      this.video.currentTime = end;
    }
  }

}
