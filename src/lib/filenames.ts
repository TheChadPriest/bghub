// Filename helpers. Names are only ever rendered as React text, never as HTML.

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export function baseName(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? name;
  const dot = leaf.lastIndexOf('.');
  return dot > 0 ? leaf.slice(0, dot) : leaf;
}

/** Keeps letters (any script), digits, dash, underscore, dot and spaces; replaces everything else. */
export function sanitizeBase(name: string, fallback = 'image'): string {
  let s = baseName(name)
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\-_. ]+/gu, '-')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/^[\s.-]+|[\s.-]+$/g, '');
  if (!s) s = fallback;
  if (RESERVED.test(s)) s = `${s}-file`;
  return s.slice(0, 100);
}

export function outputName(original: string, suffix: string, ext: string): string {
  return `${sanitizeBase(original)}${suffix}.${ext}`;
}

/** Returns a name not yet in `taken` (case-insensitive) and records it. */
export function uniqueName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${stem} (${i})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}
