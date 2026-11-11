import { useState } from 'react';

/** Before/after wipe. The checkerboard is a display aid only. */
export function CompareSlider({ before, after, alt, className = '' }: { before: string; after: string; alt: string; className?: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div className={`relative select-none overflow-hidden rounded-xl ${className}`}>
      <div className="checker">
        <img src={after} alt={`${alt} — background removed`} className="block h-auto max-h-[70dvh] w-full object-contain" draggable={false} />
      </div>
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={before} alt={`${alt} — original`} className="block h-full w-full object-contain bg-panel-2" draggable={false} />
      </div>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" style={{ left: `${pos}%` }} />
      <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">Original</span>
      <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">Cutout</span>
      <input type="range" min={0} max={100} value={pos} onChange={e => setPos(Number(e.target.value))} aria-label="Compare original and cutout"
        className="absolute inset-x-0 bottom-2 mx-auto w-[min(320px,80%)]" />
    </div>
  );
}
