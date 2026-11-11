import { AlertTriangle, Cpu, RefreshCw } from 'lucide-react';
import { useEngine } from '../../engine/context';
import { Button, Progress, formatBytes } from '../../components/ui';

export function ModelBanner() {
  const [{ model }, engine] = useEngine();
  if (model.phase === 'idle' || model.phase === 'ready') return null;
  if (model.phase === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-panel p-4 text-sm">
        <AlertTriangle size={18} className="text-danger" />
        <p className="flex-1 min-w-[200px]">{model.message}</p>
        <Button size="sm" icon={<RefreshCw size={14} />} onClick={() => engine.reloadModel()}>Reload model</Button>
      </div>
    );
  }
  const downloading = model.phase === 'downloading';
  const pct = downloading && model.total ? model.loaded / model.total : null;
  return (
    <div className="rounded-xl border border-line bg-panel p-4" aria-live="polite" data-testid="model-banner">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <Cpu size={16} />
        {downloading
          ? (model.fromCache
            ? <span>Loading the AI model from this browser’s cache…</span>
            : <span>Downloading the AI model once ({formatBytes(model.loaded)} of {formatBytes(model.total)}). It is cached for next time.</span>)
          : <span>Starting the AI model ({model.backend === 'webgpu' ? 'GPU' : 'CPU'})…</span>}
      </div>
      <Progress value={downloading ? pct : null} />
      <p className="mt-2 text-[12px] text-muted">You can keep adding images — they’ll be decoded now and analysed as soon as the model is ready.</p>
    </div>
  );
}
