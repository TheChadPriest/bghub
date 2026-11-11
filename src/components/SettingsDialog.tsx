import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useEngine } from '../engine/context';
import { Button, Dialog, Segmented } from './ui';

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [{ settings, model, isolated }, engine] = useEngine();
  const [cleared, setCleared] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="Settings">
      <div className="space-y-6 p-4 text-sm">
        <section className="space-y-2">
          <h3 className="font-medium">Images analysed at once</h3>
          <Segmented<string> label="Images analysed at once" value={String(settings.modelSlots)} onChange={v => engine.updateSettings({ modelSlots: Number(v) })}
            options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }]} />
          <p className="text-[12px] text-muted">
            Decoding and PNG export always run in parallel. This controls how many copies of the AI model run side by side.
            Each copy needs roughly 0.5–1 GB of memory, so lower it if the tab crashes on large batches.
          </p>
        </section>
        <section className="space-y-2">
          <h3 className="font-medium">Compute</h3>
          <Segmented<'auto' | 'webgpu' | 'wasm'> label="Compute backend" value={settings.backend} onChange={v => engine.updateSettings({ backend: v })}
            options={[{ value: 'auto', label: 'Automatic' }, { value: 'webgpu', label: 'GPU (WebGPU)' }, { value: 'wasm', label: 'CPU (WebAssembly)' }]} />
          <p className="text-[12px] text-muted">
            Currently: {model.phase === 'ready' ? `${model.backend === 'webgpu' ? 'GPU via WebGPU' : 'CPU via WebAssembly'}, ${model.slots} model ${model.slots === 1 ? 'copy' : 'copies'}` : 'model not loaded'}.
            {' '}Multi-threading: {isolated ? 'on' : 'off (page is not cross-origin isolated)'}.
          </p>
        </section>
        <section className="space-y-2">
          <h3 className="font-medium">Downloaded model</h3>
          <p className="text-[12px] text-muted">The AI model (~115 MB) and runtime are cached in this browser so they download once. They contain no photos.</p>
          <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={async () => { await engine.deleteDownloadedModel(); setCleared(true); }}>Delete downloaded model</Button>
          {cleared && <p className="text-[12px] text-ok">Deleted. It will download again next time you process an image.</p>}
        </section>
      </div>
    </Dialog>
  );
}
