/** Small presentational primitives. Styling lives in styles/globals.css, so these stay thin. */

import { AlertTriangle, Check, Info, X, XCircle } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/* ---------------------------------------------------------------- drawer */
export function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
  width = 420,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[55]"
      style={{ background: 'color-mix(in oklab, #000 45%, transparent)', backdropFilter: 'blur(3px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="absolute inset-y-0 right-0 flex flex-col border-l border-[var(--border)]"
        style={{
          width: `min(${width}px, 100vw)`,
          background: 'color-mix(in oklab, var(--surface-solid) 92%, transparent)',
          backdropFilter: 'blur(20px)',
          boxShadow: '-30px 0 70px -40px rgba(0,0,0,.8)',
          animation: 'slide-in .22s cubic-bezier(.2,.8,.2,1) both',
        }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-[13.5px] font-semibold">{title}</h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close panel">
            <X size={15} />
          </button>
        </header>
        <div className="scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? <footer className="shrink-0 border-t border-[var(--border)] px-4 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- ticker */
/** Re-renders on an interval while active, for elapsed-time readouts. */
export function useTicker(active: boolean, intervalMs = 250): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => force((value) => value + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
}

/* ------------------------------------------------------------- segmented */
export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  title?: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: Array<SegmentOption<T>>;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="seg" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          title={option.title}
          disabled={option.disabled}
          data-active={value === option.value}
          className="seg-item"
          style={size === 'sm' ? { padding: '4px 8px', fontSize: 11.5 } : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- field */
export function Field({
  label,
  hint,
  action,
  children,
}: {
  label: string;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="label">
        <span>{label}</span>
        {action}
      </div>
      {children}
      {hint ? <p className="hint mt-1.5">{hint}</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- slider */
export function Slider({
  value,
  min,
  max,
  step = 1,
  defaultValue,
  onChange,
  format = (input: number) => String(input),
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        className="slider"
        style={{ ['--fill' as string]: `${fill}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="tabular w-12 text-right text-[12px] text-[var(--text)]">
        {format(value)}
        {defaultValue !== undefined && value !== defaultValue ? (
          <button
            type="button"
            className="ml-1 text-[var(--faint)] hover:text-[var(--text)]"
            title={`Reset to ${format(defaultValue)}`}
            onClick={() => onChange(defaultValue)}
          >
            ↺
          </button>
        ) : null}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- switch */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  icon,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[13px] font-medium">
          {icon}
          {label}
        </div>
        {hint ? <p className="hint mt-0.5">{hint}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="switch"
        data-on={checked}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------- collapse */
export function Collapse({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel-flat overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[12px] font-semibold tracking-wide text-[var(--muted)]">
          {title}
          {badge}
        </span>
        <span className="text-[var(--faint)] transition-transform duration-200" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>
          ›
        </span>
      </button>
      {open ? <div className="space-y-3 border-t border-[var(--border)] px-3 pb-3 pt-3">{children}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- modal */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 560,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'color-mix(in oklab, #000 62%, transparent)', backdropFilter: 'blur(6px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="panel pop w-full overflow-hidden" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-[13.5px] font-semibold">{title}</h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="scroll max-h-[70vh] overflow-auto px-4 py-4">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- toasts */
export type ToastKind = 'error' | 'ok' | 'warn' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
}

interface ToastApi {
  push: (toast: Omit<Toast, 'id'> & { id?: string }) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}

const TOAST_ICONS: Record<ToastKind, ReactNode> = {
  error: <XCircle size={15} style={{ color: 'var(--danger)' }} />,
  ok: <Check size={15} style={{ color: 'var(--ok)' }} />,
  warn: <AlertTriangle size={15} style={{ color: 'var(--warn)' }} />,
  info: <Info size={15} style={{ color: 'var(--accent-2)' }} />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback<ToastApi['push']>(
    (toast) => {
      const id = toast.id ?? Math.random().toString(36).slice(2);
      setToasts((current) => [...current.filter((item) => item.id !== id), { ...toast, id }].slice(-4));
      const duration = toast.kind === 'error' ? 9000 : 4200;
      timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
    },
    [dismiss],
  );

  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((toast) => (
          <div key={toast.id} className="panel rise pointer-events-auto flex items-start gap-2.5 px-3 py-2.5">
            <span className="mt-0.5">{TOAST_ICONS[toast.kind]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold leading-snug">{toast.title}</p>
              {toast.detail ? (
                <p className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap text-[11.5px] leading-snug text-[var(--muted)]">
                  {toast.detail}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------------ empty state */
export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-2xl"
        style={{
          background: 'color-mix(in oklab, var(--accent) 16%, transparent)',
          border: '1px solid color-mix(in oklab, var(--accent) 35%, transparent)',
          color: 'var(--accent-2)',
        }}
      >
        {icon}
      </div>
      <h3 className="text-[14px] font-semibold">{title}</h3>
      {children ? <div className="max-w-md text-[12.5px] leading-relaxed text-[var(--muted)]">{children}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- meta row */
export function Meta({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">
      {items.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-[var(--faint)]">{key}</dt>
          <dd className="tabular text-right text-[var(--muted)]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
