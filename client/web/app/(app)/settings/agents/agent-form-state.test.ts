import { describe, expect, it } from 'vitest';
import {
  ROLES,
  agentMemoryConfigFromForm,
  agentParamsFromForm,
  brainHasAgentThinkingEffort,
  defaultToolLoading,
  emptyForm,
  formFromAgent,
  tempDescriptor,
  validateAgent,
} from './agent-form-state';
import type { AgentSummary, FormState, MemoryConfig } from './agent-form-state';

/**
 * The agents form's pure layer. Until phase 1 lifted this out of a 2,147-line
 * screen, none of it could be reached without rendering the whole thing —
 * which is why validation, the rule an operator meets most often, had no test.
 */

const create = { mode: 'create' } as const;
const edit = { mode: 'edit', agent: { slug: 'saved' } as AgentSummary } as const;

/** A form that passes, so each test can spoil exactly one thing. */
const valid = (over: Partial<FormState> = {}): FormState => ({
  ...emptyForm(),
  name: 'Ada',
  slug: 'ada',
  apiKeyId: 'key_1',
  model: 'anthropic/claude-haiku-4.5',
  systemPrompt: 'Be useful.',
  ...over,
});

describe('validateAgent', () => {
  it('passes a complete form', () => {
    expect(validateAgent(valid(), create)).toEqual({});
    expect(validateAgent(valid(), edit)).toEqual({});
  });

  it('requires the four fields an agent cannot run without', () => {
    expect(validateAgent(valid({ name: '' }), create).name).toBeTruthy();
    expect(validateAgent(valid({ apiKeyId: '' }), create).apiKey).toBeTruthy();
    expect(validateAgent(valid({ model: '' }), create).model).toBeTruthy();
    expect(validateAgent(valid({ systemPrompt: '' }), create).systemPrompt).toBeTruthy();
  });

  it('treats whitespace as empty', () => {
    expect(validateAgent(valid({ name: '   ' }), create).name).toBeTruthy();
    expect(validateAgent(valid({ model: '  ' }), create).model).toBeTruthy();
    expect(validateAgent(valid({ systemPrompt: '\n\t' }), create).systemPrompt).toBeTruthy();
  });

  // The slug is immutable once saved, so an edit cannot get it wrong — and
  // must not be blocked by a rule it has no way to satisfy.
  it('checks the slug on create and not on edit', () => {
    expect(validateAgent(valid({ slug: '' }), create).slug).toBeTruthy();
    expect(validateAgent(valid({ slug: '' }), edit).slug).toBeUndefined();
    expect(validateAgent(valid({ slug: 'Not Valid' }), edit).slug).toBeUndefined();
  });

  it('accepts only what a slug may contain', () => {
    for (const ok of ['ada', 'ada-2', 'ada_2', 'a1']) {
      expect(validateAgent(valid({ slug: ok }), create).slug).toBeUndefined();
    }
    for (const bad of ['Ada', 'ada agent', 'ada.2', 'ada/2', 'ådå']) {
      expect(validateAgent(valid({ slug: bad }), create).slug).toBeTruthy();
    }
  });

  it('reports every problem at once, not the first', () => {
    const errs = validateAgent(valid({ name: '', model: '', apiKeyId: '' }), create);
    expect(Object.keys(errs).sort()).toEqual(['apiKey', 'model', 'name']);
  });
});

describe('tempDescriptor', () => {
  it('names every band, and never returns nothing', () => {
    for (const t of [0, 0.3, 0.31, 0.7, 0.9, 1.0, 1.2, 1.4, 1.8, 2]) {
      const d = tempDescriptor(t);
      expect(d.word).toBeTruthy();
      expect(d.hint).toBeTruthy();
    }
  });

  it('is inclusive at each boundary, so a band never falls through', () => {
    expect(tempDescriptor(0.3).word).toBe('Precise');
    expect(tempDescriptor(0.7).word).toBe('Grounded');
    expect(tempDescriptor(1.0).word).toBe('Balanced');
    expect(tempDescriptor(0.31).word).not.toBe('Precise');
  });
});

describe('emptyForm', () => {
  it('starts on a real role, ready to be filled in', () => {
    const f = emptyForm();
    expect(ROLES.some((r) => r.value === f.role)).toBe(true);
    expect(f.name).toBe('');
    expect(f.slug).toBe('');
  });

  it('honours the role it is given', () => {
    for (const r of ROLES) expect(emptyForm(r.value).role).toBe(r.value);
  });
});

