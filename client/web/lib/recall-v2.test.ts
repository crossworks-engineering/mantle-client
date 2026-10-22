import { describe, expect, it } from 'vitest';
import { ApiError } from '@mantle/web-ui/api-fetch';
import type { RecallCardDetailDTO, RecallMapSummaryDTO } from '@mantle/web-ui/types/recall-v2';
import {
  RECALL_OPTIONS_MAX,
  actorLabel,
  budgetState,
  cardAttention,
  cardKindOf,
  cardTrail,
  incomingOptions,
  unreachableSlugs,
  cardProblems,
  cardWriteBody,
  droppedText,
  dropCard,
  editsOf,
  fetchAllMaps,
  isNativeMap,
  isStale,
  linkFromBody,
  moveCard,
  normalisedEdits,
  optionTargets,
  optionTargetValue,
  recallV2Of,
  restoreBlockedReason,
  restoreCopy,
  sameEdits,
  versionState,
  writeErrorText,
} from './recall-v2';

function card(over: Partial<RecallCardDetailDTO> = {}): RecallCardDetailDTO {
  return {
    id: 'c1',
    slug: 'fleet',
    kind: 'knowledge',
    title: 'Fleet',
    useWhen: '',
    bodyChars: 4,
    bodyMd: 'body',
    options: [],
    sourceVersion: 3,
    rank: 1,
    promptPending: false,
    updatedAt: '2026-09-30T00:00:00.000Z',
    ...over,
  };
}

function summary(over: Partial<RecallMapSummaryDTO> = {}): RecallMapSummaryDTO {
  return {
    id: 'm1',
    slug: 'mantle',
    title: 'Mantle',
    enterWhen: 'working on mantle',
    nodeCount: 2,
    nodeId: 'm1',
    folder: null,
    published: true,
    version: 3,
    updatedAt: '2026-09-30T00:00:00.000Z',
    ...over,
  };
}

describe('recallV2Of', () => {
  it('is undefined until the shell answers', () => {
    expect(recallV2Of(undefined)).toBeUndefined();
  });
  it('reads an older brain (no features object) as false', () => {
    expect(recallV2Of({ onboarded: true })).toBe(false);
  });
  it('is true only for a literal true', () => {
    expect(recallV2Of({ features: { recallV2: true } })).toBe(true);
    expect(recallV2Of({ features: { recallV2: 'yes' } })).toBe(false);
  });
});

describe('isNativeMap', () => {
  it('keeps a map with its tree item and drops a page-built row a brain before R5 could list', () => {
    expect(isNativeMap({ nodeId: 'x' })).toBe(true);
    expect(isNativeMap({ nodeId: null })).toBe(false);
    expect(isNativeMap({})).toBe(false);
    expect(isNativeMap({ nodeId: '' })).toBe(false);
  });
});

