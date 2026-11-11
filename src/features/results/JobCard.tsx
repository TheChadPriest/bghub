import { memo } from 'react';
import { AlertTriangle, Brush, Download, Eye, Layers, RotateCcw, Trash2, X, CheckCircle2, Info } from 'lucide-react';
import type { Job } from '../../engine/types';
import { ACTIVE_STATUSES } from '../../engine/types';
import { STATUS_LABEL } from '../../lib/batch';
import { KIND_LABEL } from '../../lib/formats';
import { outputName } from '../../lib/filenames';
import { downloadBlob } from '../../lib/zip';
import { Button, IconButton, Progress, formatBytes } from '../../components/ui';

export interface JobActions {
  onPreview: (id: string) => void;
  onEdit: (id: string) => void;
  onStudio: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string, v: boolean) => void;
}

export const JobCard = memo(function JobCard({ job, actions }: { job: Job; actions: JobActions }) {
  const active = ACTIVE_STATUSES.includes(job.status) || job.status === 'queued';
  const r = job.result;
  const dims = job.width ? `${job.width}×${job.height}` : job.headerDims ? `${job.headerDims.width}×${job.headerDims.height}` : '—';
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-line bg-panel" data-testid="job-card" data-status={job.status} aria-label={job.name}>
      <div className="relative aspect-[4/3] w-full">
        {r ? (
          <button type="button" onClick={() => actions.onPreview(job.id)} className="checker absolute inset-0 overflow-hidden" aria-label={`Preview ${job.name}`}>
            <img src={r.previewUrl} alt="" className="h-full w-full object-contain p-2" />
          </button>
        ) : job.originalUrl ? (
          <img src={job.originalUrl} alt="" className={`absolute inset-0 h-full w-full object-contain bg-panel-2 ${active ? 'opacity-60' : ''}`} />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-panel-2 text-[13px] text-muted">{KIND_LABEL[job.kind]}</div>
        )}
        {job.status === 'done' && (
          <label className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-md bg-panel/90 px-1.5 py-1 text-[12px] shadow-sm">
            <input type="checkbox" checked={job.selected} onChange={e => actions.onSelect(job.id, e.target.checked)} aria-label={`Select ${job.name} for ZIP`} />
            ZIP
          </label>
        )}
        <div className="absolute right-2 top-2 flex gap-1">
          {active
            ? <IconButton label={`Cancel ${job.name}`} className="bg-panel/90" onClick={() => actions.onCancel(job.id)}><X size={16} /></IconButton>
            : <IconButton label={`Remove ${job.name}`} className="bg-panel/90" onClick={() => actions.onRemove(job.id)}><Trash2 size={15} /></IconButton>}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={job.name}>{job.name}</p>
          <p className="text-[12px] text-muted">{KIND_LABEL[job.kind]} · {dims}</p>
        </div>

        {active && (
          <div className="space-y-1.5" aria-live="polite">
            <p className="text-[13px]" data-testid="job-status">{STATUS_LABEL[job.status]}</p>
            <Progress value={null} />
          </div>
        )}

        {job.status === 'failed' && (
          <p className="flex gap-1.5 text-[13px] text-danger" role="alert"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> {job.error}</p>
        )}
        {job.status === 'cancelled' && <p className="text-[13px] text-muted">Cancelled</p>}

        {r && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px]" data-testid="job-info">
            <dt className="text-muted">Output</dt><dd className="text-right tabular-nums">{r.width}×{r.height} PNG</dd>
            <dt className="text-muted">Size</dt><dd className="text-right tabular-nums">{formatBytes(r.bytes)}</dd>
            <dt className="text-muted">Transparency</dt><dd className="text-right">{r.hasTransparency ? 'Yes' : 'None found'}</dd>
            <dt className="text-muted">Resized</dt>
            <dd className="text-right">{r.width === job.width && r.height === job.height ? <span className="inline-flex items-center gap-1 text-ok"><CheckCircle2 size={12} /> No</span> : <span className="text-danger">Yes</span>}</dd>
          </dl>
        )}

        {job.warnings.map(w => <p key={w} className="flex gap-1.5 text-[12px] text-warn"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{w}</p>)}
        {job.notes.map(n => <p key={n} className="flex gap-1.5 text-[12px] text-muted"><Info size={13} className="mt-0.5 shrink-0" />{n}</p>)}

        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {r && (
            <>
              <Button variant="primary" size="sm" icon={<Download size={14} />} onClick={() => downloadBlob(r.blob, outputName(job.name, '-cutout', 'png'))}>PNG</Button>
              <Button size="sm" icon={<Eye size={14} />} onClick={() => actions.onPreview(job.id)}>Compare</Button>
              <Button size="sm" icon={<Brush size={14} />} onClick={() => actions.onEdit(job.id)}>Refine</Button>
              <Button size="sm" icon={<Layers size={14} />} onClick={() => actions.onStudio(job.id)}>Background</Button>
            </>
          )}
          {(job.status === 'failed' || job.status === 'cancelled') && (
            <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => actions.onRetry(job.id)}>Retry</Button>
          )}
        </div>
      </div>
    </article>
  );
});
