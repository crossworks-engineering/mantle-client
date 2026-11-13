import { describe, expect, it } from 'vitest';
import {
  columnType,
  insertName,
  pageCount,
  pageSql,
  pageText,
  queryKey,
  quoted,
  readDbView,
  toGridDoc,
  withDbView,
} from './file-data-model';

describe('columnType', () => {
  it('reads SQLite number types as numbers, the rest as text', () => {
    for (const t of ['INTEGER', 'REAL', 'NUMERIC', 'DOUBLE', 'FLOAT', 'DECIMAL(10,2)', 'int']) {
      expect(columnType(t)).toBe('number');
    }
    for (const t of ['TEXT', 'BLOB', '', undefined]) expect(columnType(t)).toBe('text');
  });
});

describe('toGridDoc', () => {
  it('gives each column an id by place, so a name used twice is still two columns', () => {
    const doc = toGridDoc(['A', 'A', 'B'], [[1, 2, 'x']], { B: 'REAL' });
    expect(doc.columns.map((c) => c.id)).toEqual(['c0', 'c1', 'c2']);
    expect(doc.columns.map((c) => c.type)).toEqual(['text', 'text', 'number']);
    expect(doc.rows[0]!.cells).toEqual({ c0: 1, c1: 2, c2: 'x' });
  });

  it('keeps nothing as empty and shows an object as JSON', () => {
    const doc = toGridDoc(['A', 'B', 'C'], [[null, { k: 1 }, undefined]]);
    expect(doc.rows[0]!.cells).toEqual({ c0: null, c1: '{"k":1}', c2: null });
  });

  it('gives each row its own id', () => {
    expect(toGridDoc(['A'], [[1], [2]]).rows.map((r) => r.id)).toEqual(['r0', 'r1']);
  });
});

describe('paging', () => {
  it('says which rows show', () => {
    expect(pageText(0, 100, 1234)).toBe('Rows 1 to 100 of 1,234');
    expect(pageText(1200, 34, 1234)).toBe('Rows 1,201 to 1,234 of 1,234');
    expect(pageText(0, 0, 0)).toBe('No rows');
  });

  it('counts at least one page', () => {
    expect(pageCount(0, 100)).toBe(1);
    expect(pageCount(100, 100)).toBe(1);
    expect(pageCount(101, 100)).toBe(2);
  });

  it('asks a page in file order, or sorted with file order to break ties', () => {
    const tab = { view: 'Pts', columns: [{ name: 'Id' }, { name: 'Say "hi"' }] };
    expect(pageSql(tab, { offset: 200, size: 100, sort: null })).toBe(
      'SELECT "Id", "Say ""hi""" FROM "Pts" ORDER BY "_pos" LIMIT 100 OFFSET 200',
    );
    expect(pageSql(tab, { offset: 0, size: 50, sort: { column: 'Id', desc: true } })).toBe(
      'SELECT "Id", "Say ""hi""" FROM "Pts" ORDER BY "Id" DESC, "_pos" LIMIT 50 OFFSET 0',
    );
    expect(pageSql({ view: 'X', columns: [] }, { offset: 0, size: 10, sort: null })).toBe(
      'SELECT * FROM "X" ORDER BY "_pos" LIMIT 10 OFFSET 0',
    );
  });
});

describe('insertName', () => {
  it('puts the quoted name at the caret, with a space after a word', () => {
    expect(insertName('SELECT * FROM', 13, 13, 'Points')).toEqual({
      text: 'SELECT * FROM "Points"',
      caret: 22,
    });
  });

  it('adds no space after a space, a bracket, a comma or a dot', () => {
    expect(insertName('SELECT ', 7, 7, 'A').text).toBe('SELECT "A"');
    expect(insertName('count(', 6, 6, 'A').text).toBe('count("A"');
    expect(insertName('a,', 2, 2, 'B').text).toBe('a,"B"');
    expect(insertName('t.', 2, 2, 'B').text).toBe('t."B"');
    expect(insertName('', 0, 0, 'B')).toEqual({ text: '"B"', caret: 3 });
  });

  it('replaces the selection and doubles a quote in the name', () => {
    expect(insertName('SELECT x FROM y', 7, 8, 'Say "hi"')).toEqual({
      text: 'SELECT "Say ""hi""" FROM y',
      caret: 19,
    });
  });
});

describe('the database view in the URL', () => {
  const p = (q: string) => new URLSearchParams(q);

  it('reads off, a tab, or the query', () => {
    expect(readDbView(p('path=files'))).toEqual({ on: false });
    expect(readDbView(p('view=data&dbtab=Lines'))).toEqual({
      on: true,
      query: false,
      tab: 'Lines',
    });
    expect(readDbView(p('view=query'))).toEqual({ on: true, query: true, tab: null });
    expect(readDbView(p('view=other'))).toEqual({ on: false });
  });

  it('writes it and keeps the rest of the URL', () => {
    const base = p('path=files%2Fcrew&file=abc');
    expect(withDbView(base, { on: true, query: false, tab: 'Two words' })).toBe(
      'path=files%2Fcrew&file=abc&view=data&dbtab=Two+words',
    );
    expect(withDbView(p('file=abc&view=data&dbtab=A'), { on: true, query: true, tab: null })).toBe(
      'file=abc&view=query',
    );
    expect(withDbView(p('file=abc&view=data&dbtab=A'), { on: false })).toBe('file=abc');
  });

  it('round-trips', () => {
    const next = { on: true as const, query: false, tab: 'Ä "tab"' };
    expect(readDbView(p(withDbView(p('file=1'), next)))).toEqual(next);
  });
});

it('quotes a name and keys a query per file', () => {
  expect(quoted('a"b')).toBe('"a""b"');
  expect(queryKey('f1')).toBe('mantle:file-sql:f1');
});
