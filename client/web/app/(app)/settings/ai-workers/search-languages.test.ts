import { describe, expect, it } from 'vitest';
import { parseLanguageField } from './search-languages';

describe('parseLanguageField', () => {
  it('splits on commas and spaces', () => {
    expect(parseLanguageField(' es, fr  pt-BR,,')).toEqual(['es', 'fr', 'pt-BR']);
  });
  it('empty is none', () => {
    expect(parseLanguageField('   ')).toEqual([]);
  });
});
