import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRINT_OPTIONS,
  clampMm,
  clampText,
  decodePrintOptions,
  encodePrintOptions,
  exportPath,
  normalisePrintOptions,
  printQuery,
  uniformMargins,
  type PrintOptions,
} from './print-options';

/**
 * The link the Export menu builds must be the brain's contract
 * (server/web/lib/print-options.ts): defaults omitted, so the default link is
 * the one it always was; numbers inside 0..60; text 200 characters; flags as
 * `1`; never an empty header or footer. Nothing the menu sends is a 400.
 */

const withOpts = (patch: Partial<PrintOptions>): PrintOptions => ({
  ...DEFAULT_PRINT_OPTIONS,
  ...patch,
});
const withMargins = (m: Partial<PrintOptions['margins']>): PrintOptions =>
  withOpts({ margins: { ...DEFAULT_PRINT_OPTIONS.margins, ...m } });

describe('printQuery', () => {
  it('sends nothing for the defaults, so the default link stays as today', () => {
    expect(printQuery(DEFAULT_PRINT_OPTIONS)).toBe('');
    expect(exportPath('n1', 'pdf', DEFAULT_PRINT_OPTIONS)).toBe('/api/export/n1?format=pdf');
  });

  it('leaves the other formats alone', () => {
    expect(exportPath('n1', 'docx', withOpts({ landscape: true }))).toBe(
      '/api/export/n1?format=docx',
    );
    expect(exportPath('n1', 'svg')).toBe('/api/export/n1?format=svg');
  });

  it('sends the paper only when it is not a4', () => {
    expect(printQuery(withOpts({ paper: 'letter' }))).toBe('&paper=letter');
    expect(printQuery(withOpts({ paper: 'a4' }))).toBe('');
  });

  it('sends the flags as 1 and never as 0', () => {
    expect(printQuery(withOpts({ landscape: true }))).toBe('&landscape=1');
    expect(printQuery(withOpts({ pageNumbers: true }))).toBe('&page_numbers=1');
    expect(printQuery(withOpts({ landscape: false, pageNumbers: false }))).toBe('');
  });

  it('sends four equal sides as one margin', () => {
    expect(printQuery(withMargins({ top: 10, right: 10, bottom: 10, left: 10 }))).toBe(
      '&margin=10',
    );
    // 18 on every side differs from the 16 left and right: still one margin.
    expect(printQuery(withMargins({ right: 18, left: 18 }))).toBe('&margin=18');
  });

  it('sends only the sides that differ', () => {
    expect(printQuery(withMargins({ top: 30 }))).toBe('&margin_top=30');
    expect(printQuery(withMargins({ right: 0, left: 5 }))).toBe('&margin_right=0&margin_left=5');
    expect(printQuery(withMargins({ top: 1, right: 2, bottom: 3, left: 4 }))).toBe(
      '&margin_top=1&margin_right=2&margin_bottom=3&margin_left=4',
    );
  });

  it('clamps a margin to 0..60 and rounds it', () => {
    expect(printQuery(withMargins({ top: 99 }))).toBe('&margin_top=60');
    expect(printQuery(withMargins({ top: -4 }))).toBe('&margin_top=0');
    expect(printQuery(withMargins({ top: 20.6 }))).toBe('&margin_top=21');
    expect(printQuery(withMargins({ top: Number.NaN }))).toBe('');
  });

  it('trims a header or footer, caps it at 200 characters and encodes it', () => {
    expect(printQuery(withOpts({ header: '  Quarterly report  ' }))).toBe(
      '&header=Quarterly+report',
    );
    const long = 'x'.repeat(250);
    const q = printQuery(withOpts({ footer: long }));
    expect(q).toBe(`&footer=${'x'.repeat(200)}`);
    expect(printQuery(withOpts({ header: 'a&b=c' }))).toBe('&header=a%26b%3Dc');
  });

  it('never sends an empty header or footer', () => {
    expect(printQuery(withOpts({ header: '', footer: '   ' }))).toBe('');
  });

  it('keeps the brain’s parameter order and names', () => {
    expect(
      printQuery(
        withOpts({
          paper: 'a3',
          landscape: true,
          margins: { top: 5, right: 5, bottom: 5, left: 5 },
          header: 'H',
          footer: 'F',
          pageNumbers: true,
        }),
      ),
    ).toBe('&paper=a3&landscape=1&margin=5&header=H&footer=F&page_numbers=1');
  });
});

describe('clamps', () => {
  it('clampMm pins and falls back', () => {
    expect(clampMm(70, 18)).toBe(60);
    expect(clampMm(-1, 18)).toBe(0);
    expect(clampMm('12', 18)).toBe(12);
    expect(clampMm('', 18)).toBe(18);
    expect(clampMm(undefined, 16)).toBe(16);
    expect(clampMm(Infinity, 16)).toBe(16);
  });

  it('clampText trims and caps', () => {
    expect(clampText(' hi ')).toBe('hi');
    expect(clampText(42)).toBe('');
    expect(clampText('y'.repeat(300))).toHaveLength(200);
  });

  it('uniformMargins', () => {
    expect(uniformMargins({ top: 1, right: 1, bottom: 1, left: 1 })).toBe(true);
    expect(uniformMargins(DEFAULT_PRINT_OPTIONS.margins)).toBe(false);
  });
});

describe('normalise and storage', () => {
  it('a junk shape comes back as the defaults', () => {
    expect(normalisePrintOptions(null)).toEqual(DEFAULT_PRINT_OPTIONS);
    expect(normalisePrintOptions({ paper: 'b5', landscape: 'yes', margins: 'x' })).toEqual(
      DEFAULT_PRINT_OPTIONS,
    );
  });

  it('a stored copy survives the round trip, clamped', () => {
    const stored = encodePrintOptions(
      withOpts({ paper: 'legal', margins: { top: 99, right: 1, bottom: 2, left: 3 }, header: 'x' }),
    );
    expect(decodePrintOptions(stored)).toEqual(
      withOpts({ paper: 'legal', margins: { top: 60, right: 1, bottom: 2, left: 3 }, header: 'x' }),
    );
  });

  it('a stored copy that is not JSON or not an object is nothing', () => {
    expect(decodePrintOptions('{')).toBeNull();
    expect(decodePrintOptions('"a4"')).toBeNull();
    expect(decodePrintOptions('null')).toBeNull();
    // An array is an object with none of the fields: the defaults, not junk.
    expect(decodePrintOptions('[]')).toEqual(DEFAULT_PRINT_OPTIONS);
  });

  it('an older or partial stored shape fills in the defaults', () => {
    expect(decodePrintOptions('{"paper":"a3"}')).toEqual(withOpts({ paper: 'a3' }));
    expect(decodePrintOptions('{"margins":{"top":4}}')).toEqual(withMargins({ top: 4 }));
    // A flag is a boolean; the string "true" is not a choice anyone made.
    expect(decodePrintOptions('{"landscape":"true","pageNumbers":1}')).toEqual(
      DEFAULT_PRINT_OPTIONS,
    );
  });
});
