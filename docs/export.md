# Export: the Download menu and the PDF's print options

Every item header carries one Download tool (`components/export/export-menu.tsx`,
`useExportTool`). Its choices are the formats the item's kind supports; each is
a plain download link to the brain's `GET /api/export/<id>?format=…`, signed
through `useAssetUrl` so a detached client (the desktop app, a split
deployment) reaches the server origin with the short-lived asset token. The
brain generates the bytes; nothing is rendered on the client.

| Kind    | Formats                     |
| ------- | --------------------------- |
| page    | Markdown, Word, PDF         |
| table   | Excel, Markdown table, CSV  |
| drawing | SVG, PDF (committed snapshot) |

## The PDF's print options

PDF is the one choice with options. Picking it opens a small panel under the
Download button (the header's choice `panel`, a popover, folded into More
with the rest of the tool when the pane is narrow) instead of downloading at
once:

| Option       | Values                              | Default            | Query parameter                                              |
| ------------ | ----------------------------------- | ------------------ | ------------------------------------------------------------ |
| Paper        | A4, A3, A5, Letter, Legal           | A4                 | `paper=a4\|a3\|a5\|letter\|legal`                            |
| Orientation  | portrait, landscape                 | portrait           | `landscape=1`                                                |
| Margins      | 0 to 60 mm, one value or each side  | 18 / 16 / 18 / 16  | `margin=<mm>`, or `margin_top`, `margin_right`, `margin_bottom`, `margin_left` |
| Header       | plain text, 200 characters at most  | none               | `header=<text>`                                              |
| Footer       | plain text, 200 characters at most  | none               | `footer=<text>`                                              |
| Page numbers | on, off                             | off                | `page_numbers=1`                                             |

The panel's Download link is the same download anchor as every other export,
with only the options that differ from the brain's defaults on it
(`lib/print-options.ts`, `printQuery`). So the default download link is
exactly the link it was before the panel existed: `?format=pdf` and nothing
else. Four equal sides go as one `margin`; otherwise each side that differs
goes on its own. Flags go as `1`, never as `0`. An empty header or footer is
not sent at all.

Validation mirrors the brain's (`server/web/lib/print-options.ts` on the
mantle side, documented in its `docs/pages.md` §7), so nothing the panel sends
can be a 400: a margin is clamped to 0 to 60 and rounded, a header or footer
is trimmed and cut at 200 characters.

The last used options are remembered per browser (`localStorage`, key
`export:print`, through `usePersistedState` so a stored copy from an older
build or a hand-edited one comes back valid). Reset puts the defaults back.

**Older brains.** A brain older than the documents release (the one that
carries `feat/gotenberg`) ignores query parameters it does not know and prints
the A4 portrait it always did, so the panel is harmless before that release
rolls.

The link builder has tests (`lib/print-options.test.ts`): defaults omitted,
clamping, flags as `1`, text trimmed, nothing empty sent.
