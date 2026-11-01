import { describe, expect, it } from 'vitest';
import {
  appearanceFontAttrs,
  appearanceFontVars,
  resolveAppearanceAttrs,
  type BrainAppearance,
} from '@mantle/web-ui/appearance';
import { COLOR_THEMES } from '@mantle/share-ui/lib/themes';
import { applyAppearance, brandDocumentTitle, guardLoad } from './boot-apply';

/** Just enough of <html> for applyAppearance: attributes and style props. */
function fakeDoc(initial: Record<string, string> = {}) {
  const attrs = new Map(Object.entries(initial));
  const style = new Map<string, string>();
  const html = {
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    style: { setProperty: (k: string, v: string) => void style.set(k, v) },
  };
  return { doc: { documentElement: html } as unknown as Document, attrs, style };
}

describe('applyAppearance', () => {
  it('writes what the server layout used to render onto <html>', () => {
    const theme = COLOR_THEMES[COLOR_THEMES.length - 1]!.id;
    const appearance = {
      colorTheme: theme,
      avatarStyle: 'glyphs',
      avatarTint: 'theme',
      fontUi: 'not-a-real-font-key',
    } as BrainAppearance;
    const { doc, attrs, style } = fakeDoc();
    applyAppearance(doc, appearance);

    const expected = resolveAppearanceAttrs(appearance);
    expect(attrs.get('data-color-theme')).toBe(expected.colorTheme);
    for (const [k, v] of Object.entries(appearanceFontAttrs(expected)))
      expect(attrs.get(k)).toBe(v);
    expect(attrs.get('data-avatar-style')).toBe(expected.avatarStyle);
    expect(attrs.get('data-avatar-tint')).toBe(expected.avatarTint);
    for (const [k, v] of Object.entries(appearanceFontVars(expected))) expect(style.get(k)).toBe(v);
  });

  it('with no appearance leaves the fresh-install default the static page has', () => {
    const { doc, attrs } = fakeDoc();
    applyAppearance(doc, null);
    expect(attrs.get('data-color-theme')).toBe(resolveAppearanceAttrs(null).colorTheme);
  });
});

describe('brandDocumentTitle', () => {
  it('swaps the fallback name for the brain name', () => {
    expect(brandDocumentTitle('Notes · MantleOS', 'Acme')).toBe('Notes · Acme');
    expect(brandDocumentTitle('MantleOS', 'Acme')).toBe('Acme');
  });

  it('leaves a title alone that is already branded or has no fallback', () => {
    expect(brandDocumentTitle('Notes · Acme', 'Acme')).toBe('Notes · Acme');
    expect(brandDocumentTitle('Something else', 'Acme')).toBe('Something else');
    expect(brandDocumentTitle('Notes · MantleOS', 'MantleOS')).toBe('Notes · MantleOS');
  });
});

describe('guardLoad', () => {
  function fakeLocation(pathname: string, search = '') {
    const replaced: string[] = [];
    const loc = { pathname, search, replace: (to: string) => void replaced.push(to) };
    return { loc: loc as unknown as Location, replaced };
  }

  it('sends a load with no session to /login and says so', () => {
    const { loc, replaced } = fakeLocation('/notes/abc', '?x=1');
    expect(guardLoad(loc, '')).toBe(true);
    expect(replaced).toEqual([`/login?next=${encodeURIComponent('/notes/abc?x=1')}`]);
  });

  it('lets a signed-in load stay', () => {
    const { loc, replaced } = fakeLocation('/notes/abc');
    expect(guardLoad(loc, 'mantle_authed=1')).toBe(false);
    expect(replaced).toEqual([]);
  });
});
