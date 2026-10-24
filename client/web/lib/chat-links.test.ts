import { describe, expect, it } from 'vitest';
import {
  chatImageAllowed,
  chatLinkAction,
  decodeHtmlEntities,
  isSafeChatHref,
  sanitizeChatDoc,
  type ChatDocNode,
} from './chat-links';

const ORIGIN = 'https://brain.example.test';

describe('what a chat reply may link to', () => {
  it('http(s), mailto and relative links', () => {
    for (const href of [
      'https://example.test/a',
      'http://example.test',
      'mailto:someone@example.test',
      '/n/abc',
      'n/abc',
      '#top',
      '?q=1',
      'HTTPS://EXAMPLE.TEST',
    ]) {
      expect(isSafeChatHref(href)).toBe(true);
    }
  });

  it('no other scheme, however it is spelled', () => {
    for (const href of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,<b>x</b>',
      'vbscript:x',
      'file:///etc/passwd',
      'media:f-1',
      'page:p-1',
      '',
      null,
      undefined,
    ]) {
      expect(isSafeChatHref(href)).toBe(false);
    }
  });

  it('a click: this origin routes, another opens a tab, mailto is the browser’s', () => {
    expect(chatLinkAction('/n/abc?x=1#h', ORIGIN)).toEqual({ kind: 'route', path: '/n/abc?x=1#h' });
    expect(chatLinkAction(`${ORIGIN}/pages/1`, ORIGIN)).toEqual({
      kind: 'route',
      path: '/pages/1',
    });
    expect(chatLinkAction('https://other.example.test/a', ORIGIN)).toEqual({
      kind: 'open',
      href: 'https://other.example.test/a',
    });
    expect(chatLinkAction('//other.example.test/a', ORIGIN)).toEqual({
      kind: 'open',
      href: 'https://other.example.test/a',
    });
    expect(chatLinkAction('mailto:a@example.test', ORIGIN)).toEqual({ kind: 'default' });
  });

  it('a click on any other scheme does nothing', () => {
    expect(chatLinkAction('javascript:alert(1)', ORIGIN)).toEqual({ kind: 'block' });
    expect(chatLinkAction('data:text/html,x', ORIGIN)).toEqual({ kind: 'block' });
    expect(chatLinkAction('media:f-1', ORIGIN)).toEqual({ kind: 'block' });
  });
});

