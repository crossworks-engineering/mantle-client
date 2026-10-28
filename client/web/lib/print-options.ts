/**
 * The print options of a PDF export, the client half of the brain's
 * `server/web/lib/print-options.ts` (mantle docs/pages.md §7): paper,
 * orientation, margins, a header and a footer line, page numbers. The Export
 * menu's PDF entry collects them; `printQuery` turns them into the query
 * parameters the brain's `GET /api/export/:id?format=pdf` reads, and only the
 * ones that differ from the brain's defaults, so the default download link is
 * the link it always was. A brain older than the documents release ignores
 * unknown query parameters, so the menu is harmless before it.
 *
 * Validation mirrors the brain's, so nothing the menu sends can be a 400:
 * a margin is clamped to 0 to 60 mm, a header or footer is trimmed to 200
 * characters, and an empty one is not sent at all.
 */

export const PAPER_SIZES = ['a4', 'a3', 'a5', 'letter', 'legal'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

export const PAPER_LABELS: Record<PaperSize, string> = {
  a4: 'A4',
  a3: 'A3',
  a5: 'A5',
  letter: 'Letter',
  legal: 'Legal',
};

export type Margins = { top: number; right: number; bottom: number; left: number };
export const SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type Side = (typeof SIDES)[number];

export type PrintOptions = {
  paper: PaperSize;
  landscape: boolean;
  /** Millimetres, 0 to 60. */
  margins: Margins;
  /** Plain text, 200 characters at most; '' means none. */
  header: string;
  footer: string;
  pageNumbers: boolean;
};

export const MAX_MARGIN_MM = 60;
export const MAX_TEXT = 200;

export const DEFAULT_PRINT_OPTIONS: PrintOptions = Object.freeze({
  paper: 'a4',
  landscape: false,
  margins: Object.freeze({ top: 18, right: 16, bottom: 18, left: 16 }),
  header: '',
  footer: '',
  pageNumbers: false,
});

/** The browser's key for the last used options. */
export const PRINT_OPTIONS_KEY = 'export:print';

/** One of the paper sizes, or null for anything else. */
export function parsePaper(v: unknown): PaperSize | null {
  return typeof v === 'string' && (PAPER_SIZES as readonly string[]).includes(v)
    ? (v as PaperSize)
    : null;
}

/** A margin as the brain takes it: a finite number pinned to 0..60, whole
 *  millimetres; anything else is the side's default. */
export function clampMm(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_MARGIN_MM, Math.max(0, Math.round(n)));
}

/** A header or footer line as the brain takes it: trimmed, 200 characters. */
export function clampText(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '';
}

/** Every field valid, whatever came in (a form in flight, a stored copy from
 *  an older build, a hand-edited one). */
export function normalisePrintOptions(input: unknown): PrintOptions {
  const d = DEFAULT_PRINT_OPTIONS;
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const m = (o.margins && typeof o.margins === 'object' ? o.margins : {}) as Record<
    string,
    unknown
  >;
  return {
    paper: parsePaper(o.paper) ?? d.paper,
    landscape: o.landscape === true,
    margins: {
      top: clampMm(m.top, d.margins.top),
      right: clampMm(m.right, d.margins.right),
      bottom: clampMm(m.bottom, d.margins.bottom),
      left: clampMm(m.left, d.margins.left),
    },
    header: clampText(o.header),
    footer: clampText(o.footer),
    pageNumbers: o.pageNumbers === true,
  };
}

/** All four sides the same. */
export function uniformMargins(m: Margins): boolean {
  return m.top === m.right && m.top === m.bottom && m.top === m.left;
}

/**
 * The query parameters for the options that differ from the defaults, as
 * `URLSearchParams` (empty for the defaults). Four equal sides go as one
 * `margin`; otherwise each side that differs goes on its own. Flags go as
 * `1`; an empty header or footer does not go at all.
 */
export function printParams(input: PrintOptions): URLSearchParams {
  const o = normalisePrintOptions(input);
  const d = DEFAULT_PRINT_OPTIONS;
  const q = new URLSearchParams();
  if (o.paper !== d.paper) q.set('paper', o.paper);
  if (o.landscape) q.set('landscape', '1');
  const m = o.margins;
  const sidesDiffer = SIDES.some((s) => m[s] !== d.margins[s]);
  if (sidesDiffer) {
    if (uniformMargins(m)) q.set('margin', String(m.top));
    else for (const s of SIDES) if (m[s] !== d.margins[s]) q.set(`margin_${s}`, String(m[s]));
  }
  if (o.header) q.set('header', o.header);
  if (o.footer) q.set('footer', o.footer);
  if (o.pageNumbers) q.set('page_numbers', '1');
  return q;
}

/** The query string after `format=pdf`: '' for the defaults, else `&…`. */
export function printQuery(input: PrintOptions): string {
  const q = printParams(input).toString();
  return q ? `&${q}` : '';
}

/**
 * The export route of a node in a format; for PDF, with the print options
 * that differ from the defaults. The path the asset resolver signs
 * (`useAssetUrl`), not a full URL.
 */
export function exportPath(nodeId: string, format: string, options?: PrintOptions): string {
  const base = `/api/export/${nodeId}?format=${format}`;
  return format === 'pdf' && options ? `${base}${printQuery(options)}` : base;
}

/** The stored copy: JSON, read back through `normalisePrintOptions`, so junk
 *  and an older build's shape both come back valid. Returns null for a value
 *  that is not an object at all (the fallback stands). */
export function decodePrintOptions(raw: string): PrintOptions | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return normalisePrintOptions(parsed);
  } catch {
    return null;
  }
}

export function encodePrintOptions(o: PrintOptions): string {
  return JSON.stringify(normalisePrintOptions(o));
}
