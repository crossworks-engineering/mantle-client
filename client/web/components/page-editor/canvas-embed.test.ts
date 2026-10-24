/**
 * A Present canvas embedded in a page (`![Title](present:<id>)`, an image
 * node with `presentId`): the schema draws it as a figure around its
 * snapshot with a caption bar and reads that figure back as the same node;
 * the state the brain's answer gives; the slash item. Pure (no DOM).
 */
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { TagParseRule } from '@tiptap/pm/model';
import { PageImage } from './image';
import { canvasEmbedState } from './canvas-embed';
import { getSlashItems } from './slash-menu';

const ID = '3f1c2b4a-0000-4000-8000-000000000001';
const schema = getSchema([StarterKit, PageImage]);
const image = schema.nodes.image!;
/** The DOM output spec the schema's renderHTML gives for `attrs`. */
const spec = (attrs: Record<string, unknown>) =>
  JSON.stringify(image.spec.toDOM!(image.create({ src: null, ...attrs })));

describe('a canvas embed in the page schema', () => {
  it('draws a figure: the snapshot from the poster route, and the bar that opens it', () => {
    const out = JSON.parse(spec({ alt: 'Pump deck', presentId: ID })) as [
      string,
      Record<string, string>,
      [string, Record<string, string>],
      [string, Record<string, string>],
    ];
    expect(out[0]).toBe('figure');
    expect(out[1]).toMatchObject({
      'data-present-id': ID,
      'data-canvas-state': 'loading',
      'data-no-lightbox': '',
    });
    expect(out[1]!.class).toContain('canvas-embed');
    expect(out[2]![0]).toBe('img');
    expect(out[2]![1]).toMatchObject({
      src: `/api/presents/${ID}/poster`,
      'data-asset-path': `/api/presents/${ID}/poster`,
      alt: 'Pump deck',
    });
    expect(out[3]![0]).toBe('figcaption');
    expect(out[3]![1]).toHaveProperty('data-canvas-open');
  });

  it('reads its figure back as the same node, before the plain img rule', () => {
    const rules = (image.spec.parseDOM ?? []) as TagParseRule[];
    expect(rules[0]!.tag).toBe('figure[data-present-id]');
    const el = {
      getAttribute: (k: string) => (k === 'data-present-id' ? ID : null),
      querySelector: () => ({ getAttribute: (k: string) => (k === 'alt' ? 'Pump deck' : null) }),
    } as unknown as HTMLElement;
    expect(rules[0]!.getAttrs!(el)).toEqual({ presentId: ID, alt: 'Pump deck', src: null });
  });

  it('leaves a drawing and an uploaded image as they were', () => {
    expect(spec({ alt: 'd', drawId: ID })).not.toContain('figure');
    expect(spec({ alt: 'd', drawId: ID })).toContain(`/api/draws/${ID}/svg?raw=1`);
    expect(spec({ alt: 'f', nodeId: ID })).toContain(`/api/files/files/${ID}?raw=1`);
  });
});

describe('the state of a canvas embed', () => {
  it("follows the brain's answer for this reader", () => {
    expect(canvasEmbedState(null)).toBe('hidden');
    expect(canvasEmbedState({ title: 'T', rev: 3, posterRev: null, current: false })).toBe('none');
    expect(canvasEmbedState({ title: 'T', rev: 3, posterRev: 2, current: false })).toBe('stale');
    expect(canvasEmbedState({ title: 'T', rev: 3, posterRev: 3, current: true })).toBe('live');
  });
});

describe('the Canvas slash item', () => {
  it('sits with the media items and is found by its words', () => {
    const item = getSlashItems('').find((i) => i.id === 'canvas');
    expect(item?.group).toBe('Media');
    expect(getSlashItems('deck').some((i) => i.id === 'canvas')).toBe(true);
  });
});
