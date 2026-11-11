import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:opacity-90',
  accent: 'bg-accent text-accent-ink hover:brightness-95',
  secondary: 'bg-panel text-ink border border-line hover:bg-panel-2',
  ghost: 'text-ink hover:bg-panel-2',
  danger: 'text-danger hover:bg-panel-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode }>(
  function Button({ variant = 'secondary', size = 'md', icon, className = '', children, type = 'button', ...rest }, ref) {
    const sz = size === 'sm' ? 'h-8 px-2.5 text-[13px] gap-1.5' : size === 'lg' ? 'h-12 px-5 text-[15px] gap-2' : 'h-10 px-3.5 text-sm gap-2';
    return (
      <button ref={ref} type={type} className={`inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap transition disabled:opacity-40 disabled:pointer-events-none ${sz} ${VARIANTS[variant]} ${className}`} {...rest}>
        {icon}{children}
      </button>
    );
  });

export function IconButton({ label, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink hover:bg-panel-2 disabled:opacity-40 ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Slider({ label, value, min, max, step = 1, onChange, format, disabled }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[13px]">
        <label htmlFor={id} className="text-muted">{label}</label>
        <span className="tabular-nums">{format ? format(value) : value}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={e => onChange(Number(e.target.value))} className="w-full" />
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className="mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-line p-0.5 transition peer-checked:bg-ink peer-focus-visible:outline-2 peer-focus-visible:outline-ink [&>span]:transition peer-checked:[&>span]:translate-x-4">
        <span className="h-4 w-4 rounded-full bg-panel shadow" />
      </span>
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-[12px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-line bg-panel-2 p-0.5">
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`h-8 rounded-md px-3 text-[13px] font-medium transition ${value === o.value ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value }: { value: number | null }) {
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(value * 100)}>
      {value === null
        ? <div className="bar-indeterminate absolute inset-y-0 w-2/5 rounded-full bg-ink" />
        : <div className="h-full rounded-full bg-ink transition-[width]" style={{ width: `${Math.max(2, value * 100)}%` }} />}
    </div>
  );
}

export function Dialog({ open, onClose, title, children, wide, full }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; full?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const size = full ? 'h-[100dvh] max-h-[100dvh] w-screen max-w-none rounded-none' : wide ? 'w-[min(1100px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] rounded-2xl' : 'w-[min(520px,calc(100vw-24px))] rounded-2xl';
  return (
    <dialog ref={ref} onClose={onClose} onCancel={e => { e.preventDefault(); onClose(); }}
      className={`m-auto border border-line bg-panel p-0 text-ink backdrop:bg-black/60 ${size}`}>
      {open && (
        <div className={`flex flex-col ${full ? 'h-full' : 'max-h-[calc(100dvh-24px)]'}`}>
          <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
            <h2 className="truncate font-display text-lg font-semibold">{title}</h2>
            <IconButton label="Close" onClick={onClose}><X size={18} /></IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
}
