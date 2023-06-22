export class SponsorblockSkipper extends EventTarget {
  video: HTMLVideoElement;
  observer?: MutationObserver;

  constructor(video: HTMLVideoElement) {
    super();

    this.video = video;

    this.video.addEventListener('play', this.onPlayEvent);
    this.video.addEventListener('pause', this.onPauseEvent);
    this.video.addEventListener('timeupdate', this.onTimeupdateEvent);
    this.video.addEventListener('durationchange', this.onDurationChangeEvent);
  }

  onPlayEvent = (...args: unknown[]) => { console.log('SponsorblockSkipper play event', args) }
  onPauseEvent = (...args: unknown[]) => { console.log('SponsorblockSkipper pause event', args) }
  onDurationChangeEvent = (...args: unknown[]) => { console.log('SponsorblockSkipper timeupdate event', args) }
  onTimeupdateEvent = (...args: unknown[]) => { console.log('SponsorblockSkipper durationchange event', args) }
}
