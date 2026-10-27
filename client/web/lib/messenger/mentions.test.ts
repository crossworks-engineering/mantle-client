/**
 * Mentions: the "@" being typed, the pick, what a send carries, and the
 * runs drawn in a bubble.
 */
import { describe, expect, it } from 'vitest';
import {
  applyMention,
  mentionAt,
  mentionCandidates,
  mentionsInBody,
  splitMentions,
} from './mentions';

describe('mentionAt', () => {
  it('finds the "@" being typed at the start or after a space', () => {
    expect(mentionAt('@an', 3)).toEqual({ start: 0, query: 'an' });
    expect(mentionAt('hi @Ann L', 9)).toEqual({ start: 3, query: 'Ann L' });
    expect(mentionAt('hi @', 4)).toEqual({ start: 3, query: '' });
  });

  it('ignores an email address, a finished line and prose', () => {
    expect(mentionAt('mail ann@x.io', 13)).toBeNull();
    expect(mentionAt('@ann\nmore', 9)).toBeNull();
    expect(mentionAt('@ann says hello there', 21)).toBeNull();
    expect(mentionAt('no mention', 10)).toBeNull();
  });
});

describe('applyMention', () => {
  it('writes the name over the query and moves the caret past it', () => {
    expect(applyMention('hi @an!', 3, 6, 'Ann Lee')).toEqual({ text: 'hi @Ann Lee !', caret: 12 });
  });
});

describe('mentionCandidates', () => {
  const people = [{ name: 'Ann Lee' }, { name: 'Ben Ng' }, { name: 'Lena Fox' }];
  it('matches the start of the name or of any word in it', () => {
    expect(mentionCandidates(people, '')).toHaveLength(3);
    expect(mentionCandidates(people, 'le').map((p) => p.name)).toEqual(['Ann Lee', 'Lena Fox']);
    expect(mentionCandidates(people, 'BEN').map((p) => p.name)).toEqual(['Ben Ng']);
    expect(mentionCandidates(people, 'zz')).toEqual([]);
  });
});

describe('mentionsInBody', () => {
  it('keeps the picks still written in the body, once each', () => {
    const picked = [
      { kind: 'login' as const, id: 'a', name: 'Ann Lee' },
      { kind: 'login' as const, id: 'b', name: 'Ben Ng' },
      { kind: 'login' as const, id: 'a', name: 'Ann Lee' },
    ];
    expect(mentionsInBody('@Ann Lee look', picked)).toEqual([{ kind: 'login', id: 'a' }]);
    expect(mentionsInBody('nobody', picked)).toEqual([]);
  });
});

describe('splitMentions', () => {
  it('marks the mentioned names, longest first', () => {
    expect(splitMentions('hi @Ann Lee and @Ann!', ['Ann', 'Ann Lee'])).toEqual([
      { text: 'hi ', mention: false },
      { text: '@Ann Lee', mention: true },
      { text: ' and ', mention: false },
      { text: '@Ann', mention: true },
      { text: '!', mention: false },
    ]);
    expect(splitMentions('mail a@b', ['b'])).toEqual([
      { text: 'mail a', mention: false },
      { text: '@b', mention: true },
    ]);
    expect(splitMentions('plain', [])).toEqual([{ text: 'plain', mention: false }]);
  });
});
