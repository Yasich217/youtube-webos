const AUDIO_SERVICE_URL = 'http://127.0.0.1:8767';

export type AudioPlaybackState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export interface AudioServiceStatus {
  ok: boolean;
  service?: string;
  ready?: boolean;
  state: AudioPlaybackState;
  loaded: boolean;
  position: number;
  duration: number;
  leaseRemainingMs: number;
  volume: number;
  lastError: string | null;
  videoId?: string | null;
  outputModule?: string | null;
  outputDevice?: string | null;
  mixEnabled?: boolean;
  mixerBackend?: 'modern' | 'legacy' | null;
}

export interface AudioLoadRequest {
  audioUrl: string;
  videoId: string;
  volume: number;
}

export interface AudioPositionRequest {
  videoId: string;
  position: number;
  clientTimestampMs: number;
  playbackRate: number;
}

export interface AudioPlayRequest extends AudioPositionRequest {
  leaseMs: number;
  volume: number;
}

export interface AudioSeekRequest extends AudioPositionRequest {
  resume: boolean;
  leaseMs?: number;
}

export interface AudioHeartbeatRequest extends AudioPositionRequest {
  leaseMs: number;
}

export interface AudioVolumeRequest {
  videoId: string;
  volume: number;
}

export class AudioServiceError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'AudioServiceError';
    this.status = status;
    this.data = data;
  }
}

function isErrorResponse(value: unknown): value is { error: string } {
  return !!(
    value &&
    typeof value === 'object' &&
    'error' in value &&
    typeof value.error === 'string'
  );
}

export class VOTAudioServiceClient {
  async #request(
    path: string,
    method: 'GET' | 'POST',
    body?: object,
    keepalive = false
  ): Promise<AudioServiceStatus> {
    const init: RequestInit = { method };
    if (body) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    if (keepalive) init.keepalive = true;

    const response = await window.fetch(`${AUDIO_SERVICE_URL}${path}`, init);
    let data: unknown = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new AudioServiceError(
          'Audio service returned invalid JSON',
          response.status,
          { cause: error, body: text }
        );
      }
    }

    if (!response.ok) {
      throw new AudioServiceError(
        isErrorResponse(data)
          ? data.error
          : `Audio service request failed (${response.status})`,
        response.status,
        data
      );
    }

    return data as AudioServiceStatus;
  }

  status(): Promise<AudioServiceStatus> {
    return this.#request('/v1/status', 'GET');
  }

  load(request: AudioLoadRequest): Promise<AudioServiceStatus> {
    return this.#request('/v1/load', 'POST', {
      url: request.audioUrl,
      audioUrl: request.audioUrl,
      videoId: request.videoId,
      volume: request.volume
    });
  }

  play(request: AudioPlayRequest): Promise<AudioServiceStatus> {
    return this.#request('/v1/play', 'POST', request);
  }

  pause(request: AudioPositionRequest): Promise<AudioServiceStatus> {
    return this.#request('/v1/pause', 'POST', request);
  }

  seek(request: AudioSeekRequest): Promise<AudioServiceStatus> {
    return this.#request('/v1/seek', 'POST', request);
  }

  stop(videoId: string | null, keepalive = false): Promise<AudioServiceStatus> {
    return this.#request(
      '/v1/stop',
      'POST',
      videoId ? { videoId } : {},
      keepalive
    );
  }

  heartbeat(request: AudioHeartbeatRequest): Promise<AudioServiceStatus> {
    return this.#request('/v1/heartbeat', 'POST', request);
  }

  volume(request: AudioVolumeRequest): Promise<AudioServiceStatus> {
    return this.#request('/v1/volume', 'POST', request);
  }
}
