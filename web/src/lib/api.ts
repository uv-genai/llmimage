/** The only module that talks to the backend proxy.

Request bodies are built by `lib/params.ts` (which owns what OpenAI accepts) and handed
here already encoded, so this file deals with exactly two shapes: JSON and FormData.
*/

import { fromUpstreamUrl, makeStudioImage } from './images';
import {
  ApiError,
  type ConnectionTarget,
  type ImagesResponse,
  type ModelInfo,
  type OutputFormat,
  type Profile,
  type StudioImage,
  type TaskKind,
  type Usage,
} from './types';
import { TASKS } from './presets';

export interface PartialImageEvent {
  image: StudioImage;
  index: number;
}

export interface RunOutcome {
  images: StudioImage[];
  usage?: Usage;
  revisedPrompt?: string;
  outputFormat?: OutputFormat;
  background?: string;
  created?: number;
  streamed: boolean;
  /** True when `stream: true` was sent but the endpoint answered with plain JSON, so no
   * partial previews were possible — tolerant multipart gateways do exactly this. */
  streamIgnored?: boolean;
  durationMs: number;
}

export interface RunSpec {
  kind: TaskKind;
  target: ConnectionTarget;
  /** A JSON string, or FormData for the multipart endpoints. */
  body: BodyInit;
  json: boolean;
  /** Whether the request asked for SSE; lets a plain-JSON reply be reported honestly. */
  stream: boolean;
  outputFormat: OutputFormat;
  signal: AbortSignal;
  onPartial?: (event: PartialImageEvent) => void;
}

function targetHeaders(target: ConnectionTarget): Record<string, string> {
  const headers: Record<string, string> = {};
  if (target.profileId) headers['X-Profile-Id'] = target.profileId;
  if (target.baseUrl) headers['X-Base-Url'] = target.baseUrl;
  if (target.apiKey) headers['X-Api-Key'] = target.apiKey;
  return headers;
}

async function readError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string; code?: string; type?: string } };
    if (parsed.error?.message) {
      // OpenAI puts the kind in `error.type`; fall back to it so toasts and advice stay specific.
      return new ApiError(
        parsed.error.message,
        response.status,
        parsed.error.code ?? parsed.error.type ?? '',
        parsed.error.type ?? '',
      );
    }
  } catch {
    /* body was not the OpenAI error envelope; fall back to the raw text */
  }
  const trimmed = text.trim().slice(0, 400);
  return new ApiError(trimmed || `request failed with HTTP ${response.status}`, response.status, `http_${response.status}`);
}