describe('cardWriteBody', () => {
  it('leaves prompt out when the switch was not moved, so the brain keeps the state', () => {
    const base = editsOf(card({ kind: 'prompt', useWhen: 'deploying' }));
    const body = cardWriteBody({ ...base, bodyMd: 'new' }, base, 7);
    expect('prompt' in body).toBe(false);
    expect(body.version).toBe(7);
  });
  it('keeps an agent request alive: a pending card saved untouched sends no prompt', () => {
    const base = editsOf(card({ kind: 'knowledge', promptPending: true }));
    expect(base.prompt).toBe(false);
    const body = cardWriteBody({ ...base, title: 'Renamed' }, base, 2);
    expect('prompt' in body).toBe(false);
  });
  it('sends prompt when the owner moved the switch, either way', () => {
    const knowledge = editsOf(card());
    expect(cardWriteBody({ ...knowledge, prompt: true }, knowledge, 1).prompt).toBe(true);
    const prompt = editsOf(card({ kind: 'prompt', useWhen: 'x' }));
    expect(cardWriteBody({ ...prompt, prompt: false }, prompt, 1).prompt).toBe(false);
  });
  it('treats a switch moved and moved back as untouched', () => {
    const base = editsOf(card({ promptPending: true }));
    const body = cardWriteBody({ ...base, prompt: false }, base, 1);
    expect('prompt' in body).toBe(false);
  });
  it('never sends prompt for the entry card, which has no switch', () => {
    const base = editsOf(card({ slug: 'start', kind: 'index' }));
    expect('prompt' in cardWriteBody({ ...base, bodyMd: 'x' }, base, 1)).toBe(false);
  });
  it('sends the whole option list when it changed, without the brain-owned targetId', () => {
    const c = card({
      options: [{ label: 'Boxes', useWhen: 'which box', targetSlug: 'boxes', targetId: 'id-1' }],
    });
    const base = editsOf(c);
    const more = [...base.options, { label: 'Fleet', useWhen: 'which fleet', targetSlug: 'fleet' }];
    const body = cardWriteBody({ ...base, options: more }, base, 1);
    expect(body.options).toEqual([
      { label: 'Boxes', useWhen: 'which box', targetSlug: 'boxes' },
      { label: 'Fleet', useWhen: 'which fleet', targetSlug: 'fleet' },
    ]);
  });
  it('keeps a cross-map target', () => {
    const base = editsOf(card());
    const options = [{ label: 'DFM', useWhen: 'x', targetSlug: 'dfm', targetMap: 'dfm' }];
    expect(cardWriteBody({ ...base, options }, base, 1).options?.[0]?.targetMap).toBe('dfm');
  });
  it('leaves untouched options and use-when out, so the brain keeps them (R7)', () => {
    // A stored option to a map that has since been unpublished is only a
    // warning; SENDING it is refused (cross_map_unpublished). A body edit
    // must not send it back.
    const c = card({
      useWhen: 'checking the fleet',
      options: [
        { label: 'Old', useWhen: 'x', targetSlug: 'old', targetMap: 'old', targetId: 'id-9' },
      ],
    });
    const base = editsOf(c);
    const body = cardWriteBody({ ...base, bodyMd: 'new body' }, base, 4);
    expect(body).toEqual({ title: 'Fleet', bodyMd: 'new body', version: 4 });
  });
  it('treats trailing spaces the save trims as untouched', () => {
    const base = editsOf(
      card({ useWhen: 'x', options: [{ label: 'a', useWhen: 'b', targetSlug: 'c' }] }),
    );
    const e = {
      ...base,
      useWhen: 'x  ',
      options: [{ label: 'a ', useWhen: ' b', targetSlug: 'c' }],
    };
    const body = cardWriteBody(e, base, 1);
    expect('useWhen' in body).toBe(false);
    expect('options' in body).toBe(false);
  });
  it('sends a use-when the owner changed, and one they cleared', () => {
    const base = editsOf(card({ useWhen: 'x' }));
    expect(cardWriteBody({ ...base, useWhen: 'y' }, base, 1).useWhen).toBe('y');
    expect(cardWriteBody({ ...base, useWhen: '' }, base, 1).useWhen).toBe('');
  });
  it('sends an option list the owner emptied', () => {
    const base = editsOf(card({ options: [{ label: 'a', useWhen: 'b', targetSlug: 'c' }] }));
    expect(cardWriteBody({ ...base, options: [] }, base, 1).options).toEqual([]);
  });
  it('trims the title, use-when and option text, and never sends a slug or after', () => {
    const base = editsOf(card());
    const e = {
      ...base,
      title: '  Fleet  ',
      useWhen: ' x ',
      options: [{ label: ' a ', useWhen: ' b ', targetSlug: 'c' }],
    };
    const body = cardWriteBody(e, base, 1);
    expect(body.title).toBe('Fleet');
    expect(body.useWhen).toBe('x');
    expect(body.options).toEqual([{ label: 'a', useWhen: 'b', targetSlug: 'c' }]);
    expect('after' in body).toBe(false);
    expect('slug' in body).toBe(false);
  });
});

