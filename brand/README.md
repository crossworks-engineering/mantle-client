# Jackdaw brand assets

The marks for **Jackdaw**: this repo's web and desktop clients, and the
Jackdaw mobile app. **This directory is the source of truth.** Take the mark
from here rather than exporting a fresh one or copying one you found elsewhere
in the tree.

Mantle's own marks are a different brand. They live in the mantle repo, in
[`brand/`](https://github.com/crossworks-engineering/mantle/tree/main/brand),
together with their Affinity source.

`dark` and `light` name the **background the mark is drawn for**, not the mark's
own colour. The `dark` variants are cream and belong on a dark ground; the
`light` variants are dark brown and belong on a pale one.

## The mark

The illustrated jackdaw in a ringed circle, from 2026-08-12. It is what
`client/web` serves (resized) from `public/brand/`, what the desktop app uses
as its icon, and what Jackdaw mobile generates its app icon and launch screen
from.

| file | what it is |
|---|---|
| `jackdaw-icon-logo-{dark,light}-trans.png` | The badge alone |
| `jackdaw-name-logo-{dark,light}-trans.png` | The wordmark alone |
| `jackdaw-icon-name-logo-{dark,light}-row-trans.png` | Horizontal lockup |
| `jackdaw-icon-name-logo-{dark,light}-trans.png` | Stacked lockup |
| `jackdaw-redesign.afpalette` | The Affinity palette |

`client/web/public/brand/` holds small copies of three of these, renamed:

| web file | made from |
|---|---|
| `jackdaw-badge-{dark,light}.png` (96 px) | `jackdaw-icon-logo-{dark,light}-trans.png` |
| `jackdaw-row-{dark,light}.png` (96 px high) | `jackdaw-icon-name-logo-{dark,light}-row-trans.png` |
| `jackdaw-lockup-{dark,light}.png` (360 px high) | `jackdaw-icon-name-logo-{dark,light}-trans.png` |

The same folder also holds two mantleOS marks, for the places that name the
brain beside the interface (the dashboard's Build card, the rail's version
footer, the sign-in credit). They are copies from the mantle repo's
`brand/`, which owns them; copy them again when the mantleOS mark changes.

| web file | made from (mantle repo) |
|---|---|
| `mantleos-icon.svg` | `brand/mantle-sun-icon.svg` |
| `mantleos-logo.svg` | `brand/mantle-logo-os.svg`, with its live "OS" text outlined to paths |

### Colours

Jackdaw (the product) and Mantle (the engine) share one colour base and
each keeps its own lead colour: a family, but you can tell them apart. The
base is Jackdaw's own badge colours, so no mark had to change.

| swatch | hex | where it comes from |
|---|---|---|
| Brand brown (shared) | `#2D1500` | the ring of the light-background badge; the darkest swatch in the palette. Light-mode text and the ink on orange. |
| Brand cream (shared) | `#FDE7BC` | the ring and wordmark of the dark variants (the wordmark is 100% this one colour). Light-mode background, dark-mode text. |
| Amber (shared) | `#EB9F13` | a badge stripe. Dark-mode primary and the focus ring. |
| Sunset orange (Jackdaw lead) | `#E46E08` | a badge stripe. Light-mode primary, always with brown ink (white on it fails AA). |
| Rust | `#C83C04` | a badge stripe. Destructive actions, with white ink. |

Mantle uses the same cream, brown and amber, and leads with instrument grey
plus blue-grey instead of orange. The theme itself is generated in the
mantle repo (`packages/share-ui/themes/seeds.mjs`, the `jackdaw` entry) and
reaches this repo through `@crossworks/share-ui`.

### ⚠️ The badge's cream field is semi-transparent

Only about **32% opaque**. The artwork was drawn against a light page, so
compositing it straight onto the brand brown turns the interior a muddy olive.
It looks correct in any image viewer (which shows it on white) and wrong in
the app, which is what makes this worth writing down.

Anywhere the badge goes onto a dark ground, slide an opaque `#FDE7BC` disc
under it first, inset ~1.5% so the disc edge hides beneath the cream ring.
Both consumers already do this: `client/desktop/README.md` carries the
ImageMagick recipe, and Jackdaw mobile does it in `tool/generate_app_icon.dart`.

## History

Until 2026-08-21 the files above sat in `brand/redesign/`, next to six flat
SVG marks from 2026-08-10/11 (a bolder minimal jackdaw head) and a
`brand-mantle/` directory with the Mantle logos. The v0.6.6 release commit
(`b6395514`, 2026-08-22) moved `redesign/` up into `brand/` and removed the
flat SVGs and `brand-mantle/`.

The flat SVGs are still in git history if a true vector is ever wanted (a
favicon, a monochrome print, a stencil):

```bash
git show 403e6384:brand/jackdaw-icon-dark.svg > jackdaw-icon-dark.svg
```

The six files are `jackdaw-icon-{dark,light}.svg` (square 1024² icon mark),
`jackdaw-logo-{dark,light}.svg` (wordmark) and
`jackdaw-icon-logo-{dark,light}.svg` (horizontal lockup).

## Don't

- Don't composite the badge onto a dark ground without the disc above.
- Don't stretch, rotate, or add effects to the mark.
- Don't rebuild the wordmark by setting type. It's custom lettering, not a font.
- Don't re-export a raster from a raster.