/** Server-sent events, one {event,data} per frame. Tolerates CRLF and keep-alive comments. */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = '';
        const dataLines: string[] = [];
        for (const rawLine of frame.split('\n')) {
          const line = rawLine.replace(/\r$/, '');
          if (!line || line.startsWith(':')) continue;
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length) yield { event, data: dataLines.join('\n') };
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function decodeBase64(b64: string, format: OutputFormat): Blob {
  const binary = atob(b64.replace(/^data:[^,]+,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  return new Blob([bytes], { type: mime });
}

async function decodeImages(
  response: ImagesResponse,
  fallbackFormat: OutputFormat,
): Promise<{ images: StudioImage[]; revisedPrompt?: string }> {
  const format = response.output_format ?? fallbackFormat;
  const images: StudioImage[] = [];
  let revisedPrompt: string | undefined;
  for (const item of response.data ?? []) {
    if (item.revised_prompt) revisedPrompt = item.revised_prompt;
    if (item.b64_json) images.push(await makeStudioImage(decodeBase64(item.b64_json, format), format));
    else if (item.url) images.push(fromUpstreamUrl(item.url, format));
  }
  return { images, revisedPrompt };
}

/** One image call, streaming or not. Partials are reported as they land. */
export async function runImageTask(spec: RunSpec): Promise<RunOutcome> {
  const started = performance.now();
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    ...targetHeaders(spec.target),
  };
  if (spec.json) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`/api/${TASKS[spec.kind].endpoint}`, {
      method: 'POST',
      headers,
      body: spec.body,
      signal: spec.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(`Could not reach the llmimage backend: ${(error as Error).message}`, 0, 'backend_unreachable');
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    if (!response.body) throw new ApiError('The streaming response had no body.', 0, 'empty_stream');
    return consumeStream(response.body, spec, started);
  }
  if (!response.ok) throw await readError(response);

  const payload = (await response.json()) as ImagesResponse;
  const decoded = await decodeImages(payload, spec.outputFormat);
  if (!decoded.images.length) throw new ApiError('The endpoint returned no images.', response.status, 'empty_result');
  return {
    images: decoded.images,
    usage: payload.usage,
    revisedPrompt: decoded.revisedPrompt,
    outputFormat: payload.output_format,
    background: payload.background,
    created: payload.created,
    streamed: false,
    // The endpoint answered with JSON although a stream was requested: the images are
    // valid, but there were no partial previews, so say so instead of pretending.
    streamIgnored: spec.stream ? true : undefined,
    durationMs: performance.now() - started,
  };
}

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  spec: RunSpec,
  started: number,
): Promise<RunOutcome> {
  let completed: (ImagesResponse & { b64_json?: string }) | null = null;
  let streamError: { message: string; code: string } | null = null;
  let frames = 0;

  for await (const frame of readSse(body)) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(frame.data) as Record<string, unknown>;
    } catch {
      continue; // keep-alive comment or a frame the provider left unterminated
    }
    const name = frame.event || (typeof data.type === 'string' ? data.type : '');
    frames += 1;

    if (name.includes('partial_image')) {
      const b64 = typeof data.b64_json === 'string' ? data.b64_json : '';
      const index = typeof data.partial_image_index === 'number' ? data.partial_image_index : frames;
      if (b64 && spec.onPartial) {
        const image = await makeStudioImage(decodeBase64(b64, spec.outputFormat), spec.outputFormat, {
          partialIndex: index,
        });
        spec.onPartial({ image, index });
      }
      continue;
    }

    if (name === 'error') {
      streamError = {
        message: typeof data.message === 'string' ? data.message : 'The endpoint reported an error',
        code: typeof data.code === 'string' ? data.code : 'stream_error',
      };
      break;
    }

    if (name.includes('completed')) {
      completed = data as unknown as ImagesResponse & { b64_json?: string };
      if (!completed.data && typeof completed.b64_json === 'string') {
        completed.data = [{ b64_json: completed.b64_json }];
      }
      break;
    }
  }

  if (streamError) throw new ApiError(streamError.message, 0, streamError.code, 'stream');
  if (!completed) {
    throw new ApiError(
      frames
        ? 'The stream ended before a completed event arrived — the upstream may have crashed mid-generation.'
        : 'The stream produced no events.',
      0,
      'incomplete_stream',
    );
  }

  const decoded = await decodeImages(completed, spec.outputFormat);
  if (!decoded.images.length) throw new ApiError('The stream completed without an image.', 0, 'empty_result');
  return {
    images: decoded.images,
    usage: completed.usage,
    revisedPrompt: decoded.revisedPrompt,
    outputFormat: completed.output_format,
    background: completed.background,
    created: completed.created,
    streamed: true,
    durationMs: performance.now() - started,
  };
}

/** GET /v1/models, through the proxy (the browser cannot call it directly). */
export async function fetchModels(target: ConnectionTarget): Promise<{ models: ModelInfo[]; latencyMs: number }> {
  const started = performance.now();
  const response = await fetch('/api/models', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...targetHeaders(target) },
    body: '{}',
  });
  if (!response.ok) throw await readError(response);
  const payload = (await response.json()) as { data?: Array<Record<string, unknown>> };
  const models: ModelInfo[] = (payload.data ?? [])
    .map((item) => ({
      id: String(item.id ?? ''),
      created: typeof item.created === 'number' ? item.created : undefined,
      ownedBy: typeof item.owned_by === 'string' ? item.owned_by : undefined,
      description: typeof item.description === 'string' ? item.description : undefined,
    }))
    .filter((item) => item.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  return { models, latencyMs: performance.now() - started };
}

export interface BackendInfo {
  ok: boolean;
  version: string;
  web_ready: boolean;
  endpoints: string[];
  allowed_hosts: string[];
  request_timeout_seconds: number;
}

export interface BackendConfig {
  version: string;
  defaults: { base_url: string; has_api_key: boolean; api_key_preview: string };
  profiles: Profile[];
  active_profile_id: string;
}

export async function fetchHealth(): Promise<BackendInfo> {
  const response = await fetch('/api/health');
  if (!response.ok) throw new ApiError('The llmimage backend is not responding', response.status);
  return (await response.json()) as BackendInfo;
}

export async function fetchBackendConfig(): Promise<BackendConfig> {
  const response = await fetch('/api/config');
  if (!response.ok) throw new ApiError('Could not read the backend configuration', response.status);
  return (await response.json()) as BackendConfig;
}

async function profileRequest(path: string, init?: RequestInit): Promise<Profile[]> {
  const response = await fetch(path, init);
  if (!response.ok) throw await readError(response);
  return ((await response.json()) as { profiles: Profile[] }).profiles;
}

export function saveProfile(input: {
  id?: string;
  name: string;
  base_url: string;
  api_key?: string;
}): Promise<Profile[]> {
  return profileRequest('/api/profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteProfile(id: string): Promise<Profile[]> {
  return profileRequest(`/api/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function activateProfile(id: string): Promise<Profile[]> {
  return profileRequest(`/api/profiles/${encodeURIComponent(id)}/activate`, { method: 'POST' });
}
