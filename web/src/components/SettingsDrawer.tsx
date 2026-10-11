import { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, PlugZap, Plus, Server, Trash2 } from 'lucide-react';
import { Drawer, Field, Segmented, Slider, SwitchRow, useToast } from './ui';
import { deleteProfile, saveProfile } from '../lib/api';
import { ENDPOINT_HINTS } from '../lib/presets';
import { hostOf } from '../lib/format';
import type { Studio } from '../lib/useStudio';

export function SettingsDrawer({ studio }: { studio: Studio }) {
  const { settings, update, backend, health, backendError, resolvedBaseUrl, activeProfile } = studio;
  /** Set with LLMIMAGE_BASE_URL; an empty field then means "use what the server says". */
  const serverDefault = backend?.defaults.base_url ?? '';
  const toast = useToast();
  const [draftUrl, setDraftUrl] = useState(resolvedBaseUrl);
  const [draftKey, setDraftKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [profileName, setProfileName] = useState('');

  useEffect(() => {
    if (studio.drawer === 'settings') setDraftUrl(resolvedBaseUrl);
  }, [studio.drawer, resolvedBaseUrl]);

  const applyDraft = () => {
    const url = draftUrl.trim();
    studio.setSessionBaseUrl(url);
    studio.update({ baseUrl: url, profileId: '' });
    if (draftKey.trim()) studio.setSessionKey(draftKey.trim());
    toast.push({
      kind: 'info',
      title: url ? 'Endpoint applied' : 'Endpoint cleared',
      detail: url ? `Requests now go to ${url} (a trailing /v1 is added if missing).` : 'Falling back to the server default.',
    });
  };

  const persist = async () => {
    if (!draftUrl.trim()) {
      toast.push({ kind: 'warn', title: 'Set a base URL first' });
      return;
    }
    try {
      const profiles = await saveProfile({
        id: activeProfile?.id,
        name: profileName.trim() || activeProfile?.name || hostOf(draftUrl),
        base_url: draftUrl.trim(),
        api_key: draftKey.trim(),
      });
      studio.update({ baseUrl: '', profileId: '' });
      studio.setSessionBaseUrl('');
      studio.setSessionKey('');
      setProfileName('');
      setDraftKey('');
      await studio.reloadBackend();
      await studio.refreshModels(true);
      toast.push({ kind: 'ok', title: 'Profile saved', detail: `${profiles.length} profile(s) on the server.` });
    } catch (error) {
      toast.push({ kind: 'error', title: 'Could not save the profile', detail: (error as Error).message });
    }
  };

  const useProfile = async (id: string) => {
    studio.update({ profileId: id, baseUrl: '' });
    studio.setSessionBaseUrl('');
    studio.setSessionKey('');
    await studio.refreshModels(true);
  };

  const remove = async (id: string) => {
    try {
      await deleteProfile(id);
      if (settings.profileId === id) studio.update({ profileId: '' });
      await studio.reloadBackend();
      toast.push({ kind: 'info', title: 'Profile deleted' });
    } catch (error) {
      toast.push({ kind: 'error', title: 'Could not delete the profile', detail: (error as Error).message });
    }
  };

  return (
    <Drawer open={studio.drawer === 'settings'} title="Settings" onClose={() => studio.setDrawer(null)} width={460}>
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="section-title">Endpoint</h3>
          <Field
            label="Base URL"
            hint="Anything that speaks the OpenAI images API: OpenAI, Azure, or a local gateway such as imagegen."
          >
            <input
              className="input font-mono text-[12.5px]"
              placeholder="http://127.0.0.1:8080/v1"
              value={draftUrl}
              spellCheck={false}
              onChange={(event) => setDraftUrl(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && applyDraft()}
            />
            {serverDefault ? (
              <p className="hint mt-2">
                {draftUrl.trim()
                  ? 'Overrides the endpoint configured on the server.'
                  : 'Blank uses the endpoint configured on the server: '}
                {!draftUrl.trim() ? <span className="font-mono">{serverDefault}</span> : null}
              </p>
            ) : null}
          </Field>

          <Field label="API key" hint="Held in this browser tab only. Saving a profile stores it server-side (0600).">
            <div className="flex gap-1.5">
              <input
                className="input font-mono text-[12.5px]"
                type={showKey ? 'text' : 'password'}
                placeholder={activeProfile?.has_api_key ? `stored: ${activeProfile.api_key_preview}` : 'sk-…'}
                value={draftKey}
                spellCheck={false}
                onChange={(event) => setDraftKey(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && applyDraft()}
              />
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setShowKey((value) => !value)} title="Show key">
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>

          <input
            className="input"
            placeholder="Name this connection (used when saving a profile)"
            value={profileName}
            onChange={(event) => setProfileName(event.target.value)}
          />

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={applyDraft}>
              <Check size={13} /> Use this endpoint
            </button>
            <button type="button" className="btn" onClick={() => void studio.refreshModels(true)}>
              <PlugZap size={13} /> Test connection
            </button>
            <button type="button" className="btn" onClick={() => void persist()} title="Store on the server and reuse later">
              <Plus size={13} /> Save profile
            </button>
          </div>

          {studio.modelsStatus === 'error' ? (
            <p className="text-[11.5px] leading-snug text-[var(--danger)]">{studio.modelsError}</p>
          ) : null}
          {studio.modelsStatus === 'ready' ? (
            <p className="text-[11.5px] text-[var(--ok)]">
              Reachable · {studio.models.length} model{studio.models.length === 1 ? '' : 's'} ·{' '}
              {studio.models.map((model) => model.id).slice(0, 6).join(', ') || 'none reported'}
            </p>
          ) : null}
        </section>

        <section className="space-y-2">
          <h3 className="section-title">Saved profiles</h3>
          {!backend?.profiles.length ? (
            <p className="hint">No stored profiles yet. Configure the backend with LLMIMAGE_BASE_URL / LLMIMAGE_API_KEY, or save one above.</p>
          ) : (
            <ul className="space-y-1.5">
              {backend.profiles.map((profile) => {
                const active = (settings.profileId || backend.active_profile_id) === profile.id;
                return (
                  <li
                    key={profile.id}
                    className="flex items-center gap-2 rounded-xl border px-2.5 py-2"
                    style={{
                      borderColor: active ? 'color-mix(in oklab, var(--accent) 55%, transparent)' : 'var(--border)',
                      background: active ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : 'var(--sunken)',
                    }}
                  >
                    <Server size={13} style={{ color: 'var(--faint)' }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">{profile.name}</p>
                      <p className="truncate font-mono text-[11px] text-[var(--faint)]">
                        {profile.base_url || '—'} · {profile.has_api_key ? profile.api_key_preview : 'no key'}
                      </p>
                    </div>
                    {!active ? (
                      <button type="button" className="btn btn-ghost" onClick={() => void useProfile(profile.id)}>
                        Use
                      </button>
                    ) : (
                      <span className="chip chip-accent">active</span>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      title="Delete profile"
                      onClick={() => void remove(profile.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="section-title">Behaviour</h3>
          <Field label="Theme">
            <Segmented
              size="sm"
              value={settings.theme}
              onChange={(theme) => update({ theme })}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
            />
          </Field>
          <SwitchRow
            label="Background grid"
            hint="Decorative grid and aurora behind the workspace."
            checked={settings.showGrid}
            onChange={(showGrid) => update({ showGrid })}
          />
          <SwitchRow
            label="Keep history"
            hint="Store every result with its parameters in this browser (IndexedDB)."
            checked={settings.autoSaveHistory}
            onChange={(autoSaveHistory) => update({ autoSaveHistory })}
          />
          {settings.autoSaveHistory ? (
            <Field label="History depth">
              <Slider
                value={settings.historyLimit}
                min={5}
                max={400}
                step={5}
                defaultValue={60}
                onChange={(historyLimit) => update({ historyLimit })}
                format={(value) => `${value} runs`}
              />
            </Field>
          ) : null}
        </section>

        <section className="space-y-2">
          <h3 className="section-title">Backend</h3>
          {backendError ? (
            <p className="text-[11.5px] text-[var(--danger)]">Backend unreachable: {backendError}</p>
          ) : (
            <div className="space-y-1.5 text-[11.5px] text-[var(--muted)]">
              <p>
                llmimage <span className="tabular">{backend?.version ?? '…'}</span> · timeout{' '}
                <span className="tabular">{health?.request_timeout_seconds ?? '—'}s</span>
              </p>
              <p>Allowed hosts: {health?.allowed_hosts.length ? health.allowed_hosts.join(', ') : 'any'}</p>
              <ul className="space-y-0.5 font-mono text-[11px] text-[var(--faint)]">
                {ENDPOINT_HINTS.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}