describe('linkFromBody', () => {
  it('sends only title, body and the options, so use-when and prompt state are kept', () => {
    const parent = card({
      kind: 'knowledge',
      promptPending: true,
      useWhen: 'asked about fleet',
      options: [{ label: 'a', useWhen: '', targetSlug: 'x', targetId: 'drop-me' }],
    });
    const body = linkFromBody(parent, { label: 'New', useWhen: '', targetSlug: 'new' }, 9);
    expect(body).toEqual({
      title: 'Fleet',
      bodyMd: 'body',
      options: [
        { label: 'a', useWhen: '', targetSlug: 'x' },
        { label: 'New', useWhen: '', targetSlug: 'new' },
      ],
      version: 9,
    });
  });
});

describe('sameEdits', () => {
  it('ignores targetId, which the brain adds', () => {
    const a = editsOf(
      card({ options: [{ label: 'a', useWhen: '', targetSlug: 'b', targetId: 'i' }] }),
    );
    const b = { ...a, options: [{ label: 'a', useWhen: '', targetSlug: 'b' }] };
    expect(sameEdits(a, b)).toBe(true);
    expect(sameEdits(a, { ...a, bodyMd: 'changed' })).toBe(false);
  });
  it('ignores trailing spaces the save trims, so a saved card is not left dirty', () => {
    const a = editsOf(card());
    expect(sameEdits(a, { ...a, title: 'Fleet ', useWhen: ' ' })).toBe(true);
    expect(normalisedEdits({ ...a, title: ' Fleet ' }).title).toBe('Fleet');
  });
});

describe('versionState', () => {
  it('is same when nothing was written', () => {
    expect(versionState(4, 4, {})).toBe('same');
  });
  it('follows a run of the tab own writes', () => {
    expect(versionState(4, 6, { 4: 5, 5: 6 })).toBe('own');
    expect(versionState(4, 5, { 4: 5, 5: 6 })).toBe('own');
  });
  it('calls anything else foreign, including an own write made from a newer version', () => {
    expect(versionState(4, 5, {})).toBe('foreign');
    // An agent wrote 5; the owner then published from 5 to 6.
    expect(versionState(4, 6, { 5: 6 })).toBe('foreign');
  });
  it('waits on a cached map older than the edit', () => {
    expect(versionState(6, 5, {})).toBe('behind');
  });
});

describe('cardProblems', () => {
  it('mirrors the refusals the brain would send', () => {
    const e = { title: ' ', bodyMd: 'x'.repeat(11), useWhen: '', prompt: true, options: [] };
    const p = cardProblems(e, 10);
    expect(p.title).toBeDefined();
    expect(p.bodyMd).toMatch(/^1 characters over the 10 budget/);
    expect(p.useWhen).toBeDefined();
  });
  it('flags an option with no label, use-when line or target', () => {
    const e = { ...editsOf(card()), options: [{ label: 'a', useWhen: '', targetSlug: '' }] };
    expect(cardProblems(e, 6000).options).toBe(
      'Option 1 needs a label, a use-when line and a target.',
    );
  });
  it('is empty for a good card', () => {
    expect(cardProblems(editsOf(card()), 6000)).toEqual({});
  });
  it('asks a card an agent wants as a prompt for a use-when line, as the brain does', () => {
    const e = editsOf(card({ promptPending: true, useWhen: '' }));
    expect(cardProblems(e, 6000, true).useWhen).toMatch(/drop the request/);
    expect(cardProblems(e, 6000, false).useWhen).toBeUndefined();
    expect(cardProblems({ ...e, useWhen: 'deploying' }, 6000, true)).toEqual({});
  });
});

describe('budgetState', () => {
  it('warns from 90% and refuses past the budget', () => {
    expect(budgetState(899, 1000)).toBe('ok');
    expect(budgetState(900, 1000)).toBe('near');
    expect(budgetState(1000, 1000)).toBe('near');
    expect(budgetState(1001, 1000)).toBe('over');
  });
});

