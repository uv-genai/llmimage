/** Orchestrates the studio: connection, parameters, uploads, the run itself, history
and the overlays. Components take this object instead of twenty props.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchBackendConfig, fetchHealth, fetchModels, runImageTask, type BackendConfig, type BackendInfo, type RunOutcome } from './api';
import { blobFromSrc, downloadBlob, fileToReference, imageFilename, uid } from './images';
import { buildGenerationBody, buildMultipart, toCurl, validate } from './params';
import { MAX_REFERENCE_IMAGES, TASKS } from './presets';
import { clearRuns, deleteRun, listRuns, saveRun } from './history';
import { useSettings } from './store';
import {
  ApiError,
  type ConnectionTarget,
  type ImageParams,
  type ModelInfo,
  type ReferenceImage,
  type RunRecord,
  type StudioImage,
  type TaskKind,
} from './types';
import { useToast } from '../components/ui';

export type ModelsStatus = 'idle' | 'loading' | 'ready' | 'error';
export type Drawer = 'settings' | 'history' | 'curl' | 'mask' | null;

export interface RunState {
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt: number;
  kind: TaskKind;
  partials: StudioImage[];
  result?: RunOutcome;
  error?: { message: string; code: string; type?: string };
}

const IDLE_RUN: RunState = { status: 'idle', startedAt: 0, kind: 'generate', partials: [] };

export function useStudio() {
  const { settings, update, patchParams, resetParams, fillEmptyModels, setTaskParams } = useSettings();
  const toast = useToast();

  const [backend, setBackend] = useState<BackendConfig | null>(null);
  const [health, setHealth] = useState<BackendInfo | null>(null);
  const [backendError, setBackendError] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsStatus, setModelsStatus] = useState<ModelsStatus>('idle');
  const [modelsError, setModelsError] = useState('');
  /** Credentials typed into this tab only — an API key is never written to storage. */
  const [sessionKey, setSessionKey] = useState('');
  const [sessionBaseUrl, setSessionBaseUrl] = useState('');

  const [images, setImages] = useState<ReferenceImage[]>([]);
  const [mask, setMask] = useState<{ blob: Blob; previewUrl: string } | null>(null);
  /** Which uploaded image the mask editor is painting on. */
  const [maskTarget, setMaskTarget] = useState<ReferenceImage | null>(null);
  const [run, setRun] = useState<RunState>(IDLE_RUN);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [lightbox, setLightbox] = useState<{ images: StudioImage[]; index: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const task = settings.task;
  // Shared parameters plus this task's own prompt draft.
  const params = useMemo<ImageParams>(
    () => ({ ...settings.params, prompt: settings.prompts[task] ?? '' }),
    [settings.params, settings.prompts, task],
  );

  /* ----------------------------------------------------------- connection */
  const target: ConnectionTarget = useMemo(() => {
    const override = (sessionBaseUrl || settings.baseUrl).trim();
    if (override) return { baseUrl: override, apiKey: sessionKey || undefined };
    if (settings.profileId) return { profileId: settings.profileId };
    return {};
  }, [sessionBaseUrl, settings.baseUrl, settings.profileId, sessionKey]);

  const activeProfile = useMemo(
    () => backend?.profiles.find((item) => item.id === (settings.profileId || backend.active_profile_id)) ?? null,
    [backend, settings.profileId],
  );

  const resolvedBaseUrl = useMemo(
    () => (sessionBaseUrl || settings.baseUrl).trim() || activeProfile?.base_url || backend?.defaults.base_url || '',
    [sessionBaseUrl, settings.baseUrl, activeProfile, backend],
  );

  const hasCredential = Boolean(sessionKey || activeProfile?.has_api_key || backend?.defaults.has_api_key);

  const reloadBackend = useCallback(async () => {
    try {
      const [config, status] = await Promise.all([fetchBackendConfig(), fetchHealth()]);
      setBackend(config);
      setHealth(status);
      setBackendError('');
    } catch (error) {
      setBackendError((error as Error).message);
    }
  }, []);

  useEffect(() => {
    void reloadBackend();
  }, [reloadBackend]);

  const refreshModels = useCallback(
    async (announce = false) => {
      setModelsStatus('loading');
      try {
        const { models: found, latencyMs } = await fetchModels(target);
        setModels(found);
        setModelsStatus('ready');
        setModelsError('');
        if (announce) {
          toast.push({
            kind: 'ok',
            title: `${found.length} model${found.length === 1 ? '' : 's'} reachable`,
            detail: `${Math.round(latencyMs)} ms round trip`,
          });
        }
        return found;
      } catch (error) {
        const message = error instanceof ApiError ? error.message : (error as Error).message;
        setModelsStatus('error');
        setModelsError(message);
        if (announce) toast.push({ kind: 'error', title: 'Could not list models', detail: message });
        return null;
      }
    },
    [target, toast],
  );

  // Re-probe whenever the endpoint changes; a failure stays quiet (the header shows it).
  const refreshRef = useRef(refreshModels);
  refreshRef.current = refreshModels;
  const targetKey = JSON.stringify(target);
  useEffect(() => {
    const timer = window.setTimeout(() => void refreshRef.current(false), 450);
    return () => window.clearTimeout(timer);
  }, [targetKey]);

  // A model belongs to the connection, not to one tab. fillEmptyModels applies at
  // state-update time, so typing a model while this request is in flight still wins.
  useEffect(() => {
    if (modelsStatus !== 'ready' || !models.length) return;
    const preferred =
      models.find((item) => item.id === settings.lastModel)?.id ??
      models.find((item) => !item.id.startsWith('dall-e'))?.id ??
      models[0].id;
    fillEmptyModels(preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsStatus, models]);

  useEffect(() => {
    void listRuns().then(setHistory).catch(() => setHistory([]));
  }, []);

  /* -------------------------------------------------------------- uploads */
  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const incoming = Array.from(files).filter((file) => file.type.startsWith('image/'));
      if (!incoming.length) {
        toast.push({ kind: 'warn', title: 'No images in that drop', detail: 'PNG, JPEG or WebP files only.' });
        return;
      }
      const room = Math.max(0, MAX_REFERENCE_IMAGES - images.length);
      const accepted = incoming.slice(0, room);
      if (accepted.length < incoming.length) {
        toast.push({
          kind: 'warn',
          title: 'Reference limit reached',
          detail: `At most ${MAX_REFERENCE_IMAGES} images per edit; ${incoming.length - accepted.length} dropped.`,
        });
      }
      const converted = await Promise.all(accepted.map((file) => fileToReference(file)));
      setImages((current) => [...current, ...converted]);
    },
    [images.length, toast],
  );

  const removeImage = useCallback((id: string) => {
    setImages((current) => {
      const victim = current.find((item) => item.id === id);
      if (victim) URL.revokeObjectURL(victim.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }, []);

  const makePrimary = useCallback((id: string) => {
    setImages((current) => {
      const index = current.findIndex((item) => item.id === id);
      if (index <= 0) return current;
      const next = [...current];
      const [picked] = next.splice(index, 1);
      return [picked, ...next];
    });
  }, []);

  const clearImages = useCallback(() => {
    setImages((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  }, []);

  const clearMask = useCallback(() => {
    setMask((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  }, []);

  const openMaskEditor = useCallback((image: ReferenceImage) => {
    setMaskTarget(image);
    setDrawer('mask');
  }, []);

  const attachMaskBlob = useCallback((blob: Blob) => {
    setMask((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return { blob, previewUrl: URL.createObjectURL(blob) };
    });
  }, []);

  const useAsInput = useCallback(
    async (image: StudioImage, replace: boolean) => {
      try {
        const blob = await blobFromSrc(image.src);
        const file = new File([blob], imageFilename(0, 1, image.format), { type: blob.type || 'image/png' });
        const reference = await fileToReference(file);
        setImages((current) => {
          const base = replace ? current : [];
          base.forEach((item) => URL.revokeObjectURL(item.previewUrl));
          return [...base, reference].slice(0, MAX_REFERENCE_IMAGES);
        });
        update({ task: 'edit' });
        toast.push({ kind: 'info', title: replace ? 'Replaced edit inputs' : 'Added to edit inputs' });
      } catch (error) {
        toast.push({ kind: 'error', title: 'Could not load that image', detail: (error as Error).message });
      }
    },
    [toast, update],
  );

  /* ------------------------------------------------------------- request */
  const issues = useMemo(() => validate(task, params, images, mask?.blob ?? null), [task, params, images, mask]);
  const blocking = useMemo(() => issues.filter((issue) => issue.level === 'error'), [issues]);
  const curl = useMemo(
    () => toCurl(task, params, resolvedBaseUrl, images, mask?.blob ?? null, hasCredential),
    [task, params, resolvedBaseUrl, images, mask, hasCredential],
  );

  const buildRecord = useCallback(
    (outcome: RunOutcome): RunRecord => ({
      id: uid(),
      createdAt: Date.now(),
      kind: task,
      model: params.model,
      prompt: params.prompt,
      params,
      durationMs: outcome.durationMs,
      usage: outcome.usage,
      revisedPrompt: outcome.revisedPrompt,
      outputFormat: outcome.outputFormat ?? params.outputFormat,
      baseUrl: resolvedBaseUrl,
      images: outcome.images
        .filter((image) => image.blob)
        .map((image) => ({
          blob: image.blob as Blob,
          format: image.format,
          width: image.width,
          height: image.height,
        })),
      references: images.map((image) => ({ blob: image.blob, name: image.name })),
    }),
    [task, params, images, resolvedBaseUrl],
  );

  const runNow = useCallback(async () => {
    if (blocking.length) {
      toast.push({ kind: 'warn', title: 'Fix before running', detail: blocking.map((item) => item.text).join('\n') });
      return;
    }
    if (!resolvedBaseUrl) {
      toast.push({
        kind: 'warn',
        title: 'No endpoint configured',
        detail: 'Set the base URL of your OpenAI-compatible image API in Settings.',
      });
      setDrawer('settings');
      return;
    }

    const multipart = task !== 'generate';
    // A zero-byte mask is rejected by strict gateways; drop it and say so instead.
    const maskBlob = mask && mask.blob.size > 0 ? mask.blob : null;
    if (mask && mask.blob.size === 0) {
      toast.push({ kind: 'warn', title: 'Empty mask ignored', detail: 'Repaint it or clear it before running.' });
    }
    const built = multipart ? buildMultipart(task, params, images, maskBlob) : null;
    const body: BodyInit = built ? built.form : JSON.stringify(buildGenerationBody(params));

    const controller = new AbortController();
    abortRef.current = controller;
    setRun({ status: 'running', startedAt: Date.now(), kind: task, partials: [] });

    try {
      const outcome = await runImageTask({
        kind: task,
        target,
        body,
        json: !multipart,
        stream: params.stream,
        outputFormat: params.outputFormat,
        signal: controller.signal,
        onPartial: ({ image }) =>
          setRun((current) =>
            current.status === 'running' ? { ...current, partials: [...current.partials, image] } : current,
          ),
      });
      setRun({ status: 'done', startedAt: Date.now() - outcome.durationMs, kind: task, partials: [], result: outcome });
      if (settings.autoSaveHistory) setHistory(await saveRun(buildRecord(outcome), settings.historyLimit));
      toast.push({
        kind: outcome.streamIgnored ? 'warn' : 'ok',
        title: `${outcome.images.length} image${outcome.images.length === 1 ? '' : 's'} ready`,
        detail: [
          `${(outcome.durationMs / 1000).toFixed(1)} s`,
          outcome.streamIgnored ? 'endpoint ignored stream' : outcome.streamed ? 'streamed' : 'single response',
          outcome.usage?.total_tokens ? `${outcome.usage.total_tokens} tokens` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        setRun(IDLE_RUN);
        toast.push({ kind: 'info', title: 'Request cancelled' });
        return;
      }
      const apiError = error instanceof ApiError ? error : new ApiError((error as Error).message);
      setRun((current) => ({
        ...current,
        status: 'error',
        error: { message: apiError.message, code: apiError.code, type: apiError.type },
      }));
      toast.push({ kind: 'error', title: apiError.code ? `Request failed (${apiError.code})` : 'Request failed', detail: apiError.message });
    } finally {
      abortRef.current = null;
    }
  }, [blocking, resolvedBaseUrl, task, params, images, mask, target, settings.autoSaveHistory, settings.historyLimit, buildRecord, toast]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  /* -------------------------------------------------------------- history */
  const forgetRun = useCallback(async (id: string) => {
    await deleteRun(id);
    setHistory(await listRuns());
  }, []);

  const forgetAll = useCallback(async () => {
    await clearRuns();
    setHistory([]);
    toast.push({ kind: 'info', title: 'History cleared' });
  }, [toast]);

  const showRun = useCallback(
    (record: RunRecord) => {
      const restored: StudioImage[] = record.images.map((image) => ({
        id: uid(),
        src: URL.createObjectURL(image.blob),
        blob: image.blob,
        upstreamUrl: null,
        format: image.format,
        bytes: image.blob.size,
        width: image.width,
        height: image.height,
      }));
      setRun({
        status: 'done',
        startedAt: record.createdAt,
        kind: record.kind,
        partials: [],
        result: {
          images: restored,
          usage: record.usage,
          revisedPrompt: record.revisedPrompt,
          outputFormat: record.outputFormat,
          streamed: false,
          durationMs: record.durationMs,
        },
      });
      setTaskParams(record.kind, record.params, record.prompt);
      setDrawer(null);
    },
    [setTaskParams],
  );

  const reuseRun = useCallback(
    (record: RunRecord) => {
      setTaskParams(record.kind, record.params, record.prompt);
      setDrawer(null);
      toast.push({ kind: 'info', title: 'Parameters restored', detail: record.prompt.slice(0, 90) });
    },
    [setTaskParams, toast],
  );

  const loadRunInputs = useCallback(
    async (record: RunRecord) => {
      const stored = record.references ?? [];
      if (!stored.length) {
        toast.push({ kind: 'warn', title: 'That run stored no input images' });
        return;
      }
      const converted = await Promise.all(
        stored.map((reference) =>
          fileToReference(new File([reference.blob], reference.name, { type: reference.blob.type || 'image/png' })),
        ),
      );
      setImages(converted.slice(0, MAX_REFERENCE_IMAGES));
      update({ task: record.kind });
      setDrawer(null);
    },
    [toast, update],
  );

  /* ------------------------------------------------------------ downloads */
  const downloadImage = useCallback(
    async (image: StudioImage, index: number, total: number) => {
      try {
        downloadBlob(image.blob ?? (await blobFromSrc(image.src)), imageFilename(index, total, image.format));
      } catch (error) {
        toast.push({ kind: 'error', title: 'Download failed', detail: (error as Error).message });
      }
    },
    [toast],
  );

  const downloadAll = useCallback(
    async (list: StudioImage[]) => {
      for (const [index, image] of list.entries()) await downloadImage(image, index, list.length);
    },
    [downloadImage],
  );

  const patch = useCallback((next: Partial<ImageParams>) => patchParams(next), [patchParams]);

  const setModel = useCallback(
    (model: string) => {
      patchParams({ model });
      update({ lastModel: model });
    },
    [patchParams, update],
  );

  return {
    settings,
    update,
    resetParams,
    patch,
    setModel,
    task,
    params,
    setTask: (next: TaskKind) => update({ task: next }),
    taskMeta: TASKS[task],

    backend,
    health,
    backendError,
    reloadBackend,
    models,
    modelsStatus,
    modelsError,
    refreshModels,
    target,
    activeProfile,
    resolvedBaseUrl,
    hasCredential,
    sessionKey,
    setSessionKey,
    sessionBaseUrl,
    setSessionBaseUrl,

    images,
    addFiles,
    removeImage,
    clearImages,
    makePrimary,
    mask,
    attachMaskBlob,
    clearMask,
    maskTarget,
    openMaskEditor,
    useAsInput,

    run,
    running: run.status === 'running',
    canRun: run.status !== 'running' && blocking.length === 0,
    runNow,
    cancel,
    issues,
    blocking,
    curl,
    endpoint: TASKS[task].endpoint,

    history,
    forgetRun,
    forgetAll,
    showRun,
    reuseRun,
    loadRunInputs,

    shownImages: run.result?.images ?? [],
    downloadImage,
    downloadAll,
    lightbox,
    openLightbox: (list: StudioImage[], index: number) => setLightbox({ images: list, index }),
    closeLightbox: () => setLightbox(null),

    drawer,
    setDrawer,
  };
}

export type Studio = ReturnType<typeof useStudio>;
