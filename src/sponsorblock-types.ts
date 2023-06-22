export interface SegmentRecord {
  videoID: string
  segments: Segment[]
}

export interface Segment {
  category: string
  actionType: string
  segment: number[]
  UUID: string
  videoDuration: number
  locked: number
  votes: number
  description: string
}