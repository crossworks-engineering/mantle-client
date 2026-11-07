import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A picked card or option (a list row, a theme or avatar card, an email row,
 * a picked tree row) wears the theme's `selected` surface (`bg-selected`),
 * which the theme generator solves so the card's ordinary text keeps 4.5:1 on
 * it in every theme and mode. A raw accent or primary tint under that text
 * does not: half a light accent in Starry Night dark put the muted preview of
 * the selected chat at 1.4:1. So no selected, checked or active state may
 * tint with `bg-accent/NN` or `bg-primary/NN`; a full `bg-accent` fill pairs
 * with `text-accent-foreground` and is not this rule's business.
 */
const web = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const kit = join(web, '..', '..', 'packages', 'web-ui', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const TINTED_PICK = /(selected=true|state=checked|active=true)\]:bg-(accent|primary)\/\d+/;

describe('the selected surface', () => {
  it('no selected, checked or active state tints with a raw accent or primary', () => {
    const offenders = [web, kit]
      .flatMap((root) => sources(root).map((path) => [root, path] as const))
      .filter(([, path]) => !path.includes(`${sep}e2e${sep}`))
      .filter(([, path]) => TINTED_PICK.test(readFileSync(path, 'utf8')))
      .map(([root, path]) => relative(root, path).split(sep).join('/'));
    expect(offenders, 'use bg-selected as ListCard does').toEqual([]);
  });

  it('the list card, the email row and a picked tree row wear it', () => {
    const read = (...p: string[]) => readFileSync(join(...p), 'utf8');
    expect(read(kit, 'ui', 'list-card.tsx')).toContain('data-[selected=true]:bg-selected');
    expect(read(web, 'components', 'email-row.tsx')).toContain("props.selected ? 'bg-selected'");
    expect(read(web, 'components', 'item-tree', 'tree-rows.tsx')).toContain(
      "? 'bg-selected text-foreground ring-1 ring-inset ring-primary/30'",
    );
  });
});

// ── Contrast, from the shipped theme tokens ──────────────────────────────

type Rgb = [number, number, number];
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const hex = (h: string): Rgb => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as Rgb;
};
function toOklab(c: Rgb): Rgb {
  const [r, g, b] = c.map(toLin) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => Math.min(1, Math.max(0, toGam(c)))) as Rgb;
}
const oklch = (L: number, C: number, H: number) =>
  fromOklab([L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)]);
/** `color-mix(in oklab, a p, b)`. */
const mix = (a: Rgb, b: Rgb, p: number) => {
  const [x, y] = [toOklab(a), toOklab(b)];
  return fromOklab(x.map((v, i) => v * p + y[i]! * (1 - p)) as Rgb);
};
/** A colour at `alpha` painted over `bg`. */
const over = (c: Rgb, alpha: number, bg: Rgb) =>
  c.map((v, i) => v * alpha + bg[i]! * (1 - alpha)) as Rgb;
const lum = (c: Rgb) => {
  const [r, g, b] = c.map(toLin) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** Every theme and mode the contract package ships, as token maps. */
function themes(): [string, Record<string, string>][] {
  const css = readFileSync(
    join(web, 'node_modules', '@mantle', 'share-ui', 'styles', 'themes.css'),
    'utf8',
  );
  return [...css.matchAll(/^([^\n{]+)\{([^}]*)\}/gm)].flatMap(([, sel, body]) => {
    const vars = Object.fromEntries(
      [...body!.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1]!, m[2]!]),
    );
    if (!vars.foreground || !vars.selected) return [];
    const name = sel!.match(/data-color-theme="([^"]+)"/)?.[1] ?? 'default';
    return [[`${name} ${sel!.trim().startsWith('.dark') ? 'dark' : 'light'}`, vars]];
  });
}

/** The workspace hues (`--app-hue-*` in globals.css), as oklch. */
function hues(): Rgb[] {
  const css = readFileSync(join(web, 'app', 'globals.css'), 'utf8');
  return [...css.matchAll(/--app-hue-[a-z]+:\s*oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)/g)].map((m) =>
    oklch(Number(m[1]) / 100, Number(m[2]), Number(m[3])),
  );
}

