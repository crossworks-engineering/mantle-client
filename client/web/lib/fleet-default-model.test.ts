import { describe, expect, it } from 'vitest';
import {
  catalogPath,
  defaultModelState,
  keyForProvider,
  keyText,
  pickerNote,
  type DefaultModelView,
} from './fleet-default-model';

const K1 = { id: 'k1', name: 'openrouter', label: 'default', masked: 'sk-o…abcd' };
const K2 = { id: 'k2', name: 'openrouter/work', label: 'work', masked: 'sk-o…wxyz' };
const A1 = { id: 'a1', name: 'anthropic', label: 'default', masked: 'sk-a…1234' };
const CHOICES = [
  { provider: 'openrouter', providerName: 'OpenRouter', keys: [K1, K2] },
  { provider: 'anthropic', providerName: 'Anthropic', keys: [A1] },
];
const view = (v: Partial<DefaultModelView>): DefaultModelView => ({
  provider: null,
  providerName: null,
  key: null,
  problem: null,
  choices: CHOICES,
  ...v,
});

describe('defaultModelState', () => {
  it('loading, older brain, failed read', () => {
    expect(defaultModelState({ loading: true, notFound: false, data: undefined }).kind).toBe(
      'loading',
    );
    expect(defaultModelState({ loading: false, notFound: true, data: undefined }).kind).toBe(
      'older',
    );
    expect(defaultModelState({ loading: false, notFound: false, data: undefined }).kind).toBe(
      'error',
    );
  });

  it('unset, key gone, set', () => {
    expect(defaultModelState({ loading: false, notFound: false, data: view({}) }).kind).toBe(
      'unset',
    );
    expect(
      defaultModelState({
        loading: false,
        notFound: false,
        data: view({ provider: 'openrouter', providerName: 'OpenRouter', problem: 'key-missing' }),
      }),
    ).toEqual({ kind: 'key-missing', provider: 'openrouter', providerName: 'OpenRouter' });
    expect(
      defaultModelState({
        loading: false,
        notFound: false,
        data: view({ provider: 'openrouter', providerName: 'OpenRouter', key: K2 }),
      }),
    ).toEqual({ kind: 'set', provider: 'openrouter', providerName: 'OpenRouter', key: K2 });
  });
});

describe('pickerNote', () => {
  it('none while there is a list, and a way on when there is not', () => {
    expect(pickerNote({ kind: 'set', provider: 'p', providerName: 'P', key: K1 })).toBeNull();
    expect(pickerNote({ kind: 'loading' })).toBeNull();
    expect(pickerNote({ kind: 'unset' })).toMatch(/Overview, under Default Model.*type/);
    expect(
      pickerNote({ kind: 'key-missing', provider: 'openrouter', providerName: 'OpenRouter' }),
    ).toMatch(/OpenRouter is gone/);
    expect(pickerNote({ kind: 'older' })).toMatch(/release behind/);
  });

  it('never has an em dash', () => {
    for (const k of ['unset', 'older', 'error'] as const) {
      expect(pickerNote({ kind: k })).not.toContain(String.fromCharCode(0x2014));
    }
  });
});

describe('keyForProvider', () => {
  it('keeps the key when it is the provider’s, takes an only key, else none', () => {
    expect(keyForProvider(CHOICES, 'openrouter', 'k2')).toBe('k2');
    expect(keyForProvider(CHOICES, 'anthropic', 'k2')).toBe('a1');
    expect(keyForProvider(CHOICES, 'openrouter', 'a1')).toBe('');
    expect(keyForProvider(CHOICES, 'nope', 'k1')).toBe('');
  });
});

describe('keyText and catalogPath', () => {
  it('names a key by name and hint only', () => {
    expect(keyText(K2)).toBe('openrouter/work (sk-o…wxyz)');
  });

  it('asks the Models catalog with the provider and key', () => {
    expect(catalogPath('openrouter', 'k1')).toBe('/api/models?provider=openrouter&keyId=k1');
  });
});