describe('moveCard', () => {
  const nodes = [{ slug: 'start' }, { slug: 'a' }, { slug: 'b' }];
  it('swaps with the neighbour and returns the FULL order', () => {
    expect(moveCard(nodes, 'b', -1)).toEqual(['start', 'b', 'a']);
    expect(moveCard(nodes, 'a', 1)).toEqual(['start', 'b', 'a']);
  });
  it('never moves the entry card, nor anything above it', () => {
    expect(moveCard(nodes, 'start', 1)).toBeNull();
    expect(moveCard(nodes, 'a', -1)).toBeNull();
  });
  it('is null off either end or for an unknown slug', () => {
    expect(moveCard(nodes, 'b', 1)).toBeNull();
    expect(moveCard(nodes, 'zz', 1)).toBeNull();
  });
});

describe('dropCard', () => {
  const nodes = [{ slug: 'start' }, { slug: 'a' }, { slug: 'b' }, { slug: 'c' }];
  it('moves a card to where it was dropped, returning the FULL order', () => {
    expect(dropCard(nodes, 'c', 'a')).toEqual(['start', 'c', 'a', 'b']);
    expect(dropCard(nodes, 'a', 'c')).toEqual(['start', 'b', 'c', 'a']);
  });
  it('lands a card dropped on the entry card just below it', () => {
    expect(dropCard(nodes, 'c', 'start')).toEqual(['start', 'c', 'a', 'b']);
    expect(dropCard(nodes, 'a', 'start')).toBeNull();
  });
  it('never moves the entry card, and a drop in place is a no-op', () => {
    expect(dropCard(nodes, 'start', 'b')).toBeNull();
    expect(dropCard(nodes, 'b', 'b')).toBeNull();
    expect(dropCard(nodes, 'zz', 'b')).toBeNull();
  });
});

describe('write errors', () => {
  const stale = new ApiError('changed', 409, { error: 'changed', code: 'version_stale' });
  it('recognises a stale version by its code', () => {
    expect(isStale(stale)).toBe(true);
    expect(isStale(new ApiError('x', 400, { error: 'x', code: 'body_too_long' }))).toBe(false);
    expect(isStale(new Error('x'))).toBe(false);
  });
  it('passes the brain teaching error through as written', () => {
    const e = new ApiError('fallback', 400, { error: 'Split it.', code: 'body_too_long' });
    expect(writeErrorText(e, 'Save failed.')).toBe('Split it.');
  });
  it('words a stale version as the editor sees it', () => {
    expect(writeErrorText(stale, 'Save failed.')).toMatch(/changed since you opened it/);
  });
  it('falls back for something that is not an error', () => {
    expect(writeErrorText('nope', 'Save failed.')).toBe('Save failed.');
  });
});

describe('restore guards', () => {
  it('blocks only a map create, which has nothing before it', () => {
    expect(restoreBlockedReason({ summary: 'map created' })).not.toBeNull();
    for (const s of [
      'cards reordered',
      'card added',
      'card edited',
      'card deleted',
      'prompt confirmed',
      'prompt request dropped',
      'renamed, slug changed',
    ]) {
      expect(restoreBlockedReason({ summary: s })).toBeNull();
    }
  });
});

