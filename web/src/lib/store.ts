/** UI settings in localStorage. API keys are deliberately never stored here — they
live in server-side profiles (`data/settings.json`, 0600) or in memory for the current
tab, so a stolen localStorage dump cannot spend a quota.

One set of request parameters is shared by all three tasks: the size, quality or model
you picked must not silently change when you move from Generate to Edit. Only the
prompt is kept per task, so a draft on one tab survives visiting another.
*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_PARAMS, LEGACY_STORAGE_KEY, STORAGE_KEY, emptyParams } from './presets';
import type { ImageParams, TaskKind } from './types';

export interface UiSettings {
  version: 2;
  theme: 'dark' | 'light';
  task: TaskKind;
  params: ImageParams;
  prompts: Record<TaskKind, string>;
  /** Ad-hoc base URL for this browser; empty means "use the active server profile". */
  baseUrl: string;
  profileId: string;
  historyLimit: number;
  autoSaveHistory: boolean;
  showGrid: boolean;
  lastModel: string;
}

export function defaultSettings(): UiSettings {
  return {
    version: 2,
    theme: 'dark',
    task: 'generate',
    params: { ...DEFAULT_PARAMS },
    prompts: { generate: '', edit: '', vary: '' },
    baseUrl: '',
    profileId: '',
    historyLimit: 60,
    autoSaveHistory: true,
    showGrid: true,
    lastModel: '',
  };
}

function readStorage(): UiSettings {
  const base = defaultSettings();
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return base; // private mode or storage disabled: run with defaults
  }
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const stored = (parsed.params ?? {}) as Partial<ImageParams> & Partial<Record<TaskKind, ImageParams>>;
    // Version 1 stored a parameter set per task; flatten it and keep each draft prompt.
    const legacy = 'generate' in stored && typeof stored.generate === 'object';
    const params = { ...emptyParams(), ...((legacy ? stored.generate : parsed.params) as Partial<ImageParams> | undefined) };
    const prompts = legacy
      ? {
          generate: stored.generate?.prompt ?? '',
          edit: stored.edit?.prompt ?? '',
          vary: stored.vary?.prompt ?? '',
        }
      : { ...base.prompts, ...((parsed.prompts as Record<TaskKind, string> | undefined) ?? {}) };
    return { ...base, ...(parsed as Partial<UiSettings>), version: 2, params, prompts };
  } catch {
    return base;
  }
}

/** The shared parameter object holds no prompt text; see `UiSettings.prompts`. */
function withoutPrompt(params: ImageParams): Omit<ImageParams, 'prompt'> {
  const { prompt: _prompt, ...rest } = params;
  return rest;
}

export interface SettingsApi {
  settings: UiSettings;
  update: (patch: Partial<UiSettings>) => void;
  /** Patch shared parameters. A `prompt` in the patch goes to the active task only. */
  patchParams: (patch: Partial<ImageParams>) => void;
  resetParams: () => void;
  /** Set the model where it is still empty, applied at state-update time so a model
   * typed moments earlier is never overwritten by a late /v1/models response.
   */
  fillEmptyModels: (model: string) => void;
  setTaskParams: (task: TaskKind, params: ImageParams, prompt: string) => void;
}

export function useSettings(): SettingsApi {
  const [settings, setSettings] = useState<UiSettings>(readStorage);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        /* quota or private mode: settings simply do not survive the tab */
      }
    }, 180);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [settings]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const update = useCallback((patch: Partial<UiSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const patchParams = useCallback((patch: Partial<ImageParams>) => {
    setSettings((current) => {
      const { prompt, ...rest } = patch;
      return {
        ...current,
        params: { ...current.params, ...rest },
        prompts: prompt === undefined ? current.prompts : { ...current.prompts, [current.task]: prompt },
      };
    });
  }, []);

  const fillEmptyModels = useCallback((model: string) => {
    setSettings((current) => (current.params.model ? current : { ...current, params: { ...current.params, model } }));
  }, []);

  const resetParams = useCallback(() => {
    setSettings((current) => ({ ...current, params: emptyParams(), prompts: { ...current.prompts, [current.task]: '' } }));
  }, []);

  const setTaskParams = useCallback((task: TaskKind, params: ImageParams, prompt: string) => {
    setSettings((current) => ({
      ...current,
      task,
      // The shared object never carries a prompt; it lives in `prompts[task]`.
      params: { ...emptyParams(), ...withoutPrompt(params) },
      prompts: { ...current.prompts, [task]: prompt },
    }));
  }, []);

  return { settings, update, patchParams, resetParams, fillEmptyModels, setTaskParams };
}
