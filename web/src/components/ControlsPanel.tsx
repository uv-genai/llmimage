import { Braces, CircleAlert, RotateCcw, Square, TriangleAlert, WandSparkles, Zap } from 'lucide-react';
import { Collapse, Field, Segmented, Slider, SwitchRow } from './ui';
import { ModelField } from './ModelField';
import { PromptField } from './PromptField';
import { SizeField } from './SizeField';
import { Uploads } from './Uploads';
import { BACKGROUND_OPTIONS, DEFAULT_PARAMS, FORMAT_OPTIONS, MODERATION_OPTIONS, QUALITY_OPTIONS } from '../lib/presets';
import { formatClock } from '../lib/format';
import { extensionFor } from '../lib/params';
import type { Studio } from '../lib/useStudio';

export function ControlsPanel({ studio }: { studio: Studio }) {
  const { params, patch, taskMeta, images, running, canRun, runNow, cancel, run, issues, blocking } = studio;
  const elapsed = running && run.startedAt ? (Date.now() - run.startedAt) / 1000 : 0;
  const warnings = issues.filter((issue) => issue.level === 'warning');

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-[var(--border)]">
      <div className="scroll min-h-0 flex-1 space-y-3.5 overflow-y-auto px-3 py-3.5">
        <PromptField meta={taskMeta} params={params} patch={patch} />

        {taskMeta.needsUpload ? <Uploads studio={studio} /> : null}

        <section className="panel-flat space-y-3.5 p-3">
          <ModelField studio={studio} />

          <Field label="Images (n)" hint="1–10. Local engines are usually limited to 1 per call.">
            <Slider value={params.n} min={1} max={10} defaultValue={DEFAULT_PARAMS.n} onChange={(n) => patch({ n })} />
          </Field>

          <Field label="Size">
            <SizeField value={params.size} onChange={(size) => patch({ size })} />
          </Field>

          <Field label="Quality" hint={QUALITY_OPTIONS.find((item) => item.value === params.quality)?.hint}>
            <Segmented
              size="sm"
              value={params.quality}
              onChange={(quality) => patch({ quality })}
              options={QUALITY_OPTIONS.map((item) => ({ value: item.value, label: item.label, title: item.hint }))}
            />
          </Field>

          <Field label="Background" hint={BACKGROUND_OPTIONS.find((item) => item.value === params.background)?.hint}>
            <Segmented
              size="sm"
              value={params.background}
              onChange={(background) => patch({ background })}
              options={BACKGROUND_OPTIONS.map((item) => ({ value: item.value, label: item.label, title: item.hint }))}
            />
          </Field>

          <Field label="Output format">
            <div className="space-y-2">
              <Segmented
                size="sm"
                value={params.outputFormat}
                onChange={(outputFormat) => patch({ outputFormat })}
                options={FORMAT_OPTIONS.map((value) => ({ value, label: value.toUpperCase() }))}
              />
              {params.outputFormat !== 'png' ? (
                <Slider
                  value={params.outputCompression}
                  min={0}
                  max={100}
                  defaultValue={DEFAULT_PARAMS.outputCompression}
                  onChange={(outputCompression) => patch({ outputCompression })}
                  format={(value) => `${value}%`}
                />
              ) : (
                <p className="hint">Compression applies to {extensionFor('jpeg')} and WebP only.</p>
              )}
            </div>
          </Field>
        </section>

        <section className="panel-flat space-y-3 p-3">
          <SwitchRow
            label="Stream partial images"
            icon={<Zap size={13} style={{ color: 'var(--accent-2)' }} />}
            hint="Sends stream: true and renders each preview frame as it arrives."
            checked={params.stream}
            onChange={(stream) => patch({ stream })}
          />
          {params.stream ? (
            <Field label="Partial images" hint="0–3 progressive previews before the final image.">
              <Slider
                value={params.partialImages}
                min={0}
                max={3}
                defaultValue={DEFAULT_PARAMS.partialImages}
                onChange={(partialImages) => patch({ partialImages })}
              />
            </Field>
          ) : null}
        </section>

        <Collapse title="Provider extensions" badge={extensionBadge(params)}>
          <Field
            label="Negative prompt"
            hint="Not an OpenAI field. Sent as negative_prompt for engines that model it (stable-diffusion.cpp, SDXL, Flux)."
          >
            <textarea
              className="textarea"
              style={{ minHeight: 60 }}
              placeholder="blurry, watermark, extra fingers"
              value={params.negativePrompt}
              onChange={(event) => patch({ negativePrompt: event.target.value })}
            />
          </Field>

          <Field
            label="Denoise strength"
            hint={
              params.strength === null
                ? 'Not sent. Providers choose (imagegen edits default to 1.0 = reference-guided from noise).'
                : 'Sent as strength: 0 keeps the input almost unchanged, 1 regenerates fully.'
            }
            action={
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                title="Do not send strength"
                onClick={() => patch({ strength: null })}
                disabled={params.strength === null}
              >
                <RotateCcw size={12} />
              </button>
            }
          >
            <Slider
              value={params.strength ?? 1}
              min={0.05}
              max={1}
              step={0.05}
              onChange={(strength) => patch({ strength })}
              format={(value) => value.toFixed(2)}
            />
            <label className="mt-1.5 flex items-center gap-2 text-[11.5px] text-[var(--muted)]">
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={params.strength !== null}
                onChange={(event) => patch({ strength: event.target.checked ? 1 : null })}
              />
              send strength
            </label>
          </Field>

          <Field label="Input fidelity" hint="How hard the model tries to preserve faces and detail in inputs (edits).">
            <Segmented
              size="sm"
              value={params.inputFidelity}
              onChange={(inputFidelity) => patch({ inputFidelity })}
              options={[
                { value: 'inherit', label: 'Not sent', title: 'Omit input_fidelity' },
                { value: 'low', label: 'Low' },
                { value: 'high', label: 'High' },
              ]}
            />
          </Field>

          <Field label="Moderation" hint="low is accepted by GPT image models only.">
            <Segmented
              size="sm"
              value={params.moderation}
              onChange={(moderation) => patch({ moderation })}
              options={MODERATION_OPTIONS.map((item) => ({ value: item.value, label: item.label, title: item.hint }))}
            />
          </Field>

          <Field label="Response format" hint="GPT image models always return b64_json; older ones take response_format.">
            <Segmented
              size="sm"
              value={params.responseFormat}
              onChange={(responseFormat) => patch({ responseFormat })}
              options={[
                { value: 'inherit', label: 'Not sent' },
                { value: 'b64_json', label: 'b64_json' },
                { value: 'url', label: 'url' },
              ]}
            />
          </Field>

          <Field label="Legacy style" hint="vivid/natural belonged to DALL·E 3; describe style in the prompt instead.">
            <Segmented
              size="sm"
              value={params.legacyStyle}
              onChange={(legacyStyle) => patch({ legacyStyle })}
              options={[
                { value: 'inherit', label: 'Not sent' },
                { value: 'vivid', label: 'vivid' },
                { value: 'natural', label: 'natural' },
              ]}
            />
          </Field>

          <Field label="End-user id" hint="user field, for provider abuse monitoring. Optional.">
            <input
              className="input"
              placeholder="studio-user-42"
              value={params.user}
              onChange={(event) => patch({ user: event.target.value })}
            />
          </Field>

          <Field label="Extra JSON" hint="Merged last, so it can override anything above. Any provider-specific field goes here.">
            <textarea
              className="textarea font-mono text-[12px]"
              style={{ minHeight: 88 }}
              placeholder='{"seed": 42, "sd_cpp": {"sample_params": {"eta": 0.5}}}'
              value={params.extraJson}
              onChange={(event) => patch({ extraJson: event.target.value })}
            />
          </Field>
        </Collapse>

        {warnings.length ? (
          <ul className="space-y-1.5">
            {warnings.map((issue) => (
              <li key={issue.text} className="flex gap-2 text-[11.5px] leading-snug text-[var(--warn)]">
                <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                {issue.text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <footer
        className="shrink-0 space-y-2 border-t border-[var(--border)] px-3 py-3"
        style={{ background: 'color-mix(in oklab, var(--surface-solid) 78%, transparent)' }}
      >
        {blocking.length ? (
          <ul className="space-y-1">
            {blocking.map((issue) => (
              <li key={issue.text} className="flex gap-1.5 text-[11.5px] leading-snug text-[var(--danger)]">
                <CircleAlert size={13} className="mt-0.5 shrink-0" />
                {issue.text}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary flex-1"
            style={{ padding: '10px 14px', fontSize: 13.5 }}
            onClick={() => void runNow()}
            disabled={!canRun}
            title="Run this request (Ctrl/Cmd + Enter)"
          >
            <WandSparkles size={15} />
            {taskMeta.label}
            {images.length && taskMeta.needsUpload ? ` (${images.length})` : ''}
          </button>
          {running ? (
            <button type="button" className="btn btn-danger" onClick={cancel} title="Abort the request">
              <Square size={13} /> {formatClock(elapsed)}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => studio.setDrawer('curl')} title="Preview the request">
              <Braces size={13} />
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => studio.resetParams()}
            title="Reset these parameters to defaults"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </footer>
    </aside>
  );
}

function extensionBadge(params: Studio['params']) {
  const count = [
    params.negativePrompt.trim() !== '',
    params.strength !== null,
    params.inputFidelity !== 'inherit',
    params.moderation !== 'auto',
    params.responseFormat !== 'inherit',
    params.legacyStyle !== 'inherit',
    params.user.trim() !== '',
    params.extraJson.trim() !== '',
  ].filter(Boolean).length;
  if (!count) return null;
  return <span className="chip chip-accent">{count} sent</span>;
}
