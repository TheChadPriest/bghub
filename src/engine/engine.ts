// Job store + scheduler. Files are accepted immediately; work is spread over
// two worker pools:
//   image workers  – decode, model-input preparation, mask application, PNG export
//   model workers  – one ONNX Runtime session each (the scarce resource)
// Decoding and exporting of different images overlap with inference, and as many
// images are analysed at once as there are model slots. Nothing waits for a
// "batch" to finish.

import { fetchManifest, loadAsset, isCached, cacheAvailable, AssetError, clearAllAssets } from './assets';
import type { AssetManifest, Backend, CutoutResult, ImageWorkerRequest, ImageWorkerResponse, ModelWorkerRequest, ModelWorkerResponse } from './protocol';
import { ACTIVE_STATUSES, type EngineSettings, type EngineSnapshot, type Job, type JobResult, type ModelState, type Rejection } from './types';
import { HEADER_BYTES } from '../lib/formats';
import { defaultLimits, type Limits } from '../lib/limits';
import { fileFingerprint, validateHeader } from '../lib/validate';
import { DEFAULT_REFINE, maskWarnings, type RefineOptions, type Stroke } from '../lib/mask';
import type { ImageKind } from '../lib/formats';

type Listener = () => void;

interface ModelSlot { worker: Worker; ready: boolean; jobId: string | null; attempt: number }

const uid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 18);

function hardwareThreads(): number {
  return Math.max(1, Math.min(16, navigator.hardwareConcurrency || 4));
}

export async function detectWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    // The model is fp16; without shader-f16 ONNX Runtime cannot run it on the GPU.
    return !!adapter && adapter.features.has('shader-f16');
  } catch { return false; }
}

export class Engine {
  private jobs: Job[] = [];
  private rejections: Rejection[] = [];
  private model: ModelState = { phase: 'idle' };
  private settings: EngineSettings;
  private listeners = new Set<Listener>();
  private snapshot!: EngineSnapshot;
  private imageWorkers: Worker[] = [];
  private imageLoad: number[] = [];
  private modelSlots: ModelSlot[] = [];
  private tensors = new Map<string, Float32Array>();
  private seen = new Map<string, string>(); // fingerprint -> job id
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private manifest: AssetManifest | null = null;
  private backend: Backend | null = null;
  private modelLoading: Promise<void> | null = null;
  private baseUrl: string;
  private imageCrashes: number[] = [];
  private workersBroken = false;
  readonly limits: Limits;

  constructor(opts: { baseUrl?: string; settings?: Partial<EngineSettings> } = {}) {
    this.baseUrl = opts.baseUrl ?? new URL(import.meta.env.BASE_URL, location.href).toString();
    this.limits = defaultLimits();
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    this.settings = { modelSlots: mem >= 8 ? 2 : 1, backend: 'auto', ...opts.settings };
    const n = Math.max(1, Math.min(3, Math.floor(hardwareThreads() / 3)));
    for (let i = 0; i < n; i++) this.spawnImageWorker(i);
    this.emit();
  }

  // ---------- store plumbing ----------
  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getSnapshot = () => this.snapshot;
  private emit() {
    this.snapshot = { jobs: this.jobs.slice(), model: this.model, rejections: this.rejections.slice(), settings: { ...this.settings }, isolated: !!globalThis.crossOriginIsolated };
    this.listeners.forEach(l => l());
  }
  private patch(id: string, p: Partial<Job>) {
    const i = this.jobs.findIndex(j => j.id === id);
    if (i < 0) return;
    this.jobs[i] = { ...this.jobs[i], ...p };
    this.emit();
  }
  getJob(id: string) { return this.jobs.find(j => j.id === id); }

