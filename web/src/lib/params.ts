/** Build real OpenAI request payloads (and their curl equivalent) from form state.

The rule the whole app is built around: a field is sent only when the user actually
chose it. Providers are inconsistent about unknown fields — stable-diffusion.cpp based
gateways answer 400 for anything they do not model — so `inherit`/default values are
dropped instead of being null-filled.
*/

import { DEFAULT_PARAMS, TASKS } from './presets';
import type { ImageParams, OutputFormat, ReferenceImage, TaskKind } from './types';

export const CUSTOM_SIZE = 'custom';

export interface ParsedSize {
  width: number;
  height: number;
}

export function parseSize(size: string): ParsedSize | null {
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(size.trim());
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function extraJsonError(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return `Extra parameters are not valid JSON: ${(error as Error).message}`;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'Extra parameters must be a JSON object, e.g. {"seed": 42}';
  }
  return null;
}

function mergeExtra(body: Record<string, unknown>, raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (!text) return body;
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return { ...body, ...parsed };
}

/** Fields shared by generation and editing, with provider defaults left out. */
function sharedFields(params: ImageParams): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (params.model.trim()) body.model = params.model.trim();
  if (params.n !== DEFAULT_PARAMS.n) body.n = params.n;
  if (params.size.trim()) body.size = params.size.trim();
  if (params.quality !== DEFAULT_PARAMS.quality) body.quality = params.quality;
  if (params.background !== DEFAULT_PARAMS.background) body.background = params.background;
  if (params.moderation !== DEFAULT_PARAMS.moderation) body.moderation = params.moderation;
  if (params.outputFormat !== DEFAULT_PARAMS.outputFormat) body.output_format = params.outputFormat;
  if (params.outputFormat !== 'png' && params.outputCompression !== DEFAULT_PARAMS.outputCompression) {
    body.output_compression = params.outputCompression;
  }
  if (params.responseFormat !== DEFAULT_PARAMS.responseFormat) body.response_format = params.responseFormat;
  if (params.legacyStyle !== DEFAULT_PARAMS.legacyStyle) body.style = params.legacyStyle;
  if (params.user.trim()) body.user = params.user.trim();
  if (params.stream) {
    body.stream = true;
    if (params.partialImages > 0) body.partial_images = params.partialImages;
  }
  // Not OpenAI, but the two fields local gateways actually need.
  if (params.negativePrompt.trim()) body.negative_prompt = params.negativePrompt.trim();
  if (params.strength !== null) body.strength = params.strength;
  return body;
}

export function buildGenerationBody(params: ImageParams): Record<string, unknown> {
  return mergeExtra({ ...sharedFields(params), prompt: params.prompt }, params.extraJson);
}

/** Edits for gpt-image accept input_fidelity; dall-e-2 style providers do not. */
export function buildEditBody(params: ImageParams): Record<string, unknown> {
  const body = buildGenerationBody(params);
  if (params.inputFidelity !== DEFAULT_PARAMS.inputFidelity) body.input_fidelity = params.inputFidelity;
  return body;
}

export function buildVariationBody(params: ImageParams): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (params.model.trim()) body.model = params.model.trim();
  if (params.n !== DEFAULT_PARAMS.n) body.n = params.n;
  if (params.size.trim()) body.size = params.size.trim();
  if (params.responseFormat !== DEFAULT_PARAMS.responseFormat) body.response_format = params.responseFormat;
  if (params.user.trim()) body.user = params.user.trim();
  return mergeExtra(body, params.extraJson);
}

/**
 * Multipart body for the edits/variations endpoints.
 *
 * The OpenAI SDKs send `image[]` for the repeatable field and `image` for the single
 * image of the legacy variations route; both are mirrored here so gateways that copied
 * either shape keep working. Field values are strings only — the browser owns the
 * multipart boundary, which is why the proxy never re-encodes the body.
 */
export function buildMultipart(
  kind: TaskKind,
  params: ImageParams,
  images: ReferenceImage[],
  mask: Blob | null,
): { form: FormData; body: Record<string, string> } {
  const scalar = kind === 'edit' ? buildEditBody(params) : buildVariationBody(params);
  const form = new FormData();
  const sent: Record<string, string> = {};

  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    const text = String(value);
    form.append(key, text);
    sent[key] = text;
  };

  for (const [key, value] of Object.entries(scalar)) {
    if (key === 'prompt') continue;
    if (typeof value === 'boolean') add(key, value ? 'true' : 'false');
    else if (typeof value === 'object') add(key, JSON.stringify(value));
    else add(key, value);
  }

  if (kind === 'edit' && params.prompt.trim()) add('prompt', params.prompt);

  images.forEach((image, index) => {
    const field = kind === 'edit' ? 'image[]' : 'image';
    const name = image.name || `image-${index + 1}.png`;
    form.append(field, image.blob, name);
    sent[field] = sent[field] ? `${sent[field]}, ${name}` : name;
  });

  if (mask) {
    form.append('mask', mask, 'mask.png');
    sent.mask = 'mask.png';
  }

  return { form, body: sent };
}

