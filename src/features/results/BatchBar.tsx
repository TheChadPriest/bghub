import { useEffect, useState } from 'react';
import { Archive, CheckSquare, Download, RotateCcw, Square, Trash2, XCircle } from 'lucide-react';
import { useEngine } from '../../engine/context';
import { summarize } from '../../lib/batch';
import { buildZip, planZipNames } from '../../lib/zip';
import { Button, formatBytes } from '../../components/ui';

export function BatchBar() {
  const [{ jobs }, engine] = useEngine();
  const s = summarize(jobs);
  const [zipping, setZipping] = useState<string | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  // Browsers block downloads that start after async work (no longer tied to a
  // click) once a page has downloaded something, so building the ZIP and saving
  // it are two clicks: the save is always a direct user action.
  const [ready, setReady] = useState<{ url: string; name: string; size: number; count: number; selected: boolean; key: string } | null>(null);
  // Revoke later, not immediately: the browser may still be reading the blob after the click.
  useEffect(() => () => { if (ready) setTimeout(() => URL.revokeObjectURL(ready.url), 60_000); }, [ready]);
  const doneKey = (onlySelected: boolean) => jobs.filter(j => j.status === 'done' && (!onlySelected || j.selected)).map(j => j.result?.url).join('|');

  const zip = async (onlySelected: boolean) => {
    const done = jobs.filter(j => j.status === 'done' && j.result && (!onlySelected || j.selected));
    if (!done.length) return;
    setZipError(null);
    setZipping(`Preparing ZIP (0/${done.length})…`);
    try {
      const names = planZipNames(done.map(j => j.name));
      const blob = await buildZip(done.map((j, i) => ({ name: names[i], blob: j.result!.blob })), (d, t) => setZipping(`Preparing ZIP (${d}/${t})…`));
      const name = `bghub-cutouts-${new Date().toISOString().slice(0, 10)}.zip`;
      setReady({ url: URL.createObjectURL(blob), name, size: blob.size, count: done.length, selected: onlySelected, key: doneKey(onlySelected) });
    } catch (e) {
      console.error(e);
      setZipError('The ZIP could not be created, likely due to memory. Download fewer images at a time or download them individually.');
    } finally { setZipping(null); }
  };

  if (!jobs.length) return null;
  // A prepared ZIP is only offered while it still matches the finished images.
  const fresh = !!ready && !zipping && ready.key === doneKey(ready.selected);
  const allSelected = jobs.filter(j => j.status === 'done').every(j => j.selected);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm" data-testid="batch-summary" aria-live="polite">
        <span className="font-medium">{s.done}</span> done
        {s.active + s.queued > 0 && <> · <span className="font-medium">{s.active + s.queued}</span> in progress</>}
        {s.failed > 0 && <> · <span className="font-medium text-danger">{s.failed}</span> failed</>}
        {s.cancelled > 0 && <> · <span className="font-medium">{s.cancelled}</span> cancelled</>}
        {zipping && <span className="ml-2 text-muted">{zipping}</span>}
        {zipError && <span className="ml-2 text-danger" role="alert">{zipError}</span>}

      </p>
      <div className="flex flex-wrap gap-1.5">
        {fresh && ready ? (
          <a href={ready.url} download={ready.name} data-testid="zip-link"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-[13px] font-medium text-accent-ink hover:brightness-95">
            <Download size={14} /> Save ZIP · {ready.count} {ready.count === 1 ? 'image' : 'images'} · {formatBytes(ready.size)}
          </a>
        ) : (
          <Button variant="accent" size="sm" icon={<Archive size={14} />} disabled={!s.done || !!zipping} onClick={() => zip(false)} data-testid="zip-all">Download all ({s.done})</Button>
        )}
        <Button size="sm" icon={<Archive size={14} />} disabled={!s.selectedDone || !!zipping || s.selectedDone === s.done} onClick={() => zip(true)}>ZIP selected ({s.selectedDone})</Button>
        {s.done > 0 && <Button size="sm" variant="ghost" icon={allSelected ? <Square size={14} /> : <CheckSquare size={14} />} onClick={() => engine.selectAll(!allSelected)}>{allSelected ? 'Select none' : 'Select all'}</Button>}
        {s.failed > 0 && <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => engine.retryFailed()}>Retry failed</Button>}
        {s.active + s.queued > 0 && <Button size="sm" variant="ghost" icon={<XCircle size={14} />} onClick={() => engine.cancelAll()}>Cancel all</Button>}
        {(s.done > 0 || s.cancelled > 0) && <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => engine.clearCompleted()}>Clear completed</Button>}
      </div>
    </div>
  );
}
