import { BAR_TYPES } from './constants';

export interface SegmentRecord {
  segments: Segment[];
  videoID: string;
};

export interface Segment {
  actionType: string;
  category: keyof typeof BAR_TYPES;
  description: string;
  locked: number;
  segment: number[];
  UUID: string;
  videoDuration: number;
  votes: number;
};

export const enum SliderType {
  Chapters = 'chapters',
  Default = 'default'
};