export interface BuiltRequest {
  method: 'POST';
  url: string;
  contentType: string;
  payload: string;
}

/** curl reproduction of the exact request, credentials masked. */
export function toCurl(
  kind: TaskKind,
  params: ImageParams,
  baseUrl: string,
  images: ReferenceImage[],
  mask: Blob | null,
  hasKey: boolean,
): BuiltRequest {
  const root = baseUrl.trim().replace(/\/+$/, '') || 'http://127.0.0.1:8080/v1';
  const url = `${root}/${TASKS[kind].endpoint}`;
  const auth = hasKey ? ' \\\n  -H "Authorization: Bearer $OPENAI_API_KEY"' : '';

  if (kind === 'generate') {
    const json = JSON.stringify(buildGenerationBody(params), null, 2);
    return {
      method: 'POST',
      url,
      contentType: 'application/json',
      payload: `curl -X POST "${url}" \\${auth} \\\n  -H "Content-Type: application/json" \\\n  -d '${json}'`,
    };
  }

  const { body } = buildMultipart(kind, params, images, mask);
  const args = Object.entries(body).map(([key, value]) => `  -F "${key}=${value}"`);
  const files = images.map((image, index) => {
    const field = kind === 'edit' ? 'image[]' : 'image';
    const name = image.name || `image-${index + 1}.png`;
    return `  -F "${field}=@${name};type=${image.blob.type || 'image/png'}"`;
  });
  const maskArg = mask ? ['  -F "mask=@mask.png;type=image/png"'] : [];
  return {
    method: 'POST',
    url,
    contentType: 'multipart/form-data',
    payload: [`curl -X POST "${url}" \\${auth}`, ...args, ...files, ...maskArg].join(' \\\n'),
  };
}

export interface ParamIssue {
  level: 'error' | 'warning';
  text: string;
}

/** Pre-flight checks. Errors block the run; warnings only show a hint. */
export function validate(kind: TaskKind, params: ImageParams, images: ReferenceImage[], mask: Blob | null): ParamIssue[] {
  const issues: ParamIssue[] = [];
  const extra = extraJsonError(params.extraJson);
  if (extra) issues.push({ level: 'error', text: extra });

  if (kind === 'generate' && !params.prompt.trim()) {
    issues.push({ level: 'error', text: 'A prompt is required for generation.' });
  }
  if (kind === 'edit' && !params.prompt.trim()) {
    issues.push({ level: 'error', text: 'Describe the edit — the prompt is the instruction.' });
  }
  if (TASKS[kind].needsUpload && images.length === 0) {
    issues.push({ level: 'error', text: 'Add at least one image to upload.' });
  }
  if (kind === 'vary' && images.length > 1) {
    issues.push({ level: 'warning', text: 'Variations takes a single image; only the first is sent.' });
  }
  if (params.background === 'transparent' && params.outputFormat === 'jpeg') {
    issues.push({ level: 'warning', text: 'Transparent background needs png or webp; jpeg has no alpha.' });
  }
  if (params.partialImages > 0 && !params.stream) {
    issues.push({ level: 'warning', text: 'Partial images only apply when streaming is on.' });
  }
  if (kind !== 'edit' && params.inputFidelity !== 'inherit') {
    issues.push({ level: 'warning', text: 'input_fidelity only applies to edits.' });
  }
  if (mask && kind !== 'edit') {
    issues.push({ level: 'warning', text: 'Masks are only sent with edits.' });
  }
  if (params.stream && params.n > 1) {
    issues.push({ level: 'warning', text: 'Streaming returns one image per request on most providers.' });
  }
  const size = parseSize(params.size);
  if (params.size !== 'auto' && !size) {
    issues.push({ level: 'error', text: `Size "${params.size}" is not WIDTHxHEIGHT, e.g. 1024x1024.` });
  }
  if (size && (size.width % 16 !== 0 || size.height % 16 !== 0)) {
    issues.push({ level: 'warning', text: 'GPT image sizes must be divisible by 16 (local engines often want 32).' });
  }
  if (params.n > 10) {
    issues.push({ level: 'error', text: 'n must be between 1 and 10.' });
  }
  return issues;
}

export function formatSizeLabel(size: string): string {
  const parsed = parseSize(size);
  if (!parsed) return size;
  return `${parsed.width}×${parsed.height}`;
}

export function extensionFor(format: OutputFormat | undefined): string {
  return format === 'jpeg' ? 'jpg' : (format ?? 'png');
}

export function mergeParams(base: Partial<ImageParams> | undefined, fallback: ImageParams): ImageParams {
  return { ...fallback, ...(base ?? {}) };
}