describe('which pictures of a reply show', () => {
  it('an Admin user: any picture', () => {
    expect(chatImageAllowed('https://cdn.example.test/a.png', true)).toBe(true);
    expect(chatImageAllowed('/api/files/files/f-1?raw=1', true)).toBe(true);
    expect(chatImageAllowed('data:image/png;base64,AAAA', true)).toBe(true);
  });

  it('anyone else: same-origin pictures, the owner byte routes in their exact shape only', () => {
    expect(chatImageAllowed('/brand/logo.png', false)).toBe(true);
    expect(chatImageAllowed('https://cdn.example.test/a.png', false)).toBe(false);
    expect(chatImageAllowed('http://cdn.example.test/a.png', false)).toBe(false);
    expect(chatImageAllowed('//cdn.example.test/a.png', false)).toBe(false);
    expect(chatImageAllowed('/\\cdn.example.test/a.png', false)).toBe(false);
    expect(chatImageAllowed('data:image/png;base64,AAAA', false)).toBe(false);
    // An id that is not one, or any other shape of the owner byte routes.
    expect(chatImageAllowed('/api/files/files/f-1?raw=1', false)).toBe(false);
    expect(chatImageAllowed('/api/draws/d-1/svg?raw=1', false)).toBe(false);
    expect(chatImageAllowed('/somewhere/x?raw', false)).toBe(false);
    expect(chatImageAllowed('', false)).toBe(false);
  });

  // W7e: the brain serves every login a file's bytes and a drawing's SVG on
  // the owner routes, in its own scope (unreadable: 404).
  const FILE = '0b6f2a52-3c1d-4e5f-8a9b-0c1d2e3f4a5b';
  const DRAW = '7d1e2f30-4a5b-4c6d-9e7f-8091a2b3c4d5';

  it('anyone else: a file or a drawing on the owner byte routes, in the one shape', () => {
    expect(chatImageAllowed(`/api/files/files/${FILE}?raw=1`, false)).toBe(true);
    expect(chatImageAllowed(`/api/files/files/${FILE}?thumb=1`, false)).toBe(true);
    expect(chatImageAllowed(`/api/draws/${DRAW}/svg?raw=1`, false)).toBe(true);
    expect(chatImageAllowed(`/api/presents/${DRAW}/poster`, false)).toBe(true);
    // A canvas's poster in one shape only: no other route of a canvas.
    expect(chatImageAllowed(`/api/presents/${DRAW}/frame`, false)).toBe(false);
    expect(chatImageAllowed(`/api/presents/${DRAW}/poster?meta=1`, false)).toBe(false);
    expect(chatImageAllowed(`/api/files/files/${FILE.toUpperCase()}?raw=1`, false)).toBe(true);
    // An entity before the query is refused, even one that spells the shape.
    expect(chatImageAllowed(`&#47;api/files/files/${FILE}?raw=1`, false)).toBe(false);
  });

  it('anyone else: every other spelling of the owner byte routes is refused', () => {
    for (const src of [
      `/api/files/files/${FILE}`,
      `/api/files/files/${FILE}?raw=1&x=2`,
      `/api/files/files/${FILE}?raw=0`,
      `/api/files/files/${FILE}?raw`,
      `/api/files/files/${FILE}?download=1`,
      `/api/files/files/${FILE}/x?raw=1`,
      `/api/files/files/${FILE}?raw=1#x`,
      `/api//files/files/${FILE}?raw=1`,
      `/api/files/../files/files/${FILE}?raw=1`,
      `/api/%66iles/files/${FILE}?raw=1`,
      `/api/files/files/${FILE}%3Fraw=1`,
      `/x/../api/files/files/${FILE}?raw=1`,
      `/api/draws/${DRAW}/svg`,
      `/api/draws/${DRAW}/svg?raw=1&y=1`,
      `/api/draws/${DRAW}?raw=1`,
      `/api/draws/${DRAW}/svg?thumb=1`,
      `/api/files/files/${FILE}?raw=1/../../x`,
      // Never another origin, whatever the path.
      `https://evil.example.test/api/files/files/${FILE}?raw=1`,
      `//evil.example.test/api/files/files/${FILE}?raw=1`,
      `&#47;&#47;evil.example.test/api/files/files/${FILE}?raw=1`,
      `/\\evil.example.test/api/files/files/${FILE}?raw=1`,
      `data:image/svg+xml,<svg/>`,
      // An entity before the query is refused outright.
      `/api/files/files/${FILE}&#63;raw=1`,
      `/api&#47;files/files/${FILE}?raw=1`,
    ]) {
      expect(chatImageAllowed(src, false), src).toBe(false);
    }
  });

  it('anyone else: the path and query are matched case sensitively, the id in either case', () => {
    for (const src of [
      `/API/FILES/FILES/${FILE}?raw=1`,
      `/api/Files/files/${FILE}?raw=1`,
      `/api/files/files/${FILE}?RAW=1`,
      `/API/DRAWS/${DRAW}/SVG?raw=1`,
      `/api/draws/${DRAW}/svg?Raw=1`,
    ]) {
      expect(chatImageAllowed(src, false), src).toBe(false);
    }
    expect(chatImageAllowed(`/api/draws/${DRAW.toUpperCase()}/svg?raw=1`, false)).toBe(true);
  });

  it('anyone else: a control character or a space inside the path is refused', () => {
    for (const src of [
      `/api/fi\tles/files/${FILE}?raw=1`,
      `/api/files/fi\nles/${FILE}?raw=1`,
      `/api/files/files/${FILE.slice(0, 8)}\u0000${FILE.slice(8)}?raw=1`,
      `/api/draws/${DRAW}/s\u007fvg?raw=1`,
      `/api/files/files/ ${FILE}?raw=1`,
      `/api/files/files/${FILE}?raw=1\r`,
      `/api/files/files/${FILE}&#9;?raw=1`,
    ]) {
      expect(chatImageAllowed(src, false), JSON.stringify(src)).toBe(false);
    }
  });
});

