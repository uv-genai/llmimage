/** Shapes shared by the UI, the payload builders and the proxy client. */

export type TaskKind = 'generate' | 'edit' | 'vary';
export type OutputFormat = 'png' | 'jpeg' | 'webp';
export type Quality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type Background = 'auto' | 'transparent' | 'opaque';
export type Moderation = 'auto' | 'low';
/** `inherit` means "do not send the field" so strict providers do not reject it. */
export type TriState = 'inherit' | 'low' | 'high';
export type ResponseFormat = 'inherit' | 'b64_json' | 'url';
export type LegacyStyle = 'inherit' | 'vivid' | 'natural';

export interface ImageParams {
  model: string;
  prompt: string;
  negativePrompt: string;
  n: number;
  size: string;
  quality: Quality;
  background: Background;
  moderation: Moderation;
  outputFormat: OutputFormat;
  outputCompression: number;
  responseFormat: ResponseFormat;
  inputFidelity: TriState;
  legacyStyle: LegacyStyle;
  stream: boolean;
  partialImages: number;
  user: string;
  /** Not an OpenAI field: img2img strength for gateways that expose it (stable-diffusion.cpp). */
  strength: number | null;
  /** Raw JSON merged last into the request body — the escape hatch for any provider field. */
  extraJson: string;
}

export interface ModelInfo {
  id: string;
  created?: number;
  ownedBy?: string;
  description?: string;
  /** Structured-layout dialect advertised by the engine (e.g. "moss"); absent means not advertised. */
  layout?: string;
}

export interface Profile {
  id: string;
  name: string;
  base_url: string;
  has_api_key: boolean;
  api_key_preview: string;
}

export interface ConnectionTarget {
  /** Stored profile id; wins over the ad-hoc pair below. */
  profileId?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface Usage {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
}

export interface ImagesResponse {
  created?: number;
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  output_format?: OutputFormat;
  background?: Background;
  usage?: Usage;
}

export interface StudioImage {
  id: string;
  /** Object URL for decoded bytes, or the upstream URL when response_format=url. */
  src: string;
  blob: Blob | null;
  upstreamUrl: string | null;
  format: OutputFormat;
  bytes: number;
  width: number;
  height: number;
  partialIndex?: number;
}

export interface StreamUpdate {
  kind: 'partial' | 'completed' | 'error';
  image?: StudioImage;
  images?: StudioImage[];
  usage?: Usage;
  revisedPrompt?: string;
  message?: string;
  outputFormat?: OutputFormat;
  background?: Background;
  created?: number;
}

export interface ReferenceImage {
  id: string;
  name: string;
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
}

export interface RunRecord {
  id: string;
  createdAt: number;
  kind: TaskKind;
  model: string;
  prompt: string;
  params: ImageParams;
  durationMs: number;
  usage?: Usage;
  revisedPrompt?: string;
  outputFormat?: OutputFormat;
  baseUrl?: string;
  images: Array<{ blob: Blob; format: OutputFormat; width: number; height: number }>;
  references?: Array<{ blob: Blob; name: string }>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly type: string;

  constructor(message: string, status = 0, code = 'unknown', type = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.type = type;
  }
}
