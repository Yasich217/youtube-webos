import type { FetchFunction } from '@vot.js/core/types/providers/base';

import {
  VOT_PROXY_AUTH_STATE_HEADER,
  VOT_PROXY_AUTH_STATE_INVALID,
  VOTProxyAuthInvalidError
} from './proxy-auth-contract';

const VOT_PROXY_URL = 'http://127.0.0.1:8766/v1/fetch';

function addHeaders(
  target: Record<string, string>,
  headers: HeadersInit | undefined
) {
  if (!headers) return;

  if (headers instanceof Headers) {
    headers.forEach((value, name) => {
      target[name.toLowerCase()] = value;
    });
    return;
  }

  if (Array.isArray(headers)) {
    for (const [name, value] of headers) {
      target[name.toLowerCase()] = value;
    }
    return;
  }

  for (const [name, value] of Object.entries(headers)) {
    target[name.toLowerCase()] = value;
  }
}

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('VOT proxy could not read the request body'));
    });
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('VOT proxy request body read failed'));
    });
    reader.readAsArrayBuffer(blob);
  });
}

async function bodyToArrayBuffer(body: BodyInit | null): Promise<ArrayBuffer> {
  if (body === null) return new ArrayBuffer(0);
  if (body instanceof FormData) {
    throw new TypeError('VOT proxy does not support FormData request bodies');
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    throw new TypeError('VOT proxy does not support streaming request bodies');
  }
  if (body instanceof URLSearchParams) {
    return readBlob(new Blob([body.toString()]));
  }
  return readBlob(body instanceof Blob ? body : new Blob([body as BlobPart]));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, bytes.length);
    let chunk = '';
    for (let index = offset; index < end; index++) {
      chunk += String.fromCharCode(bytes[index]!);
    }
    binary += chunk;
  }

  return window.btoa(binary);
}

function upstreamUrlForLog(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[invalid upstream URL]';
  }
}

async function getBody(
  input: string | URL | Request,
  init: RequestInit | undefined,
  method: string
): Promise<BodyInit | null> {
  if (init?.body !== undefined) return init.body;
  if (input instanceof Request && method !== 'GET' && method !== 'HEAD') {
    return input.clone().blob();
  }
  return null;
}

export const votProxyFetch: FetchFunction = async (input, init) => {
  const request = input instanceof Request ? input : null;
  const upstreamUrl = request?.url ?? input.toString();
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {};
  addHeaders(headers, request?.headers);
  addHeaders(headers, init?.headers);
  const livelyRequest = headers['x-yasich-vot-lively'] === '1';

  const body = await getBody(input, init, method);
  const proxyInit: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: upstreamUrl,
      method,
      headers,
      bodyBase64: arrayBufferToBase64(await bodyToArrayBuffer(body))
    })
  };
  const signal = init?.signal ?? request?.signal;
  if (signal) proxyInit.signal = signal;

  console.debug('[VOT] proxy request', method, upstreamUrlForLog(upstreamUrl));
  const response = await window.fetch(VOT_PROXY_URL, proxyInit);
  if (
    livelyRequest &&
    (response.status === 401 || response.status === 403) &&
    response.headers.get(VOT_PROXY_AUTH_STATE_HEADER) ===
      VOT_PROXY_AUTH_STATE_INVALID
  ) {
    throw new VOTProxyAuthInvalidError();
  }
  return response;
};
