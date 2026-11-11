import { useEffect, useRef, useState } from 'react';
import { ImagePlus, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui';

export const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,image/bmp,image/tiff,image/gif,.heic,.heif,.jpg,.jpeg,.png,.webp,.avif,.bmp,.tif,.tiff,.gif';

export function DropZone({ onFiles, compact }: { onFiles: (files: File[]) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  // Paste images from the clipboard anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) { e.preventDefault(); onFiles(files); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFiles]);

  return (
    <div
      onDragEnter={e => { e.preventDefault(); depth.current++; setOver(true); }}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
      onDrop={e => {
        e.preventDefault(); depth.current = 0; setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
      className={`relative rounded-2xl border-2 border-dashed transition ${over ? 'border-ink bg-accent/25' : 'border-line bg-panel'} ${compact ? 'px-4 py-4' : 'px-6 py-10 sm:py-14'}`}
      data-testid="dropzone"
    >
      <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" data-testid="file-input" tabIndex={-1} aria-hidden="true"
        onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) onFiles(f); }} />
      {compact ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted"><span className="font-medium text-ink">Drop more images</span> any time — they’re added instantly, no need to wait for the current batch.</p>
          <Button variant="primary" size="sm" icon={<ImagePlus size={16} />} onClick={() => input.current?.click()}>Add images</Button>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent text-accent-ink"><ImagePlus size={26} /></div>
          <p className="font-display text-xl font-semibold sm:text-2xl">Drop product photos here</p>
          <p className="mt-1 text-sm text-muted">or paste from your clipboard</p>
          <Button variant="primary" size="lg" className="mt-5" onClick={() => input.current?.click()}>Choose images</Button>
          <p className="mt-4 text-[13px] text-muted">JPEG · PNG · WebP · HEIC/HEIF · AVIF · TIFF · BMP · GIF — select as many as you like</p>
          <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-ok"><ShieldCheck size={15} /> Processed on your device. Photos are never uploaded.</p>
        </div>
      )}
    </div>
  );
}
