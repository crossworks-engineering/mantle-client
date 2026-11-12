import { describe, expect, it } from 'vitest';

import { DECISION_USES } from './decision-uses';

describe('the decider uses on the form', () => {
  it('lists every brain use (mantle DecisionUse), in display order', () => {
    expect(DECISION_USES.map((u) => u.id)).toEqual([
      'passage_scoring',
      'context_pruning',
      'delegation_hint',
      'version_grouping',
      'fact_add_prefilter',
      'history_recall',
      'journal_recall',
      'rule_reconcile',
      'pdf_kind',
      'model_routing',
    ]);
  });

  it('pdf_kind has no threshold field: it uses the worker floor', () => {
    const u = DECISION_USES.find((x) => x.id === 'pdf_kind')!;
    expect(u.label).toBe('PDF kind');
    expect(u.threshold).toBeUndefined();
    expect(u.pool).toBeUndefined();
    expect(u.description).toMatch(/shadow/);
  });
});
