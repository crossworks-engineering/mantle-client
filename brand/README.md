# MantleOS brand assets

The marks for **MantleOS**: this repo's web and desktop client (MantleOS
Desktop) and the MantleOS mobile app. Since 2026-10-17 there is one brand.
The app was called Jackdaw and the engine Mantle; both are now MantleOS.

The **source of truth is the mantle repo's
[`brand/`](https://github.com/crossworks-engineering/mantle/tree/main/brand)**,
together with the Affinity source. The files here are copies, made so this
public repo carries its own marks. Take a mark from here or from there, never
from a screenshot or a re-export of a raster.

## The marks

| file here | made from (mantle repo `brand/`) | use it |
|---|---|---|
| `mantleos-icon.svg` | `mantle-sun-icon.svg` | The icon alone: a round sun badge. App icons, favicons, the collapsed rail, anywhere the name will not fit. |
| `mantleos-logo.svg` | `mantle-logo-os.svg` | The mantleOS wordmark: script "mantle" and an "OS" tag. The default wherever there is horizontal room. |
| `mantleos-logo-stacked.svg` | `mantle-logo-os-sun-icon.svg` | Icon and wordmark in one square. Only for an occasional big square placement. It does not work small: never use it at small sizes. |

All three are true vectors with the text converted to curves (no live text,
no font needed), so they render the same anywhere. The copies differ from
the mantle repo's files only in housekeeping: the Affinity namespace and ids
are stripped and the fixed 100% size is dropped, so each file sizes from its
viewBox.

One file per mark, not a light/dark pair: the art is drawn in its own warm
colours and reads on cream and on brown alike. It sits straight on the
background, with no plate or box behind it.

`client/web/public/brand/` serves `mantleos-icon.svg` and `mantleos-logo.svg`
under the same names. `client/web/app/icon.svg`, `apple-icon.png` and
`favicon.ico`, and the desktop's `build/icon.png`, are rendered from
`mantleos-icon.svg` (the desktop recipe is in `client/desktop/README.md`).
Icons that need a square background put the sun on brand cream `#FDE7BC`;
on brown its deep rust rim disappears.

### Colours

| swatch | hex | where it comes from |
|---|---|---|
| Brand brown | `#2D1500` | Light-mode text and the ink on orange. |
| Brand cream | `#FDE7BC` | The "OS" letters. Light-mode background, dark-mode text, icon backgrounds. |
| Amber | `#EB9F13` | The sun's top band. Dark-mode primary and the focus ring. |
| Sunset orange | `#E46E08` | The middle band. Light-mode primary, always with brown ink (white on it fails AA). |
| Rust | `#C83C04` | The sun, the bottom band, the "mantle" script and the OS tag. Destructive actions, with white ink. |
| Deep rust | `#5C1E02` | The badge's rim. |

The theme itself is generated in the mantle repo
(`packages/share-ui/themes/seeds.mjs`, still the `jackdaw` entry) and reaches
this repo through `@crossworks/share-ui`. The Affinity palette for those colours is
`jackdaw-redesign.afpalette`.

## History

From 2026-08-12 to 2026-10-17 this folder held the Jackdaw marks: an
illustrated jackdaw in a ringed circle, as PNG badge, wordmark, row and
stacked lockups in dark and light variants. They were removed in the MantleOS
rename and are in git history, e.g.

```bash
git show 59a9100e:brand/jackdaw-icon-logo-dark-trans.png > jackdaw-badge.png
```

## Don't

- Don't use the stacked logo small.
- Don't stretch, rotate, recolour, or add effects to the marks.
- Don't put a mark on a badge, plate or box.
- Don't rebuild the wordmark by setting type. It is custom lettering.
- Don't re-export a raster from a raster. Go back to the SVG.
