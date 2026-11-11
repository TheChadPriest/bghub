import type { Job, JobStatus } from '../engine/types';
import { ACTIVE_STATUSES } from '../engine/types';

export interface BatchSummary {
  total: number;
  done: number;
  failed: number;
  cancelled: number;
  active: number;
  queued: number;
  selectedDone: number;
}

export function summarize(jobs: Pick<Job, 'status' | 'selected'>[]): BatchSummary {
  const s: BatchSummary = { total: jobs.length, done: 0, failed: 0, cancelled: 0, active: 0, queued: 0, selectedDone: 0 };
  for (const j of jobs) {
    if (j.status === 'done') { s.done++; if (j.selected) s.selectedDone++; }
    else if (j.status === 'failed') s.failed++;
    else if (j.status === 'cancelled') s.cancelled++;
    else if (j.status === 'queued') s.queued++;
    else if ((ACTIVE_STATUSES as JobStatus[]).includes(j.status)) s.active++;
  }
  return s;
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'Waiting to start',
  decoding: 'Decoding',
  'loading-model': 'Loading AI model',
  'waiting-model': 'Waiting for a free model slot',
  analyzing: 'Analyzing',
  refining: 'Refining edges',
  exporting: 'Exporting PNG',
  done: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
