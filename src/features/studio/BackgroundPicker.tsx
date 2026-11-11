import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { CATEGORY_LABEL, PRESETS, type Preset, type PresetCategory } from './presets';

function Swatch({ preset, selected, onClick }: { preset: Preset; selected: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    // Thumbnails render lazily so opening the studio stays snappy.
    const id = requestIdleCallbackSafe(() => { try { preset.draw(ctx, c.width, c.height); } catch { ctx.fillStyle = '#888'; ctx.fillRect(0, 0, c.width, c.height); } });
    return () => cancelIdleCallbackSafe(id);
  }, [preset]);
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} title={preset.name}
      className={`group relative overflow-hidden rounded-lg border text-left transition ${selected ? 'border-ink ring-2 ring-ink' : 'border-line hover:border-muted'}`}>
      <canvas ref={ref} width={144} height={96} className="block aspect-[3/2] w-full" aria-hidden />
      <span className="block truncate px-1.5 py-1 text-[11px]">{preset.name}</span>
      {selected && <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-ink text-paper"><Check size={12} /></span>}
    </button>
  );
}

const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
const cic = (globalThis as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
function requestIdleCallbackSafe(cb: () => void): number { return ric ? ric(cb) : (setTimeout(cb, 1) as unknown as number); }
function cancelIdleCallbackSafe(id: number) { if (cic) cic(id); else clearTimeout(id); }

export function BackgroundPicker({ selectedId, onSelect }: { selectedId: string | null; onSelect: (p: Preset) => void }) {
  const [cat, setCat] = useState<PresetCategory | 'all'>('all');
  const cats: (PresetCategory | 'all')[] = ['all', 'surfaces', 'urban', 'solid', 'more'];
  const list = PRESETS.filter(p => cat === 'all' || p.category === cat);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Background categories">
        {cats.map(c => (
          <button key={c} type="button" role="tab" aria-selected={cat === c} onClick={() => setCat(c)}
            className={`rounded-full border px-2.5 py-1 text-[12px] ${cat === c ? 'border-ink bg-ink text-paper' : 'border-line hover:border-muted'}`}>
            {c === 'all' ? 'All' : CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2" data-testid="preset-grid">
        {list.map(p => <Swatch key={p.id} preset={p} selected={p.id === selectedId} onClick={() => onSelect(p)} />)}
      </div>
    </div>
  );
}