describe('restoreCopy', () => {
  it('says a card add is undone by deleting the card', () => {
    expect(restoreCopy({ summary: 'card added', cardSlug: 'fleet' })).toMatch(
      /^Deletes the card fleet again\./,
    );
  });
  it('says a delete comes back with its old slug, place and inbound options', () => {
    const t = restoreCopy({ summary: 'card deleted', cardSlug: 'fleet' });
    expect(t).toMatch(/old link name/);
    expect(t).toMatch(/options other cards had to it/);
  });
  it('keeps a prompt restore to the prompt state', () => {
    expect(restoreCopy({ summary: 'prompt confirmed', cardSlug: 'x' })).toMatch(
      /only whether the card x is a prompt/,
    );
  });
  it('covers reorders, publish flips and other map changes', () => {
    expect(restoreCopy({ summary: 'cards reordered', cardSlug: null })).toMatch(/order/);
    expect(restoreCopy({ summary: 'published', cardSlug: null })).toMatch(/^Unpublishes/);
    expect(restoreCopy({ summary: 'renamed, slug changed', cardSlug: null })).toMatch(
      /map settings/,
    );
  });
  it('never uses a dash as a sentence break', () => {
    for (const summary of ['card added', 'card edited', 'card deleted', 'cards reordered', 'x']) {
      expect(restoreCopy({ summary, cardSlug: 'a' })).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe('actorLabel', () => {
  it('names the agent, an MCP client and the admin, and falls back on old rows', () => {
    expect(actorLabel({ actorKind: 'agent', actorName: 'rea' })).toBe('Agent rea');
    expect(actorLabel({ actorKind: 'agent', actorName: 'mcp' })).toBe('An MCP client');
    expect(actorLabel({ actorKind: 'agent', actorName: null })).toBe('An agent');
    expect(actorLabel({ actorKind: 'owner', actorName: 'Jason' })).toBe('Jason');
    expect(actorLabel({ actorKind: 'owner', actorName: null })).toBe('Owner');
  });
});

describe('droppedText', () => {
  it('names each removed option by its label and card', () => {
    expect(droppedText([])).toBe('');
    expect(droppedText([{ cardSlug: 'start', label: 'Fleet' }])).toBe(
      'Removed the option to it: "Fleet" on start.',
    );
    expect(
      droppedText([
        { cardSlug: 'start', label: 'Fleet' },
        { cardSlug: 'boxes', label: 'Back' },
      ]),
    ).toBe('Removed the options to it: "Fleet" on start, "Back" on boxes.');
  });
});

describe('fetchAllMaps', () => {
  const many = Array.from({ length: 45 }, (_, i) => summary({ id: `m${i}`, slug: `m${i}` }));
  it('reads every page of the catalog', async () => {
    const pages: number[] = [];
    const out = await fetchAllMaps(async (p) => {
      pages.push(p);
      return { maps: many.slice((p - 1) * 20, p * 20), total: 45, page: p, pageSize: 20 };
    });
    expect(pages).toEqual([1, 2, 3]);
    expect(out).toHaveLength(45);
  });
  it('stops at an empty page and at the page cap', async () => {
    const out = await fetchAllMaps(
      async (p) => ({ maps: p === 1 ? many.slice(0, 20) : [], total: 999, pageSize: 20 }),
      10,
    );
    expect(out).toHaveLength(20);
    let calls = 0;
    await fetchAllMaps(async () => {
      calls++;
      return { maps: many.slice(0, 20), total: 10_000, pageSize: 20 };
    }, 3);
    expect(calls).toBe(3);
  });
});

describe('optionTargets', () => {
  const map = {
    slug: 'mantle',
    nodes: [
      { slug: 'start', title: 'Mantle' },
      { slug: 'fleet', title: 'Fleet' },
    ],
  };
  it('offers every other card, and the entry of other published native maps', () => {
    const maps = [
      summary(),
      summary({ id: 'd', slug: 'dfm', title: 'DFM' }),
      summary({ id: 'u', slug: 'draft', title: 'Draft', published: false }),
      // A page-built row, as a brain from before mantle R5 could still list.
      summary({ id: 'v', slug: 'old', title: 'Old', nodeId: null as unknown as string }),
    ];
    const t = optionTargets(map, 'fleet', maps);
    expect(t.map((x) => x.value)).toEqual(['card:start', 'map:dfm']);
    expect(t[1]).toMatchObject({ targetSlug: 'dfm', targetMap: 'dfm' });
  });
  it('round-trips an option to its select value', () => {
    expect(optionTargetValue({ targetSlug: 'fleet' })).toBe('card:fleet');
    expect(optionTargetValue({ targetSlug: 'dfm', targetMap: 'dfm' })).toBe('map:dfm');
  });
});

describe('cardProblems: the brain caps (brain v0.232.358)', () => {
  const base = {
    title: 'Card',
    bodyMd: '',
    useWhen: '',
    prompt: false,
    options: [] as { label: string; useWhen: string; targetSlug: string }[],
  };

  it('asks for a use-when line on every option', () => {
    const got = cardProblems(
      { ...base, options: [{ label: 'Go', useWhen: ' ', targetSlug: 'two' }] },
      6000,
    );
    expect(got.options).toMatch(/use-when/);
  });

  it('refuses more options than the brain allows', () => {
    const options = Array.from({ length: RECALL_OPTIONS_MAX + 1 }, (_, i) => ({
      label: `Go ${i}`,
      useWhen: 'x',
      targetSlug: 'two',
    }));
    expect(cardProblems({ ...base, options }, 6000).options).toMatch(/at most/);
  });
});

describe('the N8 revisions and the owner over MCP (brain v0.232.359)', () => {
  it('says what restoring an agent edit of a confirmed prompt does', () => {
    expect(
      restoreCopy({ summary: 'prompt edited by agent, awaits confirm', cardSlug: 'deploy' }),
    ).toMatch(/as a confirmed prompt again/);
    expect(restoreCopy({ summary: 'prompt demoted', cardSlug: 'deploy' })).toMatch(/only whether/);
  });

  it('names the owner acting through an MCP client', () => {
    expect(actorLabel({ actorKind: 'owner', actorName: 'mcp' })).toBe('Owner, via MCP');
    expect(actorLabel({ actorKind: 'agent', actorName: 'mcp' })).toBe('An MCP client');
  });
});

describe('the trail (cardTrail, unreachableSlugs, incomingOptions)', () => {
  const opt = (targetSlug: string, label = targetSlug, targetMap?: string) => ({
    label,
    useWhen: '',
    targetSlug,
    ...(targetMap ? { targetMap } : {}),
  });
  const node = (slug: string, options: ReturnType<typeof opt>[] = [], kind = 'knowledge') => ({
    slug,
    title: slug.toUpperCase(),
    kind: kind as 'knowledge' | 'prompt' | 'index',
    promptPending: false,
    options,
  });
  const nodes = [
    node('start', [opt('a'), opt('b'), opt('other', 'x', 'fleet')]),
    node('a', [opt('c')]),
    node('b', [opt('c', 'via b')]),
    node('c', [opt('start')]),
    node('lost', [opt('a')]),
    node('matched', [], 'prompt'),
  ];

  it('walks the shortest route from the entry card, entry first', () => {
    expect(cardTrail(nodes, 'c')?.map((n) => n.slug)).toEqual(['start', 'a', 'c']);
    expect(cardTrail(nodes, 'start')?.map((n) => n.slug)).toEqual(['start']);
  });

  it('has no trail to a card nothing leads to, and ignores cross-map options', () => {
    expect(cardTrail(nodes, 'lost')).toBeNull();
    expect(cardTrail(nodes, 'other')).toBeNull();
    expect(unreachableSlugs(nodes)).toEqual(new Set(['lost', 'matched']));
  });

  it('lists the options on other cards that lead to a card', () => {
    expect(incomingOptions(nodes, 'c').map((i) => [i.from.slug, i.option.label])).toEqual([
      ['a', 'c'],
      ['b', 'via b'],
    ]);
    expect(incomingOptions(nodes, 'a').map((i) => i.from.slug)).toEqual(['start', 'lost']);
  });

  it('flags a knowledge card no walk reaches, never a prompt', () => {
    const away = unreachableSlugs(nodes);
    expect(cardAttention(nodes[4]!, away)).toMatch(/no agent will reach it/);
    expect(cardAttention(nodes[5]!, away)).toBeNull();
    expect(cardAttention(node('start'), new Set())).toMatch(/entry card has no options/);
    expect(cardAttention({ ...nodes[1]!, promptPending: true }, away)).toMatch(/asked/);
  });

  it('names the kind: entry first, then a pending request over the stored kind', () => {
    expect(cardKindOf({ slug: 'start', kind: 'index', promptPending: false })).toBe('entry');
    expect(cardKindOf({ slug: 'a', kind: 'knowledge', promptPending: true })).toBe('requested');
    expect(cardKindOf({ slug: 'a', kind: 'prompt', promptPending: false })).toBe('prompt');
    expect(cardKindOf({ slug: 'a', kind: 'knowledge', promptPending: false })).toBe('knowledge');
  });
});
