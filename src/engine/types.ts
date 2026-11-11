import type { ImageKind } from '../lib/formats';
import type { Box, RefineOptions, Stroke } from '../lib/mask';
import type { Backend } from './protocol';

export type JobStatus =
  | 'queued'        // accepted and validated; waiting for a free decode slot
  | 'decoding'      // reading pixels from the file
  | 'loading-model' // decoded; the AI model is still downloading/initialising
  | 'waiting-model' // decoded; every model slot is busy with other images
  | 'analyzing'     // the segmentation model is running on this image
  | 'refining'      // resizing the mask to full resolution and applying it
  | 'exporting'     // encoding the lossless PNG
  | 'done'
  | 'failed'
  | 'cancelled';

export const ACTIVE_STATUSES: JobStatus[] = ['decoding', 'loading-model', 'waiting-model', 'analyzing', 'refining', 'exporting'];

export interface JobResult {
  url: string;          // object URL of the full-resolution PNG
  previewUrl: string;   // object URL of a ≤1600px display copy
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  hasTransparency: boolean;
  bbox: Box | null;
  edited: boolean;
}

export interface Job {
  id: string;
  file: File;
  name: string;
  kind: ImageKind;
  /** Dimensions read from the file header (pre-orientation), when available. */
  headerDims?: { width: number; height: number };
  status: JobStatus;
  attempt: number;
  error?: string;
  /** Informational notes from decoding (multi-image HEIF, 16-bit PNG, ...). */
  notes: string[];
  /** Model-quality warnings (no subject found, uncertain areas, ...). */
  warnings: string[];
  width?: number;
  height?: number;
  originalUrl?: string;
  result?: JobResult;
  modelMask?: Uint8Array;
  refine: RefineOptions;
  strokes: Stroke[];
  timings: { decodeMs?: number; inferMs?: number; exportMs?: number; startedAt?: number; finishedAt?: number };
  selected: boolean;
  imageWorker?: number;
  addedAt: number;
}

export type ModelState =
  | { phase: 'idle' }
  | { phase: 'downloading'; loaded: number; total: number; fromCache: boolean }
  | { phase: 'initializing'; backend: Backend }
  | { phase: 'ready'; backend: Backend; initMs: number; slots: number }
  | { phase: 'error'; message: string };

export interface Rejection { id: string; name: string; reason: string }

export interface EngineSettings {
  /** How many images the AI model may analyse at the same time. */
  modelSlots: number;
  backend: 'auto' | 'webgpu' | 'wasm';
}

export interface EngineSnapshot {
  jobs: Job[];
  model: ModelState;
  rejections: Rejection[];
  settings: EngineSettings;
  isolated: boolean;
}
