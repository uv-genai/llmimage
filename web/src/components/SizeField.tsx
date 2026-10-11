import { useEffect, useState } from 'react';
import { SIZE_PRESETS } from '../lib/presets';
import { parseSize } from '../lib/params';

/** Preset picker plus free width/height, because newer models take arbitrary sizes. */
export function SizeField({ value, onChange }: { value: string; onChange: (size: string) => void }) {
  const parsed = parseSize(value);
  const isPreset = SIZE_PRESETS.some((preset) => preset.value === value);
  const [width, setWidth] = useState(String(parsed?.width ?? 1024));
  const [height, setHeight] = useState(String(parsed?.height ?? 1024));

  // Keep the numeric boxes in step when a preset is chosen elsewhere.
  useEffect(() => {
    if (parsed) {
      setWidth(String(parsed.width));
      setHeight(String(parsed.height));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const applyCustom = () => {
    const w = Math.max(16, Math.min(8192, Number(width) || 1024));
    const h = Math.max(16, Math.min(8192, Number(height) || 1024));
    onChange(`${w}x${h}`);
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1.5">
        {SIZE_PRESETS.map((preset) => {
          const active = value === preset.value;
          const ratioBox =
            preset.value === 'auto'
              ? null
              : (() => {
                  const [w, h] = preset.value.split('x').map(Number);
                  const scale = 22 / Math.max(w, h);
                  return { w: Math.max(8, w * scale), h: Math.max(8, h * scale) };
                })();
          return (
            <button
              key={preset.value}
              type="button"
              onClick={() => onChange(preset.value)}
              title={`${preset.label} · ${preset.hint}`}
              className="flex flex-col items-center gap-1 rounded-xl border px-1 py-2 transition-colors"
              style={{
                borderColor: active ? 'color-mix(in oklab, var(--accent) 60%, transparent)' : 'var(--border)',
                background: active ? 'color-mix(in oklab, var(--accent) 14%, transparent)' : 'var(--sunken)',
              }}
            >
              <span className="grid h-6 place-items-center">
                {ratioBox ? (
                  <span
                    style={{
                      width: ratioBox.w,
                      height: ratioBox.h,
                      borderRadius: 3,
                      border: `1.5px solid ${active ? 'var(--accent-2)' : 'var(--faint)'}`,
                    }}
                  />
                ) : (
                  <span className="text-[13px] text-[var(--faint)]">∗</span>
                )}
              </span>
              <span className="text-[10px] font-medium text-[var(--muted)]">{preset.ratio}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          className="input tabular"
          inputMode="numeric"
          value={width}
          onChange={(event) => setWidth(event.target.value.replace(/\D/g, ''))}
          onBlur={applyCustom}
          onKeyDown={(event) => event.key === 'Enter' && applyCustom()}
          aria-label="Width in pixels"
        />
        <span className="text-[var(--faint)]">×</span>
        <input
          className="input tabular"
          inputMode="numeric"
          value={height}
          onChange={(event) => setHeight(event.target.value.replace(/\D/g, ''))}
          onBlur={applyCustom}
          onKeyDown={(event) => event.key === 'Enter' && applyCustom()}
          aria-label="Height in pixels"
        />
        <button type="button" className="btn" onClick={applyCustom} title="Apply custom size">
          Set
        </button>
      </div>
      <p className="hint">
        {isPreset ? value : `${value} (custom)`} · GPT image wants multiples of 16, stable-diffusion.cpp engines 32, and
        both cap total pixels.
      </p>
    </div>
  );
}
