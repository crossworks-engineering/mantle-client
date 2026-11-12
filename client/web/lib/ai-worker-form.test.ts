import { describe, expect, it } from 'vitest';

import { mergeParams, paramsFromForm } from './ai-worker-form';
import { deciderPrivacyOf } from './decider';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** What the PATCH body carries: JSON drops undefined, so a cleared key is gone. */
function wire(v: Record<string, unknown>): unknown {
  return JSON.parse(JSON.stringify(v));
}

const deciderForm = (pool: string) =>
  form({
    use_passage_scoring_enabled: 'on',
    use_passage_scoring_mode: 'live',
    use_passage_scoring_threshold: '1.5',
    use_passage_scoring_pool: pool,
    use_context_pruning_mode: 'shadow',
    use_context_pruning_threshold: '1',
    zdr: 'on',
    timeout_ms: '1500',
    defer_below: '0.6',
    act_alone_at: '0.9',
  });

describe('decider params from the form', () => {
  it('writes the pool as a whole number 1..100', () => {
    const uses = (fd: FormData) =>
      (paramsFromForm('decider', fd).uses as Record<string, Record<string, unknown>>)
        .passage_scoring;
    expect(uses(deciderForm('50'))!.pool).toBe(50);
    expect(uses(deciderForm('37.9'))!.pool).toBe(37);
    expect(uses(deciderForm('500'))!.pool).toBe(100);
    expect(uses(deciderForm('0'))!.pool).toBeUndefined();
    expect(uses(deciderForm(''))!.pool).toBeUndefined();
  });

  it('writes both privacy keys in step, so an untick wins over an old privacy key', () => {
    const ticked = paramsFromForm('decider', deciderForm('50'));
    expect(ticked).toMatchObject({ privacy: 'zdr', zdr: true });
    const unticked = paramsFromForm('decider', form({ timeout_ms: '1500' }));
    expect(unticked).toMatchObject({ privacy: 'no_training', zdr: false });
    // A saved `privacy: 'zdr'` (written by the API) no longer outlives the untick.
    const merged = mergeParams({ privacy: 'zdr', zdr: true }, unticked);
    expect(deciderPrivacyOf(merged)).toBe('no_training');
  });

  it('writes pdf_kind as the brain seeds it: on, shadow, no threshold', () => {
    const p = paramsFromForm(
      'decider',
      form({ use_pdf_kind_enabled: 'on', use_pdf_kind_mode: 'shadow' }),
    );
    expect((p.uses as Record<string, unknown>).pdf_kind).toEqual({
      enabled: true,
      mode: 'shadow',
    });
  });

  it('a blank number field is unset, not 0', () => {
    const p = paramsFromForm('decider', form({ timeout_ms: '' }));
    expect(p.timeout_ms).toBeUndefined();
  });
});

describe('mergeParams: a save keeps what the form does not show', () => {
  const saved = {
    uses: {
      passage_scoring: {
        enabled: true,
        mode: 'shadow',
        threshold: 1.5,
        pool: 50,
        min_confidence: 0.7,
      },
      context_pruning: { enabled: true, mode: 'live', threshold: 1 },
      some_future_use: { enabled: true, mode: 'shadow', knob: 3 },
    },
    zdr: true,
    timeout_ms: 1500,
    future_top_level: 'keep me',
  };

  it('keeps unknown keys at every level and the pool when the field holds it', () => {
    const next = paramsFromForm('decider', deciderForm('50'));
    expect(wire(mergeParams(saved, next))).toEqual({
      uses: {
        passage_scoring: {
          enabled: true,
          mode: 'live',
          threshold: 1.5,
          pool: 50,
          min_confidence: 0.7,
        },
        context_pruning: { enabled: false, mode: 'shadow', threshold: 1 },
        some_future_use: { enabled: true, mode: 'shadow', knob: 3 },
      },
      privacy: 'zdr',
      zdr: true,
      timeout_ms: 1500,
      defer_below: 0.6,
      act_alone_at: 0.9,
      future_top_level: 'keep me',
    });
  });

  it('a blanked pool field clears the pool (back to the default)', () => {
    const next = paramsFromForm('decider', deciderForm(''));
    const out = wire(mergeParams(saved, next)) as {
      uses: Record<string, Record<string, unknown>>;
    };
    expect(out.uses.passage_scoring).not.toHaveProperty('pool');
    expect(out.uses.passage_scoring!.min_confidence).toBe(0.7);
  });

  it('works for any kind and with no saved params', () => {
    expect(mergeParams(null, { a: 1 })).toEqual({ a: 1 });
    const next = paramsFromForm('summarizer', form({ temperature: '0.2' }));
    expect(wire(mergeParams({ temperature: 0.5, new_knob: true }, next))).toEqual({
      temperature: 0.2,
      new_knob: true,
    });
  });
});