describe('a selected card keeps 4.5:1 in every theme and mode', () => {
  const all = themes();
  const failing = (check: (v: Record<string, string>) => number) =>
    all.filter(([, v]) => check(v) < 4.5).map(([k, v]) => `${k} ${check(v).toFixed(2)}`);

  it('reads every theme', () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it('its text and muted text', () => {
    expect(failing((v) => ratio(hex(v.foreground!), hex(v.selected!)))).toEqual([]);
    expect(failing((v) => ratio(hex(v['muted-foreground']!), hex(v.selected!)))).toEqual([]);
  });

  it('its tag pills: the foreground on a 12% chart tint', () => {
    const pill = readFileSync(join(kit, 'tag-pill.tsx'), 'utf8');
    for (const n of [1, 2, 3, 4, 5]) {
      expect(pill).toContain(`bg-chart-${n}/12 text-foreground`);
      const on = (bg: string) => (v: Record<string, string>) =>
        ratio(hex(v.foreground!), over(hex(v[`chart-${n}`]!), 0.12, hex(v[bg]!)));
      expect(failing(on('selected'))).toEqual([]);
      expect(failing(on('card'))).toEqual([]);
    }
  });

  it('its workspace chips: the foreground on the 18% workspace tint', () => {
    const all = hues();
    expect(all.length).toBe(13);
    for (const hue of all) {
      expect(failing((v) => ratio(hex(v.foreground!), mix(hue, hex(v.background!), 0.18)))).toEqual(
        [],
      );
    }
  });
});

describe('the left sidebar keeps its contrast in every theme and mode', () => {
  const all = themes();
  const failing = (min: number, check: (v: Record<string, string>) => number) =>
    all.filter(([, v]) => check(v) < min).map(([k, v]) => `${k} ${check(v).toFixed(2)}`);
  const c = (v: Record<string, string>, name: string) => hex(v[name]!);
  /** A hovered row: `hover:bg-foreground/[0.06]` on the sidebar. */
  const hovered = (v: Record<string, string>) => over(c(v, 'foreground'), 0.06, c(v, 'sidebar'));

  it('text at 4.5:1: the active, idle, hovered rows, the headings and the filter tabs', () => {
    expect(
      failing(4.5, (v) => ratio(c(v, 'sidebar-accent-foreground'), c(v, 'sidebar-accent'))),
    ).toEqual([]);
    expect(failing(4.5, (v) => ratio(c(v, 'muted-foreground'), c(v, 'sidebar')))).toEqual([]);
    expect(failing(4.5, (v) => ratio(c(v, 'foreground'), hovered(v)))).toEqual([]);
    expect(failing(4.5, (v) => ratio(c(v, 'accent-foreground'), c(v, 'accent')))).toEqual([]);
    expect(failing(4.5, (v) => ratio(c(v, 'muted-foreground'), c(v, 'muted')))).toEqual([]);
  });

  it('icons and marks at 3:1: the star, and the folded rail unread dot', () => {
    const nav = readFileSync(join(web, 'components', 'layout', 'sidebar-nav.tsx'), 'utf8');
    expect(nav).toContain("? 'text-foreground/80 hover:text-foreground'");
    expect(nav).toContain('rounded-full bg-primary-ink ring-2 ring-sidebar');
    const star = (v: Record<string, string>) => over(c(v, 'foreground'), 0.8, c(v, 'sidebar'));
    expect(failing(3, (v) => ratio(star(v), c(v, 'sidebar')))).toEqual([]);
    expect(failing(3, (v) => ratio(c(v, 'muted-foreground'), hovered(v)))).toEqual([]);
    // The dot sits in a sidebar-coloured ring, so the ring is what it meets.
    expect(failing(3, (v) => ratio(c(v, 'primary-ink'), c(v, 'sidebar')))).toEqual([]);
  });
});
