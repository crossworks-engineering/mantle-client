/**
 * The decider uses the form shows, one switch each (worker-fields-decider.tsx).
 * Data only, so a unit test can pin it against the brain list.
 */

/** The uses the server knows (mantle `DecisionUse`). Order = display order.
 *  A use listed here but not yet built on the server is harmless: the
 *  server ignores switches for uses it has no call site for. */
export const DECISION_USES: ReadonlyArray<{
  id: string;
  label: string;
  description: string;
  /** Default threshold when the use has one; omitted = no threshold field. */
  threshold?: number;
  /** `score` = Jev's 0–3 score, `probability` = a yes/no probability 0–1. */
  scale?: 'score' | 'probability';
  /** What the threshold does, for the field hint. */
  thresholdHint?: string;
  /** Shows the "passages judged" pool field (passage_scoring). */
  pool?: boolean;
}> = [
  {
    id: 'passage_scoring',
    label: 'Passage scoring',
    description:
      'Scores each search passage 0–3 for “does it answer the question” and, when live, drops the weak ones before they enter the prompt (search_chunks and the responder’s auto-context).',
    threshold: 1.5,
    scale: 'score',
    thresholdHint: 'Passages scoring below this are dropped when live.',
    pool: true,
  },
  {
    id: 'context_pruning',
    label: 'Context pruning',
    description:
      'One call per turn over every injected fact, content hit and passage; when live, items under the threshold are dropped. Preferences are always kept; history and the corpus map are never touched.',
    threshold: 1.0,
    scale: 'score',
    thresholdHint: 'Items scoring below this are dropped when live.',
  },
  {
    id: 'delegation_hint',
    label: 'Delegation hint',
    description:
      'Before a turn, picks which delegate (or none) the message looks like work for. When live, one hint line is added to the system context; the responder still decides.',
  },
  {
    id: 'version_grouping',
    label: 'Version grouping',
    description:
      'Once per turn, finds two passages that are versions of the same text. A superseded hit goes when its successor is also there; for unlinked look-alikes Jev decides, and when live the lower-ranked copy is dropped.',
    threshold: 0.9,
    scale: 'probability',
    thresholdHint: 'A “same passage” yes at or above this drops the lower-ranked copy.',
  },
  {
    id: 'fact_add_prefilter',
    label: 'Fact ADD pre-filter',
    description:
      'During fact extraction, a confident “add” from Jev skips the chat classifier. Any other answer still goes to the classifier; Jev never updates or deletes a fact.',
  },
  {
    id: 'history_recall',
    label: 'History recall',
    description:
      'Scores the exchanges older than the history limit (up to 50 messages back) for “does a reply need it”. When live, the ones at the threshold rejoin the history, marked as recalled. Pairs with a history limit of 20.',
    threshold: 1.0,
    scale: 'score',
    thresholdHint: 'Older exchanges scoring at or above this come back when live.',
  },
  {
    id: 'journal_recall',
    label: 'Journal recall',
    description:
      'Scores every rule the agent learned against the message. When live, the best rules (at the threshold, up to 25) are sent with the turn instead of the similarity pick.',
    threshold: 1.5,
    scale: 'score',
    thresholdHint: 'Learned rules scoring at or above this are sent when live.',
  },
  {
    id: 'rule_reconcile',
    label: 'Rule reconcile',
    description:
      'When an agent learns a rule, checks its close older rules: same rule, or changed by the new one? When live, the older rule is retired into the new one (reversible). Also needed by the Journal rules cleanup task.',
    threshold: 0.8,
    scale: 'probability',
    thresholdHint: 'A “same” or “changes it” yes at or above this retires the older rule.',
  },
  {
    id: 'pdf_kind',
    label: 'PDF kind',
    description:
      'For a PDF that reads as a drawing but that the rules could not name, asks once which kind it is (P&ID, process flow diagram, isometric, equipment drawing, datasheet, table, document or other drawing). When live, a confident answer picks which reader fills the file’s database. Starts in shadow: the answer only sits beside the rules’ kind in the File tab.',
  },
  {
    id: 'model_routing',
    label: 'Model routing (not built yet)',
    description: 'Sizes each request so a cheaper model can take the simple ones.',
  },
];
