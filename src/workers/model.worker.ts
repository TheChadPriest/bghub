/// <reference lib="webworker" />
// Owns one ONNX Runtime inference session. Several of these can run in a
// pool; each loads the model once and reuses its session for every image.

import { loadAsset } from '../engine/assets';
import { logitsToMask } from '../lib/mask';
import { MODEL_SIZE } from '../lib/preprocess';
import type { Backend, ModelWorkerRequest, ModelWorkerResponse } from '../engine/protocol';
import type * as OrtNs from 'onnxruntime-web';

declare const self: DedicatedWorkerGlobalScope;

let ort: typeof OrtNs | null = null;
let session: OrtNs.InferenceSession | null = null;
let busy = false;

const post = (msg: ModelWorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

async function init(req: Extract<ModelWorkerRequest, { type: 'init' }>) {
  const t0 = performance.now();
  const { manifest, baseUrl } = req;
  const runtime = req.backend === 'webgpu' ? manifest.ort.webgpu : manifest.ort.wasm;
  // Light JS API from npm; the heavy glue (.mjs) and binary (.wasm) come from our own origin.
  ort = req.backend === 'webgpu' ? await import('ort-webgpu') : await import('ort-wasm');
  const wasmBinary = req.buffers?.runtime ? new Uint8Array(req.buffers.runtime) : await loadAsset(runtime, baseUrl);
  ort.env.wasm.wasmBinary = wasmBinary as Uint8Array<ArrayBuffer>;
  ort.env.wasm.wasmPaths = { mjs: new URL(runtime.mjs, baseUrl).toString() };
  ort.env.wasm.numThreads = self.crossOriginIsolated ? req.numThreads : 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = 'error';
  const modelBytes = req.buffers?.model ? new Uint8Array(req.buffers.model) : await loadAsset(manifest.model, baseUrl);
  session = await ort.InferenceSession.create(modelBytes, {
    executionProviders: [req.backend],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
    // 32-bit WebAssembly has a 4 GB heap; the arena and pre-planned memory
    // patterns raise the peak enough to fail on 1024² inputs.
    enableCpuMemArena: false,
    enableMemPattern: false,
  });
  post({ type: 'ready', backend: req.backend, ms: performance.now() - t0 });
}

async function run(req: Extract<ModelWorkerRequest, { type: 'run' }>) {
  if (!ort || !session) throw new Error('Model is not initialised');
  if (busy) throw new Error('Model worker is busy');
  busy = true;
  const t0 = performance.now();
  const input = new ort.Tensor('float32', req.tensor, [1, 3, MODEL_SIZE, MODEL_SIZE]);
  try {
    const out = await session.run({ [session.inputNames[0]]: input });
    const t = out[session.outputNames[0]];
    const data = (t.data instanceof Float32Array ? t.data : Float32Array.from(t.data as ArrayLike<number>));
    const mask = logitsToMask(data);
    t.dispose();
    post({ type: 'ran', jobId: req.jobId, attempt: req.attempt, mask, ms: performance.now() - t0 }, [mask.buffer]);
  } finally {
    input.dispose();
    busy = false;
  }
}

self.onmessage = async (ev: MessageEvent<ModelWorkerRequest>) => {
  const req = ev.data;
  if (req.type === 'init') {
    try { await init(req); }
    catch (e) {
      console.error('[bghub:model-worker] init failed', e);
      post({ type: 'init-error', backend: req.backend as Backend, message: e instanceof Error ? e.message : String(e) });
    }
  } else if (req.type === 'run') {
    try { await run(req); }
    catch (e) {
      console.error('[bghub:model-worker] run failed', e);
      const msg = e instanceof Error ? e.message : String(e);
      post({ type: 'run-error', jobId: req.jobId, attempt: req.attempt, message: /memory|alloc|OOM/i.test(msg) ? 'The AI model ran out of memory on this image.' : 'The AI model failed on this image.' });
    }
  }
};
