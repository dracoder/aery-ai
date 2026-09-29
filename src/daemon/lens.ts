export type LensTemplate = 'document' | 'table';

export const LENS_TABLES = ['workflows'] as const;
export type LensTable = string;

export const LENS_HOARD_PAGES = ['user.md', 'learned.md', 'persona.md'] as const;

const BRIEF_FILE = /^brief-[a-z0-9-]+\.md$/;

const RUN_ID = /^\d{1,9}$/;

export type LensTarget =
  | { ok: true; kind: 'brief-file'; file: string }
  | { ok: true; kind: 'run-id'; runId: number }
  | { ok: true; kind: 'hoard-page'; file: string }
  | { ok: true; kind: 'table'; table: LensTable }
  | { ok: false; error: string };

export function validateLensTarget(
  template: string, idRaw: unknown,
  ext?: { tables?: readonly string[]; briefs?: boolean },
): LensTarget {
  const tables = [...LENS_TABLES, ...(ext?.tables ?? [])];
  const id = String(idRaw ?? '').trim();
  if (!id) return { ok: false, error: 'no id — name a brief file or a table' };
  if (/[/\\]|\.\.|:/.test(id)) {
    return { ok: false, error: 'ids never carry paths or URLs — the daemon resolves ids against its own stores' };
  }
  if (template === 'document') {
    if (ext?.briefs && BRIEF_FILE.test(id)) return { ok: true, kind: 'brief-file', file: id };
    if (ext?.briefs && RUN_ID.test(id)) return { ok: true, kind: 'run-id', runId: Number(id) };
    if ((LENS_HOARD_PAGES as readonly string[]).includes(id)) return { ok: true, kind: 'hoard-page', file: id };
    return { ok: false, error: `a document id is ${ext?.briefs ? 'a brief filename (brief-….md), or ' : ''}a hoard page (${LENS_HOARD_PAGES.join(', ')})` };
  }
  if (template === 'table') {
    if (tables.includes(id)) return { ok: true, kind: 'table', table: id };
    return { ok: false, error: `a table id is one of: ${tables.join(', ')}` };
  }
  return { ok: false, error: `unknown template "${String(template)}" — the catalogue is document, table` };
}

export function firstHeading(md: string): string | null {
  for (const line of md.split('\n')) {
    const h = /^#+\s+(.{3,120})/.exec(line.trim());
    if (h) return h[1]!.trim();
  }
  return null;
}

export interface LensPanel {
  template: LensTemplate;
  id: string;
  title: string;
  source: string;
  ts: string;
  taint: boolean;
  opened: 'conversation' | 'initiative';
  body?: string;
  header?: string[];
  rows?: string[][];
  truncated?: number;
}
