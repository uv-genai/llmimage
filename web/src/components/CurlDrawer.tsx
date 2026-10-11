import { useState } from 'react';
import { Check, Copy, Send } from 'lucide-react';
import { Drawer, useToast } from './ui';
import { buildGenerationBody, buildMultipart } from '../lib/params';
import type { Studio } from '../lib/useStudio';

/** Exactly what will go over the wire — the fastest way to debug a picky endpoint. */
export function CurlDrawer({ studio }: { studio: Studio }) {
  const { curl, task, params, images, mask, resolvedBaseUrl, hasCredential } = studio;
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const fields =
    task === 'generate'
      ? Object.entries(buildGenerationBody(params)).map(([key, value]) => [key, display(value)] as const)
      : Object.entries(buildMultipart(task, params, images, mask?.blob ?? null).body);

  const copy = () => {
    void navigator.clipboard.writeText(curl.payload).then(() => {
      setCopied(true);
      toast.push({ kind: 'ok', title: 'curl copied to clipboard' });
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <Drawer
      open={studio.drawer === 'curl'}
      title="Request preview"
      onClose={() => studio.setDrawer(null)}
      width={520}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="hint">{fields.length} field{fields.length === 1 ? '' : 's'} will be sent</span>
          <span className="flex gap-2">
            <button type="button" className="btn" onClick={copy}>
              {copied ? <Check size={12} /> : <Copy size={12} />} Copy curl
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void studio.runNow()} disabled={studio.running}>
              <Send size={12} /> Run
            </button>
          </span>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="sunken p-3">
          <p className="font-mono text-[12px]">
            <span className="text-[var(--accent-2)]">{curl.method}</span>{' '}
            <span className="break-all">{curl.url}</span>
          </p>
          <p className="mt-1.5 font-mono text-[11.5px] text-[var(--faint)]">
            Content-Type: {curl.contentType}
            {hasCredential ? '\nAuthorization: Bearer $API_KEY' : '\n(no credential configured)'}
          </p>
          {!resolvedBaseUrl ? <p className="mt-1.5 text-[11.5px] text-[var(--warn)]">No base URL set — configure it in Settings.</p> : null}
        </div>

        <section>
          <h3 className="section-title mb-2">Fields</h3>
          {fields.length ? (
            <table className="w-full text-[11.5px]">
              <tbody>
                {fields.map(([key, value]) => (
                  <tr key={key} className="align-top">
                    <td className="w-[38%] py-1 pr-2 font-mono text-[var(--accent-2)]">{key}</td>
                    <td className="py-1 font-mono break-all text-[var(--muted)]">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint">No optional fields; only the defaults would travel.</p>
          )}
          <p className="hint mt-2">
            Fields left at their default are omitted on purpose: strict gateways answer 400 for parameters they do not
            implement.
          </p>
        </section>

        <section>
          <h3 className="section-title mb-2">curl</h3>
          <pre
            className="scroll max-h-[38vh] overflow-auto rounded-xl border border-[var(--border)] p-3 font-mono text-[11.5px] leading-relaxed"
            style={{ background: 'var(--sunken)', whiteSpace: 'pre-wrap' }}
          >
            {curl.payload}
          </pre>
        </section>
      </div>
    </Drawer>
  );
}

function display(value: unknown): string {
  if (typeof value === 'string') return value.length > 240 ? `${value.slice(0, 240)}…` : value;
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}