describe('entities and escapes cannot hide a URL (W7f fix round 2)', () => {
  it('decodes numeric and named references the way an attribute does', () => {
    expect(decodeHtmlEntities('&#104;ttps://x')).toBe('https://x');
    expect(decodeHtmlEntities('&#x68;ttps://x')).toBe('https://x');
    expect(decodeHtmlEntities('&#106avascript:x')).toBe('javascript:x');
    expect(decodeHtmlEntities('&#47;&#47;evil.example.test')).toBe('//evil.example.test');
    expect(decodeHtmlEntities('javascript&colon;x')).toBe('javascript:x');
    expect(decodeHtmlEntities('&sol;&sol;host')).toBe('//host');
    expect(decodeHtmlEntities('&amp;#106;avascript:x')).toBe('javascript:x');
    expect(decodeHtmlEntities('a &unknown; b')).toBe('a &unknown; b');
  });

  it('an entity-spelled scheme is still that scheme', () => {
    for (const href of [
      '&#106;avascript:alert(1)',
      '&#x6A;avascript:alert(1)',
      '&#106avascript:alert(1)',
      'javascript&colon;alert(1)',
      'java&Tab;script:alert(1)',
      '&#100;ata:text/html,x',
    ]) {
      expect(isSafeChatHref(href)).toBe(false);
      expect(chatLinkAction(href, ORIGIN)).toEqual({ kind: 'block' });
    }
  });

  it('an entity-spelled other origin is not a picture for anyone but an Admin user', () => {
    for (const src of [
      '&#104;ttps://evil.example.test/p.png?d=SECRET',
      '&#47;&#47;evil.example.test/x.png',
      '&sol;&sol;evil.example.test/x.png',
      '&#x2F;&#x2F;evil.example.test/x.png',
      '/&#92;evil.example.test/x.png',
      '/brand/a&amp;b.png',
    ]) {
      expect(chatImageAllowed(src, false)).toBe(false);
    }
    expect(chatImageAllowed('&#104;ttps://evil.example.test/p.png', true)).toBe(true);
    // An `&` in the query is ordinary.
    expect(chatImageAllowed('/brand/logo.png?w=1&h=2', false)).toBe(true);
  });

  it('the owner byte routes are read the way the server routes them', () => {
    for (const src of [
      '/a/../api/files/x',
      '/a/%2e%2e/api/files/x',
      '/api/%66iles/x',
      '/api/%2566iles/x',
      '/%61pi/draws/d-1/svg',
      '/api/files',
      '/API/Files/x',
      '/api//files/x/..',
      '/brand/logo.png?%72aw=1',
    ]) {
      expect(chatImageAllowed(src, false)).toBe(false);
    }
    expect(chatImageAllowed('/api/filesx/y.png', false)).toBe(true);
    expect(chatImageAllowed('/brand/a%20b.png', false)).toBe(true);
  });
});

const FILE_ID = '0b6f2a52-3c1d-4e5f-8a9b-0c1d2e3f4a5b';
const DRAW_ID = '7d1e2f30-4a5b-4c6d-9e7f-8091a2b3c4d5';

describe('the last pass over the parsed document', () => {
  const doc = (content: ChatDocNode[]): ChatDocNode => ({ type: 'doc', content });
  const linked = (href: string): ChatDocNode => ({
    type: 'paragraph',
    content: [{ type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href } }] }],
  });

  it('drops a link whose decoded href is another scheme, keeping its text', () => {
    // What the DOM hands back for `[a](&#106;avascript:alert(1))`.
    const out = sanitizeChatDoc(doc([linked('javascript:alert(1)')]), true);
    expect(out.content![0]!.content![0]).toEqual({ type: 'text', text: 'a', marks: [] });
    const kept = sanitizeChatDoc(doc([linked('https://example.test/a')]), false);
    expect(kept.content![0]!.content![0]!.marks).toEqual([
      { type: 'link', attrs: { href: 'https://example.test/a' } },
    ]);
  });

  it('turns a picture this login may not load into its alt text', () => {
    const image = (attrs: Record<string, unknown>): ChatDocNode => ({ type: 'image', attrs });
    const input = doc([
      // What the DOM hands back for the two entity probes.
      image({ src: 'https://evil.example.test/p.png?d=SECRET', alt: 'i' }),
      image({ src: '//evil.example.test/x.png', alt: '' }),
      image({ src: '/brand/logo.png', nodeId: 'f-1', alt: 'file' }),
      image({ src: '/brand/logo.png', drawId: 'd-1', alt: 'drawing' }),
      image({ src: '/brand/logo.png', alt: 'logo' }),
      // W7e: a real file or drawing id renders from its owner byte route.
      image({ src: 'https://evil.example.test/x.png', nodeId: FILE_ID, alt: 'f' }),
      image({ src: '/brand/logo.png', drawId: DRAW_ID, alt: 'd' }),
      // The drawing wins (it is what renders): a bad drawing id is refused
      // even beside a good file id.
      image({ nodeId: FILE_ID, drawId: '../x', alt: 'both' }),
      image({ nodeId: `${FILE_ID}?x=1`, alt: 'spliced' }),
    ]);
    const out = sanitizeChatDoc(input, false);
    expect(out.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'i' }] },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'file' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'drawing' }] },
      { type: 'image', attrs: { src: '/brand/logo.png', alt: 'logo' } },
      input.content![5],
      input.content![6],
      { type: 'paragraph', content: [{ type: 'text', text: 'both' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'spliced' }] },
    ]);
    // An Admin user keeps every picture.
    expect(sanitizeChatDoc(input, true).content).toEqual(input.content);
  });

  it('reaches into nested blocks', () => {
    const nested = doc([
      {
        type: 'callout',
        content: [
          linked('data:text/html,x'),
          { type: 'image', attrs: { src: 'https://evil.example.test/x.png' } },
        ],
      },
    ]);
    const out = sanitizeChatDoc(nested, false);
    const callout = out.content![0]!;
    expect(callout.content![0]!.content![0]!.marks).toEqual([]);
    expect(callout.content![1]).toEqual({ type: 'paragraph' });
  });
});