  // ---------- workers ----------
  private spawnImageWorker(i: number) {
    const w = new Worker(new URL('../workers/image.worker.ts', import.meta.url), { type: 'module', name: `bghub-image-${i}` });
    w.onmessage = (e: MessageEvent<ImageWorkerResponse>) => this.onImageMessage(i, e.data);
    w.onerror = (e) => {
      console.error('[bghub] image worker crashed', e.message);
      for (const j of this.jobs) {
        if (j.imageWorker === i && ACTIVE_STATUSES.includes(j.status) && j.status !== 'analyzing') {
          this.failJob(j.id, 'Processing crashed, probably because the browser ran out of memory. Retry this image on its own.');
        }
      }
      w.terminate();
      // Respawn, but give up if the worker cannot even start (e.g. blocked script).
      const now = Date.now();
      this.imageCrashes = this.imageCrashes.filter(t => now - t < 30_000);
      this.imageCrashes.push(now);
      if (this.imageCrashes.length > 6) {
        this.workersBroken = true;
        for (const j of this.jobs) if (j.status === 'queued') this.failJob(j.id, 'This browser could not start BGhub’s image workers. Reload the page or try another browser.');
        this.emit();
        return;
      }
      setTimeout(() => this.spawnImageWorker(i), 200 * this.imageCrashes.length);
      this.imageLoad[i] = 0;
    };
    this.imageWorkers[i] = w;
    this.imageLoad[i] = 0;
  }

  private postImage(i: number, msg: ImageWorkerRequest, transfer: Transferable[] = []) {
    this.imageWorkers[i].postMessage(msg, transfer);
  }

  private leastLoadedImageWorker(): number {
    let best = 0;
    for (let i = 1; i < this.imageWorkers.length; i++) if (this.imageLoad[i] < this.imageLoad[best]) best = i;
    return best;
  }