describe('thinking effort on the form', () => {
  const row = (over: Partial<AgentSummary>): AgentSummary =>
    ({
      slug: 'ada',
      name: 'Ada',
      role: 'responder',
      provider: 'openrouter',
      model: 'm',
      systemPrompt: 'p',
      priority: 100,
      enabled: true,
      backupEnabled: false,
      viaTailnet: false,
      backupViaTailnet: false,
      memoryConfig: {},
      params: {},
      ...over,
    }) as AgentSummary;

  it('a new agent starts on inherit', () => {
    expect(emptyForm().thinkingEffort).toBeNull();
  });

  it('loads the stored effort, and inherit for null, missing or unknown', () => {
    expect(formFromAgent(row({ thinkingEffort: 'max' })).thinkingEffort).toBe('max');
    expect(formFromAgent(row({ thinkingEffort: 'off' })).thinkingEffort).toBe('off');
    expect(formFromAgent(row({ thinkingEffort: null })).thinkingEffort).toBeNull();
    expect(formFromAgent(row({})).thinkingEffort).toBeNull();
  });

  it('detects a brain that stores it by the key, null included', () => {
    expect(brainHasAgentThinkingEffort([row({ thinkingEffort: null })])).toBe(true);
    expect(brainHasAgentThinkingEffort([row({})])).toBe(false);
    // Nothing to look at (a fresh brain): show it; an older brain drops the key.
    expect(brainHasAgentThinkingEffort([])).toBe(true);
  });
});

describe('tool loading and the params a save sends', () => {
  const row = (params: AgentSummary['params']): AgentSummary =>
    ({
      slug: 'ada',
      name: 'Ada',
      role: 'responder',
      provider: 'openrouter',
      model: 'm',
      systemPrompt: 'p',
      priority: 100,
      enabled: true,
      backupEnabled: false,
      viaTailnet: false,
      backupViaTailnet: false,
      memoryConfig: {},
      params,
    }) as AgentSummary;

  it('a new agent sets no mode, so the brain picks', () => {
    expect(emptyForm().toolLoading).toBeNull();
    expect(agentParamsFromForm(emptyForm())).not.toHaveProperty('tool_loading');
  });

  it('loads every mode the contract has, and none for absent or unknown values', () => {
    for (const v of ['full', 'deferred', 'map'] as const) {
      expect(formFromAgent(row({ tool_loading: v })).toolLoading).toBe(v);
    }
    expect(formFromAgent(row({})).toolLoading).toBeNull();
    expect(
      formFromAgent(row({ tool_loading: 'lazy' } as unknown as AgentSummary['params'])).toolLoading,
    ).toBeNull();
  });

  it('a save keeps tool_loading: loading a map agent and saving sends map back', () => {
    const saved = { temperature: 0.4, tool_loading: 'map' as const };
    const form = formFromAgent(row(saved));
    expect(agentParamsFromForm(form, saved)).toEqual({ temperature: 0.4, tool_loading: 'map' });
  });

  it('a save keeps tool_loading: deferred and an explicit full go back as loaded', () => {
    for (const v of ['deferred', 'full'] as const) {
      const saved = { tool_loading: v };
      expect(agentParamsFromForm(formFromAgent(row(saved)), saved)).toEqual({
        temperature: 0.7,
        tool_loading: v,
      });
    }
  });

  it('a save of an agent with no mode set sends none, so the default still applies', () => {
    expect(agentParamsFromForm(formFromAgent(row({})), {})).not.toHaveProperty('tool_loading');
  });

  it('sends the mode the person picks, and none when they pick Default', () => {
    const saved = { tool_loading: 'map' as const };
    const picked = { ...formFromAgent(row(saved)), toolLoading: 'full' as const };
    expect(agentParamsFromForm(picked, saved)).toHaveProperty('tool_loading', 'full');
    const reset = { ...formFromAgent(row(saved)), toolLoading: null };
    expect(agentParamsFromForm(reset, saved)).not.toHaveProperty('tool_loading');
  });

  it('the default is the map for an assistant, deferred on Haiku, full otherwise', () => {
    expect(defaultToolLoading('assistant', 'anthropic/claude-sonnet-5.5')).toBe('map');
    expect(defaultToolLoading('responder', 'anthropic/claude-sonnet-5.5')).toBe('map');
    expect(defaultToolLoading('assistant', 'anthropic/claude-haiku-5.5')).toBe('deferred');
    expect(defaultToolLoading('extractor', 'anthropic/claude-sonnet-5.5')).toBe('full');
  });

  it('keeps top_p, which has no field, and never sends keys the brain rejects', () => {
    const saved = {
      top_p: 0.9,
      max_retries: 3,
      voice: { enabled: true },
      temperature: 1,
    };
    const params = agentParamsFromForm(formFromAgent(row(saved)), saved);
    expect(params).toEqual({ temperature: 1, top_p: 0.9 });
  });
});

