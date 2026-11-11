import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eraser, Hand, Paintbrush, Redo2, RotateCcw, Undo2, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { useEngine } from '../../engine/context';
import { applyStroke, buildFinalMask, DEFAULT_REFINE, type Box, type BrushMode, type RefineOptions, type Stroke } from '../../lib/mask';
import { MODEL_SIZE } from '../../lib/preprocess';
import { Button, IconButton, Segmented, Slider, Toggle } from '../../components/ui';

type View = 'cutout' | 'overlay' | 'original';
type Tool = BrushMode | 'pan';

interface Source { rgba: Uint8ClampedArray; width: number; height: number }

/**
 * Manual correction edits ONLY the alpha mask. Source RGB is never painted on.
 */
export function MaskEditor({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const [, engine] = useEngine();
  const job = engine.getJob(jobId);
  const [src, setSrc] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refine, setRefine] = useState<RefineOptions>(job?.refine ?? DEFAULT_REFINE);
  const [strokes, setStrokes] = useState<Stroke[]>(job?.strokes ?? []);
  const [redo, setRedo] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>('erase');
  const [brush, setBrush] = useState(40);
  const [softness, setSoftness] = useState(30);
  const [view, setView] = useState<View>('overlay');
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const base = useRef<Uint8Array | null>(null);
  const mask = useRef<Uint8Array | null>(null);
  const drawing = useRef<Stroke | null>(null);
  const skipReplay = useRef(false);

  useEffect(() => {
    let alive = true;
    engine.loadSource(jobId).then(s => { if (alive) setSrc(s); }).catch(e => alive && setError(e.message));
    return () => { alive = false; };
  }, [engine, jobId]);

  const paint = useCallback((box?: Box | null) => {
    const c = canvasRef.current, s = src, m = mask.current;
    if (!c || !s || !m) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const b = box ?? { x: 0, y: 0, w: s.width, h: s.height };
    const img = ctx.createImageData(b.w, b.h);
    const d = img.data, p = s.rgba;
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const i = (b.y + y) * s.width + b.x + x, si = i * 4, di = (y * b.w + x) * 4;
        const a = m[i];
        if (view === 'cutout') {
          d[di] = p[si]; d[di + 1] = p[si + 1]; d[di + 2] = p[si + 2]; d[di + 3] = (p[si + 3] * a) / 255;
        } else if (view === 'original') {
          d[di] = p[si]; d[di + 1] = p[si + 1]; d[di + 2] = p[si + 2]; d[di + 3] = p[si + 3];
        } else {
          const k = a / 255;
          d[di] = p[si] * k + (p[si] * 0.45 + 255 * 0.55) * (1 - k);
          d[di + 1] = p[si + 1] * k + p[si + 1] * 0.45 * (1 - k);
          d[di + 2] = p[si + 2] * k + (p[si + 2] * 0.45 + 60 * 0.55) * (1 - k);
          d[di + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, b.x, b.y);
  }, [src, view]);

  // Rebuild base mask when refinement changes; replay strokes on top.
  // A freshly drawn stroke is already in the mask, so it needs no replay.
  const baseRefine = useRef<RefineOptions | null>(null);
  useEffect(() => {
    if (!src || !job?.modelMask) return;
    if (skipReplay.current) { skipReplay.current = false; return; }
    const t = setTimeout(() => {
      if (!base.current || baseRefine.current !== refine) {
        base.current = buildFinalMask(job.modelMask!, MODEL_SIZE, src.width, src.height, refine, []);
        baseRefine.current = refine;
      }
      const m = base.current.slice();
      for (const s of strokes) applyStroke(m, src.width, src.height, s);
      mask.current = m;
      paint();
    }, 60);
    return () => clearTimeout(t);
  }, [src, refine, strokes, job?.modelMask, paint]);

  const toImage = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height), scale: c.width / r.width };
  };

  const onDown = (e: React.PointerEvent) => {
    if (tool === 'pan' || !src || !mask.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toImage(e);
    drawing.current = { mode: tool, radius: (brush / 2) * p.scale, hardness: 1 - softness / 100, points: [p.x, p.y] };
    paint(applyStroke(mask.current, src.width, src.height, drawing.current));
  };
  const onMove = (e: React.PointerEvent) => {
    const cur = cursorRef.current;
    if (cur) {
      const host = cur.parentElement!.getBoundingClientRect();
      cur.style.transform = `translate(${e.clientX - host.left - brush / 2}px, ${e.clientY - host.top - brush / 2}px)`;
      cur.style.opacity = tool === 'pan' ? '0' : '1';
    }
    const s = drawing.current;
    if (!s || !src || !mask.current) return;
    const p = toImage(e);
    const n = s.points.length;
    s.points.push(p.x, p.y);
    paint(applyStroke(mask.current, src.width, src.height, { ...s, points: [s.points[n - 2], s.points[n - 1], p.x, p.y] }));
  };
  const onUp = () => {
    const s = drawing.current;
    drawing.current = null;
    if (s) { skipReplay.current = true; setStrokes(prev => [...prev, s]); setRedo([]); }
  };

  const undo = () => setStrokes(prev => { if (!prev.length) return prev; setRedo(r => [...r, prev[prev.length - 1]]); return prev.slice(0, -1); });
  const redoOne = () => setRedo(r => { if (!r.length) return r; setStrokes(s => [...s, r[r.length - 1]]); return r.slice(0, -1); });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') { e.preventDefault(); redoOne(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const apply = async () => {
    if (!src || !mask.current) return;
    setSaving(true);
    try { await engine.applyEdit(jobId, src.rgba, mask.current, src.width, src.height, refine, strokes); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Export failed'); }
    finally { setSaving(false); }
  };

  const cssWidth = useMemo(() => `${zoom * 100}%`, [zoom]);

  if (!job?.modelMask) return <p className="p-6 text-sm">This image has no mask to edit yet.</p>;
  if (error) return <p className="p-6 text-sm text-danger" role="alert">{error}</p>;
  if (!src) return <p className="p-6 text-sm text-muted">Loading full-resolution image…</p>;

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <div className="relative min-h-[45dvh] flex-1 overflow-auto bg-panel-2 checker" data-testid="editor-viewport">
        <div className="relative mx-auto" style={{ width: cssWidth, maxWidth: zoom === 1 ? `min(100%, ${(src.width / src.height) * 78}dvh)` : undefined }}>
          <canvas ref={canvasRef} width={src.width} height={src.height}
            className="block h-auto w-full"
            style={{ touchAction: tool === 'pan' ? 'auto' : 'none', cursor: tool === 'pan' ? 'grab' : 'none' }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            onPointerLeave={() => { if (cursorRef.current) cursorRef.current.style.opacity = '0'; }}
            aria-label="Mask editing canvas" data-testid="editor-canvas" />
          <div ref={cursorRef} aria-hidden className="pointer-events-none absolute left-0 top-0 rounded-full border-2 border-white opacity-0 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]" style={{ width: brush, height: brush }} />
        </div>
      </div>

      <aside className="w-full shrink-0 space-y-5 overflow-y-auto border-t border-line p-4 lg:w-80 lg:border-l lg:border-t-0">
        <section className="space-y-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Brush</h3>
          <Segmented<Tool> label="Tool" value={tool} onChange={setTool} options={[{ value: 'erase', label: 'Erase' }, { value: 'restore', label: 'Restore' }, { value: 'pan', label: 'Pan' }]} />
          <p className="flex items-center gap-1.5 text-[12px] text-muted">
            {tool === 'erase' ? <><Eraser size={13} /> Paint over leftover background to remove it.</> : tool === 'restore' ? <><Paintbrush size={13} /> Paint over missing parts of the item to bring them back.</> : <><Hand size={13} /> Scroll or drag to move around when zoomed.</>}
          </p>
          <Slider label="Brush size" value={brush} min={4} max={200} onChange={setBrush} format={v => `${v}px`} />
          <Slider label="Brush softness" value={softness} min={0} max={100} onChange={setSoftness} format={v => `${v}%`} />
          <div className="flex gap-1">
            <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!strokes.length}><Undo2 size={16} /></IconButton>
            <IconButton label="Redo (Ctrl+Shift+Z)" onClick={redoOne} disabled={!redo.length}><Redo2 size={16} /></IconButton>
            <IconButton label="Zoom out" onClick={() => setZoom(z => Math.max(1, z / 1.5))} disabled={zoom <= 1}><ZoomOut size={16} /></IconButton>
            <IconButton label="Zoom in" onClick={() => setZoom(z => Math.min(8, z * 1.5))}><ZoomIn size={16} /></IconButton>
            <IconButton label="Fit to screen" onClick={() => setZoom(1)}><Maximize size={16} /></IconButton>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">View</h3>
          <Segmented<View> label="View" value={view} onChange={setView} options={[{ value: 'overlay', label: 'Overlay' }, { value: 'cutout', label: 'Cutout' }, { value: 'original', label: 'Before' }]} />
          <p className="text-[12px] text-muted">Overlay tints removed areas red over the original photo.</p>
        </section>

        <section className="space-y-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Edges</h3>
          <Slider label="Edge hardness" value={refine.hardness} min={0} max={100} onChange={v => setRefine(r => ({ ...r, hardness: v }))} format={v => (v === 0 ? 'Model default' : `${v}`)} />
          <Toggle label="Remove faint haze" hint="Snaps nearly-transparent and nearly-opaque pixels" checked={refine.cleanup} onChange={v => setRefine(r => ({ ...r, cleanup: v }))} />
        </section>

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button variant="primary" onClick={apply} disabled={saving} data-testid="editor-apply">{saving ? 'Saving…' : 'Apply changes'}</Button>
          <Button variant="ghost" icon={<RotateCcw size={15} />} onClick={() => { setStrokes([]); setRedo([]); setRefine(DEFAULT_REFINE); }}>Reset mask</Button>
        </div>
        <p className="text-[12px] text-muted">Edits change only transparency. The photo’s pixels are never repainted.</p>
      </aside>
    </div>
  );
}
