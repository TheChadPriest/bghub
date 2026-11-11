// Message shapes exchanged between the main thread and the workers.

import type { ImageKind } from '../lib/formats';
import type { Box, MaskStats, RefineOptions } from '../lib/mask';

export type Backend = 'webgpu' | 'wasm';

// ---- image worker (decode, prepare, mask application, PNG export) ----

export type ImageWorkerRequest =
  | { type: 'decode'; jobId: string; attempt: number; file: Blob; kind: ImageKind; maxPixels: number; maxSide: number }
  | { type: 'finish'; jobId: string; attempt: number; mask: Uint8Array; refine: RefineOptions }
  | { type: 'release'; jobId: string }
  | { type: 'load-source'; reqId: string; file: Blob; kind: ImageKind; maxPixels: number; maxSide: number }
  | { type: 'encode-cutout'; reqId: string; rgba: Uint8ClampedArray; mask: Uint8Array; width: number; height: number };

export interface CutoutResult {
  png: Blob;
  preview: Blob;
  width: number;
  height: number;
  bbox: Box | null;
  hasTransparency: boolean;
}

export type ImageWorkerResponse =
  | { type: 'decoded'; jobId: string; attempt: number; width: number; height: number; tensor: Float32Array; preview: Blob; notes: string[]; ms: number }
  | { type: 'stage'; jobId: string; attempt: number; stage: 'refining' | 'exporting' }
  | ({ type: 'finished'; jobId: string; attempt: number; stats: MaskStats; ms: number } & CutoutResult)
  | { type: 'source'; reqId: string; rgba: Uint8ClampedArray; width: number; height: number }
  | ({ type: 'encoded'; reqId: string } & CutoutResult)
  | { type: 'error'; jobId?: string; reqId?: string; attempt?: number; message: string; code: ErrorCode };

export type ErrorCode = 'decode' | 'heic' | 'limits' | 'memory' | 'export' | 'unknown';

// ---- model worker (ONNX Runtime session) ----

export interface BinaryAsset {
  sha256: string;
  size: number;
  parts: string[];
  /** Optional absolute fallback URL serving the whole file (used only if parts are missing). */
  fallback?: string;
}

export interface AssetManifest {
  model: BinaryAsset & { id: string; revision: string; license: string; inputSize: number };
  ort: { version: string; webgpu: BinaryAsset & { mjs: string }; wasm: BinaryAsset & { mjs: string } };
}

export type ModelWorkerRequest =
  | { type: 'init'; backend: Backend; numThreads: number; manifest: AssetManifest; baseUrl: string; buffers?: { model?: ArrayBuffer; runtime?: ArrayBuffer } }
  | { type: 'run'; jobId: string; attempt: number; tensor: Float32Array };

export type ModelWorkerResponse =
  | { type: 'ready'; backend: Backend; ms: number }
  | { type: 'init-error'; message: string; backend: Backend }
  | { type: 'ran'; jobId: string; attempt: number; mask: Uint8Array; ms: number }
  | { type: 'run-error'; jobId: string; attempt: number; message: string };
