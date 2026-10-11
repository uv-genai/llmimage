import { useEffect, useState } from 'react';
import { ControlsPanel } from './components/ControlsPanel';
import { CurlDrawer } from './components/CurlDrawer';
import { Header } from './components/Header';
import { HistoryDrawer } from './components/HistoryDrawer';
import { Lightbox } from './components/Lightbox';
import { MaskEditor } from './components/MaskEditor';
import { SettingsDrawer } from './components/SettingsDrawer';
import { Stage } from './components/Stage';
import { Modal, ToastProvider } from './components/ui';
import { useStudio } from './lib/useStudio';

export default function App() {
  return (
    <ToastProvider>
      <Workspace />
    </ToastProvider>
  );
}

function Workspace() {
  const studio = useStudio();
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void studio.runNow();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Escape') studio.setDrawer(null);
      else if (event.key === '1' || event.key.toLowerCase() === 'g') studio.setTask('generate');
      else if (event.key === '2' || event.key.toLowerCase() === 'e') studio.setTask('edit');
      else if (event.key === '3' || event.key.toLowerCase() === 'v') studio.setTask('vary');
      else if (event.key.toLowerCase() === 'h') studio.setDrawer(studio.drawer === 'history' ? null : 'history');
      else if (event.key.toLowerCase() === 's') studio.setDrawer(studio.drawer === 'settings' ? null : 'settings');
      else if (event.key.toLowerCase() === 'r') void studio.refreshModels(true);
      else if (event.key === '?') setShowShortcuts(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [studio]);

  return (
    <>
      <div className="relative flex h-dvh flex-col overflow-hidden">
        {studio.settings.showGrid ? (
          <>
            <div className="aurora">
              <span />
              <span />
              <span />
            </div>
            <div className="grid-lines" />
            <div className="grain" />
          </>
        ) : null}

        <Header studio={studio} />

        <div className="relative z-10 flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(320px,378px)_1fr]">
          <div className="order-2 max-h-[68vh] min-h-0 shrink-0 border-t border-[var(--border)] lg:order-1 lg:max-h-none lg:border-t-0">
            <ControlsPanel studio={studio} />
          </div>
          <div className="order-1 min-h-[46vh] flex-1 lg:order-2 lg:min-h-0">
            <Stage studio={studio} />
          </div>
        </div>
      </div>

      <SettingsDrawer studio={studio} />
      <HistoryDrawer studio={studio} />
      <CurlDrawer studio={studio} />
      <MaskEditor studio={studio} />
      <Lightbox studio={studio} />

      <Modal open={showShortcuts} title="Keyboard" onClose={() => setShowShortcuts(false)} width={420}>
        <ul className="space-y-1.5 text-[12.5px]">
          {SHORTCUTS.map(([keys, description]) => (
            <li key={keys} className="flex items-center justify-between gap-4">
              <span className="text-[var(--muted)]">{description}</span>
              <span className="kbd">{keys}</span>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl/⌘ + Enter', 'Run the current task'],
  ['G / E / V', 'Generate · Edit · Vary'],
  ['1 / 2 / 3', 'Same, by number'],
  ['H', 'History panel'],
  ['S', 'Settings panel'],
  ['R', 'Refresh model list'],
  ['Ctrl/⌘ + V', 'Paste an image into Edit'],
  ['← / →', 'Page images in the viewer'],
  ['D', 'Download the shown image'],
  ['Esc', 'Close panels'],
  ['?', 'This list'],
];
