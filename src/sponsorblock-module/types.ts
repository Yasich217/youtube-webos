import { BAR_TYPES } from "./constants"

export interface SegmentRecord {
  videoID: string
  segments: Segment[]
}

export interface Segment {
  category: keyof typeof BAR_TYPES
  actionType: string
  segment: number[]
  UUID: string
  videoDuration: number
  locked: number
  votes: number
  description: string
}