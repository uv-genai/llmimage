import { Dices, Eraser } from 'lucide-react';
import { PROMPT_LIMIT, PROMPT_STARTERS } from '../lib/presets';
import type { TaskMeta } from '../lib/presets';
import type { ImageParams } from '../lib/types';

export function PromptField({
  meta,
  params,
  patch,
}: {
  meta: TaskMeta;
  params: ImageParams;
  patch: (patch: Partial<ImageParams>) => void;
}) {
  const length = params.prompt.length;
  const over = length > PROMPT_LIMIT;

  return (
    <div>
      <div className="label">
        <span>{meta.promptLabel}</span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            title="Insert a prompt idea"
            onClick={() => patch({ prompt: PROMPT_STARTERS[Math.floor(Math.random() * PROMPT_STARTERS.length)] })}
          >
            <Dices size={13} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            title="Clear the prompt"
            onClick={() => patch({ prompt: '' })}
            disabled={!length}
          >
            <Eraser size={13} />
          </button>
        </span>
      </div>
      <textarea
        className="textarea"
        value={params.prompt}
        placeholder={meta.promptPlaceholder}
        spellCheck
        onChange={(event) => patch({ prompt: event.target.value })}
      />
      <div className="mt-1 flex items-center justify-between">
        <span className="hint">
          {meta.id === 'vary' ? 'Most providers ignore prompts here.' : 'Be specific: subject, style, lighting, framing.'}
        </span>
        <span className={`tabular text-[11px] ${over ? 'text-[var(--danger)]' : 'text-[var(--faint)]'}`}>
          {length.toLocaleString()}/{PROMPT_LIMIT.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