  // ---------- adding files ----------
  async addFiles(files: File[] | FileList) {
    const list = Array.from(files);
    for (const file of list) {
      if (this.workersBroken) { this.reject(file.name, 'Image processing is unavailable in this browser session. Reload the page.'); continue; }
      const fp = fileFingerprint(file);
      const existing = this.seen.get(fp);
      if (existing && this.jobs.some(j => j.id === existing)) {
        this.reject(file.name, 'Already in your workspace — skipped the duplicate.');
        continue;
      }
      let head: Uint8Array;
      try { head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()); }
      catch { this.reject(file.name, 'The file could not be read.'); continue; }
      const v = validateHeader(head, file.size, this.limits);
      if (!v.ok) { this.reject(file.name, v.reason); continue; }
      const job: Job = {
        id: uid(), file, name: file.name, kind: v.kind, headerDims: v.dims ?? undefined,
        status: 'queued', attempt: 1, notes: [], warnings: [], refine: { ...DEFAULT_REFINE }, strokes: [],
        timings: {}, selected: true, addedAt: Date.now(),
      };
      this.seen.set(fp, job.id);
      this.jobs.push(job);
      this.emit();
      this.pump();
    }
    if (list.length) void this.ensureModel();
  }

  private reject(name: string, reason: string) {
    this.rejections = [...this.rejections, { id: uid(), name, reason }].slice(-20);
    this.emit();
  }
  dismissRejection(id: string) { this.rejections = this.rejections.filter(r => r.id !== id); this.emit(); }
  clearRejections() { this.rejections = []; this.emit(); }

  // ---------- scheduling ----------
  private get maxInFlight() { return this.settings.modelSlots + this.imageWorkers.length; }

  private pump() {
    let inFlight = this.jobs.filter(j => ACTIVE_STATUSES.includes(j.status)).length;
    for (const job of this.jobs) {
      if (inFlight >= this.maxInFlight) break;
      if (job.status !== 'queued') continue;
      const w = this.leastLoadedImageWorker();
      this.imageLoad[w]++;
      inFlight++;
      this.patch(job.id, { status: 'decoding', imageWorker: w, timings: { startedAt: performance.now() } });
      this.postImage(w, { type: 'decode', jobId: job.id, attempt: job.attempt, file: job.file, kind: job.kind, maxPixels: this.limits.maxPixels, maxSide: this.limits.maxSide });
    }
    const ready = this.model.phase === 'ready';
    const waiting = this.jobs.filter(j => (j.status === 'waiting-model' || j.status === 'loading-model') && this.tensors.has(j.id));
    for (const job of waiting) {
      if (!ready) { if (job.status !== 'loading-model') this.patch(job.id, { status: 'loading-model' }); continue; }
      const slot = this.modelSlots.find(s => s.ready && !s.jobId);
      if (!slot) { if (job.status !== 'waiting-model') this.patch(job.id, { status: 'waiting-model' }); continue; }
      const tensor = this.tensors.get(job.id)!;
      this.tensors.delete(job.id);
      slot.jobId = job.id; slot.attempt = job.attempt;
      this.patch(job.id, { status: 'analyzing' });
      slot.worker.postMessage({ type: 'run', jobId: job.id, attempt: job.attempt, tensor } satisfies ModelWorkerRequest, [tensor.buffer]);
    }
  }

  private current(jobId: string, attempt?: number): Job | undefined {
    const j = this.getJob(jobId);
    return j && j.attempt === attempt ? j : undefined;
  }

  private onImageMessage(w: number, m: ImageWorkerResponse) {
    if ('reqId' in m && m.reqId && this.pending.has(m.reqId)) {
      const p = this.pending.get(m.reqId)!;
      this.pending.delete(m.reqId);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
      return;
    }
    switch (m.type) {
      case 'decoded': {
        const job = this.current(m.jobId, m.attempt);
        if (!job || job.status !== 'decoding') { this.postImage(w, { type: 'release', jobId: m.jobId }); this.imageLoad[w]--; this.pump(); return; }
        this.imageLoad[w]--;
        this.tensors.set(job.id, m.tensor);
        if (job.originalUrl) URL.revokeObjectURL(job.originalUrl);
        this.patch(job.id, {
          status: this.model.phase === 'ready' ? 'waiting-model' : 'loading-model',
          width: m.width, height: m.height, notes: m.notes, originalUrl: URL.createObjectURL(m.preview),
          timings: { ...job.timings, decodeMs: m.ms },
        });
        this.pump();
        break;
      }
      case 'stage': {
        const job = this.current(m.jobId, m.attempt);
        if (job && (job.status === 'refining' || job.status === 'exporting')) this.patch(job.id, { status: m.stage });
        break;
      }
      case 'finished': {
        this.imageLoad[w]--;
        const job = this.current(m.jobId, m.attempt);
        if (!job || (job.status !== 'refining' && job.status !== 'exporting')) { this.pump(); return; }
        this.patch(job.id, {
          status: 'done', result: this.makeResult(m, false), warnings: maskWarnings(m.stats),
          timings: { ...job.timings, exportMs: m.ms, finishedAt: performance.now() },
        });
        this.pump();
        break;
      }
      case 'error': {
        if (!m.jobId) return;
        const job = this.current(m.jobId, m.attempt);
        this.imageLoad[w] = Math.max(0, this.imageLoad[w] - 1);
        if (job && ACTIVE_STATUSES.includes(job.status)) this.failJob(job.id, m.message);
        this.pump();
        break;
      }
    }
  }

  private makeResult(r: CutoutResult, edited: boolean): JobResult {
    return {
      url: URL.createObjectURL(r.png), previewUrl: URL.createObjectURL(r.preview), blob: r.png,
      width: r.width, height: r.height, bytes: r.png.size, hasTransparency: r.hasTransparency, bbox: r.bbox, edited,
    };
  }

  private failJob(id: string, error: string) {
    this.tensors.delete(id);
    this.patch(id, { status: 'failed', error });
  }

  private onModelMessage(slot: ModelSlot, m: ModelWorkerResponse) {
    switch (m.type) {
      case 'ran': {
        slot.jobId = null;
        const job = this.current(m.jobId, m.attempt);
        if (job && job.status === 'analyzing' && job.imageWorker !== undefined) {
          this.imageLoad[job.imageWorker]++;
          const mask = m.mask;
          this.patch(job.id, { status: 'refining', modelMask: mask.slice(), timings: { ...job.timings, inferMs: m.ms } });
          this.postImage(job.imageWorker, { type: 'finish', jobId: job.id, attempt: job.attempt, mask, refine: job.refine }, [mask.buffer]);
        }
        this.pump();
        break;
      }
      case 'run-error': {
        slot.jobId = null;
        const job = this.current(m.jobId, m.attempt);
        if (job) {
          if (job.imageWorker !== undefined) this.postImage(job.imageWorker, { type: 'release', jobId: job.id });
          if (job.status === 'analyzing') this.failJob(job.id, m.message);
        }
        this.pump();
        break;
      }
      default: break;
    }
  }

  // ---------- model lifecycle ----------
  ensureModel(): Promise<void> {
    if (this.model.phase === 'ready') return Promise.resolve();
    if (this.modelLoading) return this.modelLoading;
    this.modelLoading = this.loadModel().catch(e => {
      const message = e instanceof AssetError ? e.message : 'The AI model could not start in this browser. Try an up-to-date Chrome, Edge, Firefox or Safari.';
      console.error('[bghub] model load failed', e);
      this.model = { phase: 'error', message };
      for (const j of this.jobs) if (j.status === 'loading-model') this.failJob(j.id, 'The AI model could not be loaded. Use “Retry” once the model loads.');
      this.emit();
    }).finally(() => { this.modelLoading = null; });
    return this.modelLoading;
  }

  private async pickBackend(): Promise<Backend> {
    if (this.settings.backend !== 'auto') return this.settings.backend === 'webgpu' && !(await detectWebGPU()) ? 'wasm' : this.settings.backend;
    return (await detectWebGPU()) ? 'webgpu' : 'wasm';
  }

  private async loadModel() {
    this.manifest ??= await fetchManifest(this.baseUrl);
    const manifest = this.manifest;
    let backend = await this.pickBackend();
    for (;;) {
      const runtime = backend === 'webgpu' ? manifest.ort.webgpu : manifest.ort.wasm;
      const total = manifest.model.size + runtime.size;
      const fromCache = (await isCached(manifest.model, this.baseUrl)) && (await isCached(runtime, this.baseUrl));
      this.model = { phase: 'downloading', loaded: 0, total, fromCache };
      this.emit();
      let rLoaded = 0, mLoaded = 0, lastEmit = 0;
      const tick = () => {
        const now = performance.now();
        if (now - lastEmit < 100) return;
        lastEmit = now;
        this.model = { phase: 'downloading', loaded: rLoaded + mLoaded, total, fromCache };
        this.emit();
      };
      // Download once on the main thread (into Cache Storage); workers then read from the cache.
      const keep = !cacheAvailable();
      const runtimeBytes = await loadAsset(runtime, this.baseUrl, l => { rLoaded = l; tick(); });
      const modelBytes = await loadAsset(manifest.model, this.baseUrl, l => { mLoaded = l; tick(); });
      this.model = { phase: 'initializing', backend };
      this.emit();
      try {
        const initMs = await this.startModelWorkers(backend, keep ? { runtime: runtimeBytes, model: modelBytes } : undefined);
        this.backend = backend;
        this.model = { phase: 'ready', backend, initMs, slots: this.modelSlots.filter(s => s.ready).length };
        this.emit();
        this.pump();
        return;
      } catch (e) {
        if (backend === 'webgpu') {
          console.warn('[bghub] WebGPU init failed, falling back to WebAssembly', e);
          backend = 'wasm';
          continue;
        }
        throw e;
      }
    }
  }

  private startModelWorkers(backend: Backend, buffers?: { runtime: Uint8Array; model: Uint8Array }): Promise<number> {
    for (const s of this.modelSlots) s.worker.terminate();
    this.modelSlots = [];
    const count = Math.max(1, Math.min(3, this.settings.modelSlots));
    // DeformConv has no GPU kernel, so the WebGPU path still runs a few ops on CPU threads.
    const threads = Math.max(1, Math.min(backend === 'webgpu' ? 4 : 8, Math.floor(hardwareThreads() / count)));
    const manifest = this.manifest!;
    return new Promise<number>((resolve, reject) => {
      let settled = false, failures = 0;
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL('../workers/model.worker.ts', import.meta.url), { type: 'module', name: `bghub-model-${i}` });
        const slot: ModelSlot = { worker, ready: false, jobId: null, attempt: 0 };
        this.modelSlots.push(slot);
        worker.onmessage = (e: MessageEvent<ModelWorkerResponse>) => {
          const m = e.data;
          if (m.type === 'ready') {
            slot.ready = true;
            if (!settled) { settled = true; resolve(m.ms); }
            else if (this.model.phase === 'ready') { this.model = { ...this.model, slots: this.modelSlots.filter(s => s.ready).length }; this.emit(); }
            this.pump();
          } else if (m.type === 'init-error') {
            failures++;
            worker.terminate();
            this.modelSlots = this.modelSlots.filter(s => s !== slot);
            if (!settled && failures === count) { settled = true; reject(new Error(m.message)); }
            else if (this.model.phase === 'ready') { this.model = { ...this.model, slots: this.modelSlots.filter(s => s.ready).length }; this.emit(); }
          } else this.onModelMessage(slot, m);
        };
        worker.onerror = (e) => {
          console.error('[bghub] model worker crashed', e.message);
          const jobId = slot.jobId;
          worker.terminate();
          this.modelSlots = this.modelSlots.filter(s => s !== slot);
          if (jobId) this.failJob(jobId, 'The AI model crashed on this image, most likely out of memory. Retry it, or lower “Images analysed at once” in Settings.');
          if (!settled) { failures++; if (failures === count) { settled = true; reject(new Error(e.message || 'Model worker crashed')); } }
          else if (this.modelSlots.length === 0) { this.model = { phase: 'idle' }; this.emit(); void this.ensureModel(); }
          else if (this.model.phase === 'ready') { this.model = { ...this.model, slots: this.modelSlots.filter(s => s.ready).length }; this.emit(); }
          this.pump();
        };
        // When the Cache API is unavailable each worker gets its own copy of the bytes.
        const b = buffers ? { runtime: buffers.runtime.slice().buffer, model: buffers.model.slice().buffer } : undefined;
        worker.postMessage({ type: 'init', backend, numThreads: threads, manifest, baseUrl: this.baseUrl, buffers: b } satisfies ModelWorkerRequest, b ? [b.runtime, b.model] : []);
      }
    });
  }

  async reloadModel() {
    for (const s of this.modelSlots) s.worker.terminate();
    for (const s of this.modelSlots) if (s.jobId) this.failJob(s.jobId, 'Cancelled because the model was reloaded.');
    this.modelSlots = [];
    this.model = { phase: 'idle' };
    this.emit();
    await this.ensureModel();
  }

  async deleteDownloadedModel() {
    await clearAllAssets();
    for (const s of this.modelSlots) s.worker.terminate();
    this.modelSlots = [];
    this.model = { phase: 'idle' };
    this.emit();
  }

  updateSettings(p: Partial<EngineSettings>) {
    const prev = this.settings;
    this.settings = { ...this.settings, ...p };
    this.emit();
    const needsRestart = (p.modelSlots !== undefined && p.modelSlots !== prev.modelSlots) || (p.backend !== undefined && p.backend !== prev.backend);
    if (needsRestart && (this.model.phase === 'ready' || this.model.phase === 'error')) {
      // Only restart once the running inferences are done, so no work is lost.
      const busy = this.modelSlots.some(s => s.jobId);
      if (!busy) void this.reloadModel();
      else {
        const t = setInterval(() => { if (!this.modelSlots.some(s => s.jobId)) { clearInterval(t); void this.reloadModel(); } }, 250);
      }
    }
  }

  get activeBackend() { return this.backend; }

  // ---------- user actions ----------
  cancel(id: string) {
    const job = this.getJob(id);
    if (!job || !(job.status === 'queued' || ACTIVE_STATUSES.includes(job.status))) return;
    this.tensors.delete(id);
    if (job.imageWorker !== undefined) {
      this.postImage(job.imageWorker, { type: 'release', jobId: id });
      // A job in decode/refine/export still occupies its image worker until the
      // worker replies; that reply is ignored because the attempt number changes.
    }
    this.patch(id, { status: 'cancelled', attempt: job.attempt + 1 });
    this.pump();
  }

  cancelAll() { for (const j of this.jobs) this.cancel(j.id); }

  retry(id: string) {
    const job = this.getJob(id);
    if (!job || !(job.status === 'failed' || job.status === 'cancelled' || job.status === 'done')) return;
    this.revokeResult(job);
    this.patch(id, { status: 'queued', attempt: job.attempt + 1, error: undefined, warnings: [], result: undefined, modelMask: undefined, strokes: [], refine: { ...DEFAULT_REFINE }, timings: {} });
    if (this.model.phase === 'error') { this.model = { phase: 'idle' }; this.emit(); }
    void this.ensureModel();
    this.pump();
  }

  retryFailed() { for (const j of this.jobs) if (j.status === 'failed') this.retry(j.id); }

  remove(id: string) {
    this.cancel(id);
    const job = this.getJob(id);
    if (!job) return;
    this.revokeResult(job);
    if (job.originalUrl) URL.revokeObjectURL(job.originalUrl);
    this.jobs = this.jobs.filter(j => j.id !== id);
    for (const [fp, jid] of this.seen) if (jid === id) this.seen.delete(fp);
    this.emit();
  }

  clearCompleted() { for (const j of this.jobs.filter(j => j.status === 'done' || j.status === 'cancelled')) this.remove(j.id); }
  clearAll() { for (const j of this.jobs.slice()) this.remove(j.id); }

  setSelected(id: string, selected: boolean) { this.patch(id, { selected }); }
  selectAll(selected: boolean) { this.jobs = this.jobs.map(j => ({ ...j, selected })); this.emit(); }

  private revokeResult(job: Job) {
    if (job.result) { URL.revokeObjectURL(job.result.url); URL.revokeObjectURL(job.result.previewUrl); }
  }

  // ---------- editor support ----------
  private request<T>(msg: ImageWorkerRequest & { reqId: string }, transfer: Transferable[] = []): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(msg.reqId, { resolve: resolve as (v: unknown) => void, reject });
      this.postImage(this.leastLoadedImageWorker(), msg, transfer);
    });
  }

  async loadSource(id: string): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
    const job = this.getJob(id);
    if (!job) throw new Error('Image not found');
    return this.request({ type: 'load-source', reqId: uid(), file: job.file, kind: job.kind as ImageKind, maxPixels: this.limits.maxPixels, maxSide: this.limits.maxSide });
  }

  /** Decodes any supported file (e.g. a custom background, including HEIC) without creating a job. */
  async decodeStandalone(file: File): Promise<ImageBitmap> {
    const head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
    const v = validateHeader(head, file.size, this.limits);
    if (!v.ok) throw new Error(v.reason);
    const s = await this.request<{ rgba: Uint8ClampedArray; width: number; height: number }>({ type: 'load-source', reqId: uid(), file, kind: v.kind, maxPixels: this.limits.maxPixels, maxSide: this.limits.maxSide });
    return createImageBitmap(new ImageData(s.rgba as Uint8ClampedArray<ArrayBuffer>, s.width, s.height));
  }

  /** Re-exports a cutout after manual mask edits. The original source pixels are never modified. */
  async applyEdit(id: string, rgba: Uint8ClampedArray, mask: Uint8Array, width: number, height: number, refine: RefineOptions, strokes: Stroke[]) {
    const job = this.getJob(id);
    if (!job) throw new Error('Image not found');
    const r = await this.request<CutoutResult>({ type: 'encode-cutout', reqId: uid(), rgba: rgba.slice(), mask: mask.slice(), width, height });
    const current = this.getJob(id);
    if (!current) return;
    this.revokeResult(current);
    this.patch(id, { result: this.makeResult(r, strokes.length > 0 || refine.hardness !== DEFAULT_REFINE.hardness || refine.cleanup !== DEFAULT_REFINE.cleanup), refine, strokes });
  }

  dispose() {
    for (const w of this.imageWorkers) w.terminate();
    for (const s of this.modelSlots) s.worker.terminate();
    this.clearAll();
  }
}
