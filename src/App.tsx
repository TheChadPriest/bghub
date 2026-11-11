import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download, X } from 'lucide-react';
import { useEngine } from './engine/context';
import { Header, type Route } from './components/Header';
import { Help } from './components/Help';
import { SettingsDialog } from './components/SettingsDialog';
import { Button, Dialog, IconButton, formatBytes } from './components/ui';
import { DropZone } from './features/upload/DropZone';
import { ModelBanner } from './features/results/ModelBanner';
import { BatchBar } from './features/results/BatchBar';
import { JobCard, type JobActions } from './features/results/JobCard';
import { CompareSlider } from './features/results/CompareSlider';
import { MaskEditor } from './features/editor/MaskEditor';
import { Studio } from './features/studio/Studio';
import { outputName } from './lib/filenames';
import { downloadBlob } from './lib/zip';

function parseHash(): { route: Route; id: string | null } {
  const h = location.hash.replace(/^#\/?/, '');
  const [r, id] = h.split('/');
  if (r === 'studio') return { route: 'studio', id: id ? decodeURIComponent(id) : null };
  if (r === 'help') return { route: 'help', id: null };
  return { route: 'remove', id: null };
}

function readTheme(): 'light' | 'dark' {
  try {
    const t = localStorage.getItem('bghub-theme');
    if (t === 'light' || t === 'dark') return t;
  } catch { /* storage unavailable */ }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const [snap, engine] = useEngine();
  const [{ route, id: studioId }, setLoc] = useState(parseHash);
  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme);
  const [settings, setSettings] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => {
    const on = () => { setLoc(parseHash()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = () => setTheme(t => {
    const n = t === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('bghub-theme', n); } catch { /* ignore */ }
    return n;
  });

  const onFiles = useCallback((files: File[]) => { void engine.addFiles(files); }, [engine]);

  const actions: JobActions = useMemo(() => ({
    onPreview: setPreviewId,
    onEdit: setEditId,
    onStudio: (id: string) => { location.hash = `#/studio/${encodeURIComponent(id)}`; },
    onRetry: id => engine.retry(id),
    onCancel: id => engine.cancel(id),
    onRemove: id => engine.remove(id),
    onSelect: (id, v) => engine.setSelected(id, v),
  }), [engine]);

  // Warn before leaving with unsaved results (nothing is stored persistently).
  const hasWork = snap.jobs.some(j => j.status !== 'failed' && j.status !== 'cancelled');
  useEffect(() => {
    if (!hasWork) return;
    const on = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, [hasWork]);

  const preview = previewId ? snap.jobs.find(j => j.id === previewId) : null;
  const editing = editId ? snap.jobs.find(j => j.id === editId) : null;
  const hasJobs = snap.jobs.length > 0;

  return (
    <div className="min-h-dvh">
      <Header route={route} theme={theme} onTheme={toggleTheme} onSettings={() => setSettings(true)} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
        {route === 'remove' && (
          <div className="space-y-5">
            {!hasJobs ? (
              <section className="mx-auto max-w-3xl space-y-6 pt-2 sm:pt-6">
                <div className="text-center">
                  <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Your product. <span className="whitespace-nowrap">No background.</span></h1>
                  <p className="mx-auto mt-3 max-w-xl text-muted sm:text-lg">Remove backgrounds from product photos right in your browser. Export transparent PNGs at full resolution, or place your item on a new scene.</p>
                </div>
                <DropZone onFiles={onFiles} />
                <ul className="grid gap-3 text-sm sm:grid-cols-3">
                  <li className="rounded-xl border border-line bg-panel p-3"><span className="font-medium">Full resolution</span><span className="block text-muted">Same width and height as your photo, lossless PNG.</span></li>
                  <li className="rounded-xl border border-line bg-panel p-3"><span className="font-medium">Batch friendly</span><span className="block text-muted">Add dozens of photos and keep adding while they run.</span></li>
                  <li className="rounded-xl border border-line bg-panel p-3"><span className="font-medium">Your item, untouched</span><span className="block text-muted">Only the background goes. Nothing is redrawn.</span></li>
                </ul>
              </section>
            ) : (
              <>
                <DropZone onFiles={onFiles} compact />
              </>
            )}

            {snap.rejections.length > 0 && (
              <div className="space-y-1.5 rounded-xl border border-line bg-panel p-3" role="status" data-testid="rejections">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Some files were not added</p>
                  <Button size="sm" variant="ghost" onClick={() => engine.clearRejections()}>Dismiss all</Button>
                </div>
                {snap.rejections.map(r => (
                  <div key={r.id} className="flex items-start gap-2 text-[13px]">
                    <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
                    <p className="min-w-0 flex-1"><span className="font-medium break-all">{r.name}</span> — {r.reason}</p>
                    <IconButton label="Dismiss" onClick={() => engine.dismissRejection(r.id)}><X size={14} /></IconButton>
                  </div>
                ))}
              </div>
            )}

            <ModelBanner />
            <BatchBar />

            {hasJobs && (
              <section aria-label="Results" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {snap.jobs.map(j => <JobCard key={j.id} job={j} actions={actions} />)}
              </section>
            )}
          </div>
        )}

        {route === 'studio' && (
          <Studio jobId={studioId} onPickJob={id => { location.hash = `#/studio/${encodeURIComponent(id)}`; }} onGoHome={() => { location.hash = '#/'; }} />
        )}
        {route === 'help' && <Help />}
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 pt-4 text-[12px] text-muted">
        BGhub runs entirely in your browser. No account, no uploads, no tracking.
      </footer>

      <Dialog open={!!preview?.result} onClose={() => setPreviewId(null)} title={preview?.name ?? ''} wide>
        {preview?.result && (
          <div className="space-y-3 p-4">
            <CompareSlider before={preview.originalUrl ?? preview.result.previewUrl} after={preview.result.previewUrl} alt={preview.name} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
              <span>{preview.result.width}×{preview.result.height} PNG · {formatBytes(preview.result.bytes)} · preview shown at reduced size; the download is full resolution</span>
              <Button variant="primary" size="sm" icon={<Download size={14} />} onClick={() => downloadBlob(preview.result!.blob, outputName(preview.name, '-cutout', 'png'))}>Download PNG</Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={!!editing} onClose={() => setEditId(null)} title={editing ? `Refine — ${editing.name}` : ''} full>
        {editing && <MaskEditor key={editing.id} jobId={editing.id} onDone={() => setEditId(null)} />}
      </Dialog>

      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}