describe('corpus map size and the memory_config a save sends', () => {
  const row = (
    memoryConfig: MemoryConfig,
    role: AgentSummary['role'] = 'assistant',
  ): AgentSummary =>
    ({
      slug: 'ada',
      name: 'Ada',
      role,
      provider: 'openrouter',
      model: 'm',
      systemPrompt: 'p',
      priority: 100,
      enabled: true,
      backupEnabled: false,
      viaTailnet: false,
      backupViaTailnet: false,
      memoryConfig,
      params: {},
    }) as AgentSummary;

  // What a brain stores on an assistant, most of it set outside this form.
  const stored: MemoryConfig = {
    history_limit: 20,
    corpus_map_limit: 300,
    corpus_map_chars: 9_000,
    delegate_to: ['researcher'],
    inject_journal: true,
    journal_tiers: 'live',
    journal_relevant_chars: 4_000,
    notes_target: 'journal',
    chunk_limit: 4,
    max_iterations: 12,
  };

  it('loads the stored size, and empty (the default) when none is stored', () => {
    expect(formFromAgent(row(stored)).corpusMapChars).toBe('9000');
    expect(formFromAgent(row({})).corpusMapChars).toBe('');
    expect(emptyForm().corpusMapChars).toBe('');
  });

  it('an unchanged save sends the size back and leaves every hidden key out', () => {
    const mc = agentMemoryConfigFromForm(formFromAgent(row(stored)), stored);
    expect(mc.corpus_map_chars).toBe(9_000);
    expect(mc.delegate_to).toEqual(['researcher']);
    // The brain merges, so a key left out keeps its stored value. Sending one
    // of these would overwrite a value the form never showed.
    for (const k of [
      'corpus_map_limit',
      'inject_journal',
      'journal_tiers',
      'journal_relevant_chars',
      'notes_target',
      'chunk_limit',
      'max_iterations',
    ]) {
      expect(mc).not.toHaveProperty(k);
    }
  });

  it('a new size is sent as a number', () => {
    const form = { ...formFromAgent(row(stored)), corpusMapChars: '4000' };
    expect(agentMemoryConfigFromForm(form, stored).corpus_map_chars).toBe(4_000);
  });

  it('emptying a stored size sends null (back to the default)', () => {
    const form = { ...formFromAgent(row(stored)), corpusMapChars: '' };
    expect(agentMemoryConfigFromForm(form, stored).corpus_map_chars).toBeNull();
  });

  it('no stored size and an empty field sends nothing (an older brain refuses null)', () => {
    const mc = agentMemoryConfigFromForm(formFromAgent(row({})), {});
    expect(mc).not.toHaveProperty('corpus_map_chars');
  });

  it('an empty time window is sent as null so clearing it sticks', () => {
    const saved: MemoryConfig = { history_window_hours: 6 };
    const form = { ...formFromAgent(row(saved)), historyWindowHours: '' };
    expect(agentMemoryConfigFromForm(form, saved).history_window_hours).toBeNull();
    const kept = agentMemoryConfigFromForm(formFromAgent(row(saved)), saved);
    expect(kept.history_window_hours).toBe(6);
  });

  it('only responder and assistant agents send a size', () => {
    const form = { ...formFromAgent(row(stored, 'extractor')), corpusMapChars: '4000' };
    expect(agentMemoryConfigFromForm(form, stored)).not.toHaveProperty('corpus_map_chars');
  });

  it('validates the range, and empty is fine', () => {
    expect(validateAgent(valid({ role: 'assistant', corpusMapChars: '' }), create)).toEqual({});
    expect(validateAgent(valid({ role: 'assistant', corpusMapChars: '6500' }), create)).toEqual({});
    for (const bad of ['999', '50001', '2500.5', 'abc']) {
      expect(
        validateAgent(valid({ role: 'assistant', corpusMapChars: bad }), create).corpusMapChars,
      ).toBeTruthy();
    }
  });
});
