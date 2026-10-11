/** Option lists, defaults and the small amount of product knowledge the UI needs. */

import type { Background, ImageParams, Moderation, OutputFormat, Quality, TaskKind } from './types';

export const STORAGE_KEY = 'llmimage.ui.v2';
/** Key used before parameters became shared across tasks; still read once to migrate. */
export const LEGACY_STORAGE_KEY = 'llmimage.ui.v1';

export interface SizePreset {
  value: string;
  label: string;
  ratio: string;
  hint: string;
}

export const SIZE_PRESETS: SizePreset[] = [
  { value: '1024x1024', label: 'Square', ratio: '1:1', hint: '1024×1024' },
  { value: '1536x1024', label: 'Landscape', ratio: '3:2', hint: '1536×1024' },
  { value: '1024x1536', label: 'Portrait', ratio: '2:3', hint: '1024×1536' },
  { value: '2048x2048', label: 'Large square', ratio: '1:1', hint: '2048×2048' },
  { value: '2560x1440', label: 'Wide', ratio: '16:9', hint: '2560×1440' },
  { value: '512x512', label: 'Small', ratio: '1:1', hint: '512×512 · legacy' },
  { value: 'auto', label: 'Auto', ratio: '—', hint: 'let the provider choose' },
];

export const QUALITY_OPTIONS: Array<{ value: Quality; label: string; hint: string }> = [
  { value: 'auto', label: 'Auto', hint: 'provider default' },
  { value: 'low', label: 'Low', hint: 'fastest, cheapest' },
  { value: 'medium', label: 'Medium', hint: 'balanced' },
  { value: 'high', label: 'High', hint: 'slowest, most detail' },
  { value: 'xhigh', label: 'X-High', hint: 'gpt-image-2.5 only' },
  { value: 'max', label: 'Max', hint: 'gpt-image-2.5 only' },
];

export const BACKGROUND_OPTIONS: Array<{ value: Background; label: string; hint: string }> = [
  { value: 'auto', label: 'Auto', hint: 'model decides' },
  { value: 'opaque', label: 'Opaque', hint: 'solid backdrop' },
  { value: 'transparent', label: 'Transparent', hint: 'needs png or webp output' },
];

export const MODERATION_OPTIONS: Array<{ value: Moderation; label: string; hint: string }> = [
  { value: 'auto', label: 'Auto', hint: 'standard filtering' },
  { value: 'low', label: 'Low', hint: 'less restrictive, GPT image only' },
];

export const FORMAT_OPTIONS: OutputFormat[] = ['png', 'jpeg', 'webp'];

/** Ids offered when the endpoint does not expose GET /v1/models. Clearly labelled as guesses. */
export const SUGGESTED_MODELS = [
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare',
  'gpt-image-2',
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
  'chatgpt-image-latest',
  'qwen-image-2.1',
  'qwen-image-2.1-turbo',
  'dall-e-3',
  'dall-e-2',
];

export const PROMPT_STARTERS = [
  'A neon shop sign that reads "IMAGE STUDIO", rainy night street, cinematic reflections',
  'Isometric cutaway diagram of a tiny coffee roastery, muted palette, technical illustration',
  'Macro photo of a mechanical dragonfly, brass and sapphire, shallow depth of field',
  'Minimal poster: single origami crane, generous negative space, two-tone risograph print',
  'Character sheet of a friendly deep-sea explorer, three views, clean line art',
  'Ancient library carved into a glacier, volumetric light, wide-angle concept art',
  'Product shot of a matte black camera lens on textured concrete, studio softbox lighting',
  'Watercolour map of a fictional archipelago with sea monsters and compass rose',
  'Retro-futuristic control room, CRT glow, analog dials, 1980s sci-fi film still',
  'A vertical study poster about chemical reactions, clean typography, labeled diagrams',
];

export const DEFAULT_PARAMS: ImageParams = {
  model: '',
  prompt: '',
  negativePrompt: '',
  n: 1,
  size: '1024x1024',
  quality: 'auto',
  background: 'auto',
  moderation: 'auto',
  outputFormat: 'png',
  outputCompression: 100,
  responseFormat: 'inherit',
  inputFidelity: 'inherit',
  legacyStyle: 'inherit',
  stream: false,
  partialImages: 3,
  user: '',
  strength: null,
  extraJson: '',
};

export function emptyParams(): ImageParams {
  return { ...DEFAULT_PARAMS };
}

export interface TaskMeta {
  id: TaskKind;
  label: string;
  endpoint: string;
  promptLabel: string;
  promptPlaceholder: string;
  /** Multipart uploads are required, so the run button is disabled without them. */
  needsUpload: boolean;
}

export const TASKS: Record<TaskKind, TaskMeta> = {
  generate: {
    id: 'generate',
    label: 'Generate',
    endpoint: 'images/generations',
    promptLabel: 'Prompt',
    promptPlaceholder: 'Describe the image you want…',
    needsUpload: false,
  },
  edit: {
    id: 'edit',
    label: 'Edit',
    endpoint: 'images/edits',
    promptLabel: 'Edit instruction',
    promptPlaceholder: 'e.g. change the sign text to "EDITED OK", keep everything else identical',
    needsUpload: true,
  },
  vary: {
    id: 'vary',
    label: 'Vary',
    endpoint: 'images/variations',
    promptLabel: 'Prompt (optional here)',
    promptPlaceholder: 'Variations ignores prompts on most providers; it re-rolls the input image.',
    needsUpload: true,
  },
};

export const TASK_ORDER: TaskKind[] = ['generate', 'edit', 'vary'];

export const MAX_REFERENCE_IMAGES = 16;
export const PROMPT_LIMIT = 32000;

/** Endpoints advertised by the backend, used for the connection test and the footer. */
export const ENDPOINT_HINTS = [
  'POST /v1/images/generations',
  'POST /v1/images/edits',
  'POST /v1/images/variations',
  'GET  /v1/models',
];
