import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Crosshair, Download, ImagePlus, Maximize2, RotateCcw, Upload } from 'lucide-react';
import { useEngine } from '../../engine/context';
import { canvasSize, DEFAULT_PLACEMENT, overflows, placeSubject, type AspectChoice, type Placement } from '../../lib/compose';
import { outputName } from '../../lib/filenames';
import { downloadBlob } from '../../lib/zip';
import { Button, Segmented, Slider, Toggle, formatBytes } from '../../components/ui';
import { BackgroundPicker } from './BackgroundPicker';
import { presetById, type Preset } from './presets';
import { exportScene, renderScene, type BackgroundChoice, type Scene } from './render';
import { ACCEPT } from '../upload/DropZone';

type BgMode = 'transparent' | 'upload' | 'library';
const PREVIEW_MAX = 1400;

export function Studio({ jobId, onPickJob, onGoHome }: { jobId: string | null; onPickJob: (id: string) => void; onGoHome: () => void }) {
  const [{ jobs }, engine] = useEngine();
  const done = jobs.filter(j => j.status === 'done' && j.result);
  const job = done.find(j => j.id === jobId) ?? done[0] ?? null;

  const [subject, setSubject] = useState<{ bitmap: ImageBitmap; key: string } | null>(null);
  const [mode, setMode] = useState<BgMode>('library');
  const [preset, setPreset] = useState<Preset>(presetById('studio-white')!);
  const [upload, setUpload] = useState<{ bitmap: ImageBitmap; name: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [aspect, setAspect] = useState<AspectChoice>('subject');
  const [placement, setPlacement] = useState<Placement>(DEFAULT_PLACEMENT);
  const [shadow, setShadow] = useState(false);
  const [showBg, setShowBg] = useState(true);
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [quality, setQuality] = useState(92);
  const [exporting, setExporting] = useState(false);
  // Rendering is async, and browsers block downloads that are not a direct click,
  // so "Create image" renders and a separate "Save image" link downloads it.
  const [lastExport, setLastExport] = useState<{ text: string; url?: string; name?: string; error?: boolean; key: string } | null>(null);
  useEffect(() => () => { if (lastExport?.url) setTimeout(() => URL.revokeObjectURL(lastExport.url!), 60_000); }, [lastExport]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Decode the full-resolution cutout PNG for compositing.
  const resultKey = job?.result?.url ?? '';
  useEffect(() => {
    if (!job?.result) { setSubject(null); return; }
    let alive = true;
    createImageBitmap(job.result.blob).then(b => { if (alive) setSubject({ bitmap: b, key: resultKey }); else b.close(); });
    return () => { alive = false; };
  }, [resultKey, job?.result]);
  useEffect(() => () => subject?.bitmap.close(), [subject]);
  useEffect(() => () => upload?.bitmap.close(), [upload]);

  const background: BackgroundChoice = mode === 'transparent' || (mode === 'upload' && !upload)
    ? { type: 'transparent' }
    : mode === 'upload' ? { type: 'image', bitmap: upload!.bitmap, name: upload!.name } : { type: 'preset', preset };

  const result = job?.result;
  const bbox = useMemo(() => result?.bbox ?? (result ? { x: 0, y: 0, w: result.width, h: result.height } : null), [result]);
  const size = useMemo(() => {
    if (!job?.result) return { w: 1000, h: 1000 };
    const src = bbox && aspect === 'subject' ? { w: Math.max(bbox.w, 1), h: Math.max(bbox.h, 1) } : { w: job.result.width, h: job.result.height };
    // "Subject" aspect frames the visible item with breathing room, at the photo's resolution.
    const base = aspect === 'subject' ? { w: Math.round(src.w / (1 - 2 * 0.08)), h: Math.round(src.h / (1 - 2 * 0.08)) } : src;
    return canvasSize(aspect, base, upload && mode === 'upload' ? { w: upload.bitmap.width, h: upload.bitmap.height } : undefined);
  }, [job?.result, bbox, aspect, upload, mode]);

  const scene: Scene | null = subject && bbox && subject.key === resultKey
    ? { width: size.w, height: size.h, background, subject: { bitmap: subject.bitmap, bbox }, placement, shadow }
    : null;

  const preview = useMemo(() => {
    const s = Math.min(1, PREVIEW_MAX / Math.max(size.w, size.h));
    return { w: Math.round(size.w * s), h: Math.round(size.h * s) };
  }, [size]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !scene) return;
    const id = requestAnimationFrame(() => {
      const ctx = c.getContext('2d');
      if (ctx) renderScene(ctx, c.width, c.height, scene, { showBackground: showBg });
    });
    return () => cancelAnimationFrame(id);
  });

  // Drag the subject directly on the canvas.
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: placement.offsetX, oy: placement.offsetY };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPlacement(p => ({ ...p, offsetX: clampOff(d.ox + (e.clientX - d.x) / r.width), offsetY: clampOff(d.oy + (e.clientY - d.y) / r.height) }));
  };

  const onUpload = async (f: File | undefined) => {
    if (!f) return;
    setUploadError(null);
    try {
      const bitmap = await engine.decodeStandalone(f);
      setUpload({ bitmap, name: f.name });
      setMode('upload');
      setAspect('background');
    } catch (e) { setUploadError(e instanceof Error ? e.message : 'That background could not be opened.'); }
  };

  const sceneKey = JSON.stringify([resultKey, mode, preset.id, upload?.name, upload?.bitmap.width, aspect, placement, shadow, format, quality]);
  const prepared = lastExport && lastExport.key === sceneKey ? lastExport : null;

  const doExport = async () => {
    if (!scene || !job) return;
    setExporting(true);
    const key = sceneKey;
    try {
      const blob = await exportScene(scene, format, quality / 100);
      const name = outputName(job.name, '-studio', format === 'png' ? 'png' : 'jpg');
      setLastExport({ text: `${format.toUpperCase()} · ${scene.width}×${scene.height} · ${formatBytes(blob.size)}`, url: URL.createObjectURL(blob), name, key });
    } catch (e) {
      console.error(e);
      setLastExport({ text: 'Export failed — the canvas may be too large for this device. Try a smaller aspect or JPEG.', error: true, key });
    } finally { setExporting(false); }
  };

  if (!done.length) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-line bg-panel p-8 text-center">
        <ImagePlus className="mx-auto mb-3" />
        <h2 className="font-display text-xl font-semibold">Remove a background first</h2>
        <p className="mt-1 text-sm text-muted">The studio places your finished cutouts on new backgrounds. Process a photo, then come back here.</p>
        <Button variant="primary" className="mt-4" onClick={onGoHome}>Remove a background</Button>
      </div>
    );
  }

  const dest = scene ? placeSubject(scene.width, scene.height, bbox!, placement) : null;
  const over = dest && scene ? overflows(scene.width, scene.height, dest) : false;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-3">
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Choose a cutout">
          {done.map(j => (
            <button key={j.id} type="button" onClick={() => onPickJob(j.id)} aria-pressed={j.id === job?.id} title={j.name}
              className={`checker h-16 w-16 shrink-0 overflow-hidden rounded-lg border ${j.id === job?.id ? 'border-ink ring-2 ring-ink' : 'border-line'}`}>
              <img src={j.result!.previewUrl} alt={j.name} className="h-full w-full object-contain" />
            </button>
          ))}
        </div>
        <div className="checker grid place-items-center overflow-hidden rounded-2xl border border-line p-2 sm:p-4">
          <canvas ref={canvasRef} width={preview.w} height={preview.h} data-testid="studio-canvas"
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
            className="block h-auto max-h-[70dvh] w-auto max-w-full cursor-move rounded shadow-sm" style={{ touchAction: 'none', aspectRatio: `${preview.w} / ${preview.h}` }}
            aria-label="Composition preview. Drag to move the item." />
        </div>
        <p className="text-[12px] text-muted">
          Output {size.w}×{size.h}px · drag the item to position it · the checkerboard means transparent.
          {over && <span className="ml-1 inline-flex items-center gap-1 text-warn"><AlertTriangle size={12} /> The item extends past the edge and will be cropped there.</span>}
        </p>
      </div>

      <aside className="space-y-5 rounded-2xl border border-line bg-panel p-4">
        <section className="space-y-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Background</h3>
          <Segmented<BgMode> label="Background type" value={mode} onChange={m => { setMode(m); if (m !== 'upload' && aspect === 'background') setAspect('subject'); }}
            options={[{ value: 'library', label: 'Library' }, { value: 'upload', label: 'Upload' }, { value: 'transparent', label: 'Transparent' }]} />
          {mode === 'library' && <BackgroundPicker selectedId={preset.id} onSelect={setPreset} />}
          {mode === 'upload' && (
            <div className="space-y-2">
              <input ref={fileRef} type="file" accept={ACCEPT} className="sr-only" data-testid="bg-input" tabIndex={-1} aria-hidden="true" onChange={e => { onUpload(e.target.files?.[0]); e.target.value = ''; }} />
              <Button icon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>{upload ? 'Replace background' : 'Upload background'}</Button>
              {upload && <p className="truncate text-[12px] text-muted">{upload.name} · {upload.bitmap.width}×{upload.bitmap.height}</p>}
              {uploadError && <p className="text-[12px] text-danger" role="alert">{uploadError}</p>}
              <p className="text-[12px] text-muted">Your background stays on this device. HEIC works too.</p>
            </div>
          )}
          {mode === 'transparent' && <p className="text-[12px] text-muted">Exports keep real transparency. The checkerboard is never saved into the file.</p>}
        </section>

        <section className="space-y-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Canvas</h3>
          <Segmented<AspectChoice> label="Canvas shape" value={aspect} onChange={setAspect}
            options={[{ value: 'subject', label: 'Auto' }, ...(mode === 'upload' && upload ? [{ value: 'background' as const, label: 'Background' }] : []), { value: '1:1', label: '1:1' }, { value: '4:5', label: '4:5' }, { value: '3:4', label: '3:4' }, { value: '16:9', label: '16:9' }]} />
        </section>

        <section className="space-y-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Placement</h3>
          <Segmented<'fit' | 'original'> label="Size mode" value={placement.mode} onChange={m => setPlacement(p => ({ ...p, mode: m, scale: 1 }))}
            options={[{ value: 'fit', label: 'Fit inside' }, { value: 'original', label: 'Original pixels' }]} />
          <Slider label="Scale" value={Math.round(placement.scale * 100)} min={10} max={300} onChange={v => setPlacement(p => ({ ...p, scale: v / 100 }))} format={v => `${v}%`} />
          <Slider label="Horizontal" value={Math.round(placement.offsetX * 100)} min={-50} max={50} onChange={v => setPlacement(p => ({ ...p, offsetX: v / 100 }))} format={v => `${v > 0 ? '+' : ''}${v}%`} />
          <Slider label="Vertical" value={Math.round(placement.offsetY * 100)} min={-50} max={50} onChange={v => setPlacement(p => ({ ...p, offsetY: v / 100 }))} format={v => `${v > 0 ? '+' : ''}${v}%`} />
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" icon={<Crosshair size={14} />} onClick={() => setPlacement(p => ({ ...p, offsetX: 0, offsetY: 0 }))}>Center</Button>
            <Button size="sm" icon={<Maximize2 size={14} />} onClick={() => setPlacement({ mode: 'fit', scale: 1, offsetX: 0, offsetY: 0 })}>Fit to canvas</Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => { setPlacement(DEFAULT_PLACEMENT); setShadow(false); }}>Reset</Button>
          </div>
          <Toggle label="Soft shadow" hint="Optional effect drawn behind the item; the cutout itself is unchanged" checked={shadow} onChange={setShadow} />
          <Toggle label="Show background in preview" checked={showBg} onChange={setShowBg} />
        </section>

        <section className="space-y-3 border-t border-line pt-4">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Export</h3>
          <Segmented<'png' | 'jpeg'> label="Format" value={format} onChange={setFormat} options={[{ value: 'png', label: 'PNG (lossless)' }, { value: 'jpeg', label: 'JPEG' }]} />
          {format === 'jpeg' && <Slider label="JPEG quality" value={quality} min={60} max={100} onChange={setQuality} format={v => `${v}`} />}
          {format === 'jpeg' && background.type === 'transparent' && <p className="text-[12px] text-warn">JPEG has no transparency; a white background will be used.</p>}
          <div className="flex flex-wrap gap-2">
            {prepared?.url ? (
              <a href={prepared.url} download={prepared.name} data-testid="studio-link"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-ink hover:brightness-95">
                <Download size={15} /> Save image
              </a>
            ) : (
              <Button variant="primary" icon={<ImagePlus size={15} />} disabled={!scene || exporting} onClick={doExport} data-testid="studio-export">{exporting ? 'Creating…' : 'Create image'}</Button>
            )}
            {job?.result && (
              <Button icon={<Download size={15} />} onClick={() => downloadBlob(job.result!.blob, outputName(job.name, '-cutout', 'png'))} data-testid="studio-transparent">Transparent PNG</Button>
            )}
          </div>
          {prepared && (
            <p className={`text-[12px] ${prepared.error ? 'text-danger' : 'text-muted'}`} aria-live="polite" data-testid="studio-last-export">
              {prepared.error ? prepared.text : <>Ready: {prepared.text}. Change anything to create a new one.</>}
            </p>
          )}
          <p className="text-[12px] text-muted">The transparent cutout ({job?.result?.width}×{job?.result?.height}) is kept separately and never overwritten.</p>
        </section>
      </aside>
    </div>
  );
}

const clampOff = (v: number) => Math.max(-0.75, Math.min(0.75, v));
