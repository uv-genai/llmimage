import { Activity, History, Images, Settings2, Shuffle, Sparkles, Sun, Moon, WandSparkles } from 'lucide-react';
import type { Studio } from '../lib/useStudio';
import { TASK_ORDER, TASKS } from '../lib/presets';
import { hostOf } from '../lib/format';

const TASK_ICONS = {
  generate: Sparkles,
  edit: WandSparkles,
  vary: Shuffle,
} as const;

export function Header({ studio }: { studio: Studio }) {
  const { settings, update, task, setTask, resolvedBaseUrl, backendError } = studio;
  const dark = settings.theme === 'dark';
  const unreachable = Boolean(backendError);
  const modelsDown = studio.modelsStatus === 'error';
  const noEndpoint = !resolvedBaseUrl;

  // /v1/models is open on many gateways even when generation needs a token, so a
  // missing key is called out explicitly instead of surfacing as a 401 on first run.
  const noKey = !studio.hasCredential;
  const status =
    noEndpoint || unreachable ? 'offline' : modelsDown || noKey ? 'degraded' : 'online';
  const statusColor = status === 'online' ? 'var(--ok)' : status === 'degraded' ? 'var(--warn)' : 'var(--danger)';

  return (
    <header
      className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] px-3 sm:px-4"
      style={{ background: 'color-mix(in oklab, var(--surface-solid) 72%, transparent)', backdropFilter: 'blur(18px)' }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="grid h-8 w-8 place-items-center rounded-[11px]"
          style={{
            background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
            boxShadow: '0 8px 22px -10px color-mix(in oklab, var(--accent) 90%, transparent)',
          }}
        >
          <Images size={16} color="#fff" strokeWidth={2.1} />
        </div>
        <div className="leading-tight">
          <p className="brand-text text-[14.5px] font-semibold tracking-tight">llmimage</p>
          <p className="hidden text-[10.5px] tracking-wide text-[var(--faint)] sm:block">openai image studio</p>
        </div>
      </div>

      <nav className="ml-1 flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--sunken)] p-1">
        {TASK_ORDER.map((item) => {
          const Icon = TASK_ICONS[item];
          const active = task === item;
          return (
            <button
              key={item}
              type="button"
              onClick={() => setTask(item)}
              title={`${TASKS[item].label} · /v1/${TASKS[item].endpoint}`}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors"
              style={{
                color: active ? 'var(--text)' : 'var(--muted)',
                background: active ? 'color-mix(in oklab, var(--accent) 24%, transparent)' : 'transparent',
              }}
              aria-pressed={active}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{TASKS[item].label}</span>
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => studio.setDrawer('settings')}
          className="chip chip-button hidden max-w-[34ch] md:inline-flex"
          title={resolvedBaseUrl || 'No endpoint configured — open settings'}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: statusColor, boxShadow: `0 0 8px ${statusColor}` }}
          />
          <span className="truncate">{noEndpoint ? 'no endpoint' : hostOf(resolvedBaseUrl)}</span>
          {noKey && !noEndpoint ? <span style={{ color: 'var(--warn)' }}>no key</span> : null}
          {studio.running ? (
            <span className="breathe text-[10px] font-semibold text-[var(--accent-2)]">RUNNING</span>
          ) : null}
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={() => void studio.refreshModels(false)}
          title="Refresh the model list from /v1/models"
          aria-label="Refresh models"
        >
          <Activity size={15} className={studio.modelsStatus === 'loading' ? 'spin' : undefined} />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={() => studio.setDrawer('history')}
          title="History (H)"
          aria-label="Open history"
        >
          <History size={15} />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={() => update({ theme: dark ? 'light' : 'dark' })}
          title={`Switch to ${dark ? 'light' : 'dark'} theme`}
          aria-label="Toggle theme"
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={() => studio.setDrawer('settings')}
          title="Connection and preferences"
          aria-label="Open settings"
        >
          <Settings2 size={15} />
        </button>
      </div>
    </header>
  );
}
