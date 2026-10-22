# Mantle UI / Theme Style Guide

A rulebook for keeping the front-end consistent. Read this before doing any
styling work. When in doubt, **match an existing screen**: `/tasks` is the
reference **master-detail** implementation (§8) and the reference for forms
(§6); Appearance is the reference for theme widgets.

> **This file is the only copy.** The frontend left the mantle monorepo on
> 2026-08-13, and `mantle/docs/ui-style-guide.md` lingered afterwards as a
> fork — still teaching the hand-written grid, `space-y-1.5` field stacks and
> `size="icon"`, all of which this guide has since retired. Because the brain
> ingests the mantle image's `/app/docs`, that stale fork was what a search
> returned. It was deleted on 2026-08-18 and nothing was carried over: every
> line unique to it was a superseded idiom. If you find another copy, it is
> wrong by construction — there is one guide, and it is this one.

> TL;DR, shadcn primitives, semantic theme tokens only (pair every fill with
> its OWN `-foreground`, never mix pairs), never native `prompt/confirm/alert`,
> bare icons inside buttons, toasts for feedback, and reuse the shared patterns
> below instead of reinventing them.

---

## 1. Philosophy

- **shadcn-first.** Compose UI from the primitives in `components/ui/*`. Reach
  for raw `<button>`/`<input>`/`<select>` only when no primitive fits (and then
  ask whether one should be added).
- **Token-first.** Style with semantic theme tokens, never hardcoded colors.
  The app ships ~40 color themes (tweakcn) × light/dark; hardcoded hex/oklch
  breaks all of them.
- **Self-hosted ethos.** No external CDNs for fonts/assets. Inter is
  self-hosted via `next/font/local` (`client/web/lib/fonts.ts`); the rest of the
  face library is self-hosted woff2 under `public/fonts/library/`.
- **Consistency over cleverness.** A new screen should feel like it was built
  by the same hand as the last one.

---

## 2. Color tokens

Use Tailwind utilities backed by the theme CSS variables (mapped in the
`@theme inline` block of `@mantle/share-ui/styles/themes.css`). **Never** put a
hex/oklch literal in a component. The theme CSS itself is **generated** in the
mantle repo, seeds in its `packages/share-ui/themes/`, every text token solved
to AA at build time; see mantle's
[themes.md](https://github.com/crossworks-engineering/mantle/blob/main/docs/themes.md)
before touching any theme colour.

| Purpose                        | Tokens (`bg-`/`text-`/`border-`)                                            |
| ------------------------------ | --------------------------------------------------------------------------- |
| Page surface                   | `background`, `foreground`                                                  |
| Raised surface                 | `card`, `card-foreground`, `popover`                                        |
| Brand / primary action         | `primary`, `primary-foreground`                                             |
| Secondary                      | `secondary`, `secondary-foreground`                                         |
| Subtle / muted                 | `muted`, `muted-foreground`                                                 |
| Hover / highlight              | `accent`, `accent-foreground`                                               |
| Danger                         | `destructive`, `destructive-foreground`                                     |
| Positive / confirm             | `success`, `success-foreground`                                             |
| Caution / attention            | `warning`, `warning-foreground`                                             |
| Neutral notice                 | `info`, `info-foreground`                                                   |
| Any of those AS TEXT           | `primary-ink`, `destructive-ink`, `success-ink`, `warning-ink`, `info-ink`  |
| Syntax highlighting            | `code-keyword`, `code-string`, `code-number`, `code-title`, `code-variable` |
| Lines / fields                 | `border`, `input`, `ring`                                                   |
| Categorical data (charts ONLY) | `chart-1` … `chart-5`                                                       |

Rules:

- **A fill is not an ink. Use `text-primary-ink` / `text-destructive-ink` for
  text.** `--primary` and `--destructive` are tuned to sit BEHIND their own
  `-foreground`, which makes them dark/saturated, and frequently illegible when
  used as text on a neutral surface. Measured across the presets on 2026-07-27:
  47 such pairs below 2:1, one of them rendering a Delete label at 1.05:1 and one
  theme whose text and surface were literally the same hex. A single token cannot
  do both jobs, as a fill it wants to be dark, as ink on a dark surface it wants
  to be light, and in dark mode those are irreconcilable (~25% of themes had no
  solution). So the ink is its own token, free to differ, and it defaults to the
  fill wherever the fill already clears AA. `themes.test.ts` asserts every
  `-ink` token against every surface in every theme; `mantle/use-ink-for-text`
  fails the build on a bare `text-primary` / `text-destructive`.
  `bg-primary`+`text-primary-foreground` is unchanged, that pairing was never
  the problem.
- **Pair a fill with its OWN foreground, never mix pairs.** Each surface token
  has a guaranteed-contrast partner; use them together:
  `bg-primary`+`text-primary-foreground`, `bg-secondary`+`text-secondary-foreground`,
  `bg-accent`+`text-accent-foreground`, `bg-destructive`+`text-destructive-foreground`,
  `bg-muted`+`text-muted-foreground`, `bg-card`+`text-card-foreground`,
  `bg-background`+`text-foreground`. Mixing pairs (e.g. `bg-accent text-foreground`)
  has **no contrast guarantee** and silently breaks in themes whose `accent` is a
  light tint (candyland/soft-pop/neo-brutalism in dark mode → white-on-light).
  This applies to **hover and active fills too**: a coloured fill must bring its
  matching `-foreground` (e.g. `hover:bg-accent hover:text-accent-foreground`; for
  a fill on a row whose meta text is `text-muted-foreground`, flip it with
  `group-hover:text-accent-foreground`). Swept app-wide 2026-06-03.

  **Which fill where**: what each surface pair is _for_ (reach for the right one,
  then text it with its own foreground):

  | Fill                                             | Use it for                                                                                                                       |
  | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
  | `bg-background` / `text-foreground`              | the page itself                                                                                                                  |
  | `bg-card` / `text-card-foreground`               | neutral raised panels, cards                                                                                                     |
  | `bg-accent` / `text-accent-foreground`           | a **soft highlighted surface**: accent cards, hover/active rows, chips that set BOTH tokens                                      |
  | `bg-secondary` / `text-secondary-foreground`     | a quieter filled chip / segmented control                                                                                        |
  | `bg-muted` / `text-muted-foreground`             | the most subdued surface + secondary text on `background`                                                                        |
  | `bg-primary` / `text-primary-foreground`         | the single brand/action accent, primary buttons, the one thing that should pop. Don't tile large areas with it (it's saturated). |
  | `bg-destructive` / `text-destructive-foreground` | errors / destructive actions only                                                                                                |

  Rule of thumb: **`accent` is the "card accent"; `primary` is the single pop on
  top; `muted`/`secondary` are the quiet fills.** For a tinted-but-not-filled
  emphasis, a faint `bg-primary/10` (contrast-checked) is fine, but a _filled_
  coloured surface must bring its matching `-foreground`.

- **Semantic action colours come from tokens, not literal green/red.** Affirmative
  = `primary`, dangerous/removing = `destructive`; status = `success` /
  `warning` / `info` (first-class roles beside `destructive`, each with a
  `-foreground` for on-fill text and an `-ink` for text on neutral surfaces).
  A hardcoded `bg-green-600`/`bg-red-600` ignores the theme.
- **Opacity via the `/NN` modifier** (`bg-primary/10`, `border-chart-2/30`),
  works through `color-mix`, fully theme-aware.
- **`chart-1..5` is DATA ink, nothing else**: categorical series in actual
  charts, tag-pill tints, avatar palettes. It is generated at a 3:1 non-text
  bar and is NOT legible as text (`text-chart-N` on prose shipped function
  names at 1.02:1 once). Status colours are `success`/`warning`/`info`; code
  colours are `code-*`; both are AA-guaranteed inks. Don't use `primary` for
  categorical sets.
- **Selected / active state: the checked-card idiom, never a full `bg-accent`
  fill.** For list/card selection use `<ListCard>`'s selected state (shared with
  `RadioGroupCard`'s checked state in the Appearance galleries):
  `border-primary ring-1 ring-primary` (reads as one thick brand border) over a
  soft `bg-accent/50` tint. The _tint_ is safe where a full fill is not: it sits
  on `bg-card` under normal `foreground` text, while **an opaque `bg-accent`
  fill under text that isn't `accent-foreground` is unreadable on
  saturated-accent themes** — that ban stands. For hover use a neutral
  `hover:bg-muted/50` (or `hover:bg-accent/40` on picker cards). Compact nav
  rows (docs-nav, tree rows) keep the slim `border-l-[3px]` accent-bar variant
  instead — a ring is too heavy at that density.
- **Hover on a `bg-sidebar` surface (Activity column, nav):** `--sidebar` equals
  `--muted` in some themes, so `hover:bg-muted` is invisible there. Use a neutral
  overlay `hover:bg-foreground/[0.06]`; it differs from any sidebar value in
  light + dark and, being neutral, keeps grey `muted-foreground` text legible
  (a coloured `accent` tint muddies it).
- Light/dark is handled by `next-themes`; the color theme by
  `ColorThemeProvider` (`data-color-theme` on `<html>`, palettes in
  `@mantle/share-ui/styles/themes.css` from the mantle repo, registry in
  `packages/web-ui/src/lib/themes.ts`). Don't fork theme logic.
- **Adding a hand-authored theme** (as opposed to the imported tweakcn presets):
  a token has to clear contrast in _both_ the roles the app uses it in, `--primary`
  is a fill under `--primary-foreground` **and** ink as `text-primary` on
  `--background`/`--card`/`--sidebar`, same for `--destructive`. A mid-tone brand
  colour usually satisfies neither; shade it for light mode and let the brand hex
  itself carry dark mode (over near-black ink). `themes.test.ts` asserts the pairs,
  extend its `describe` rather than eyeballing a new palette.

### 2a. Translucent surfaces — the workspace shows through

The brain's saved Neat background paints behind every content area (owner
shell, team workspace, and — via a server-resolved copy — inside app frames).
Surfaces between the reader and that backdrop are translucent by rule, so the
background reads through the whole screen instead of dying at the first
rectangle. One alpha per role; do not invent new numbers per screen:

| Surface                                                                                                             | Treatment                                                       | Where it is encoded                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Idle list card                                                                                                      | `bg-card/70`                                                    | `listCardClass` (`ui/list-card`)                                                                               |
| Composer / form shell (§6c)                                                                                         | `bg-card/70`                                                    | `formShellClass` (`ui/form-shell`)                                                                             |
| Sticky chrome bar (pane headers, the rail's filter block)                                                           | surface token at `/60` + `backdrop-blur`                        | per screen, e.g. the notes/journal/pages/draw/tables headers                                                   |
| Field-look controls (`Input`, `Textarea`, `SelectTrigger`, `TagInput`, the outline `Button`, bordered filter chips) | `bg-transparent` — the `border-input` outline IS the affordance | the kit components; never re-add a fill at a call site (`border-input bg-background` is the smell to grep for) |
| Tabs (`TabsList` track / active tab)                                                                                | `bg-muted/60` track, `bg-background/70` active                  | the kit's `ui/tabs`                                                                                            |
| Reader / detail panes                                                                                               | no fill at all                                                  | the pane inherits the shell's ground                                                                           |

- **Floating layers stay opaque**: `popover`, dialogs, dropdown/select menus,
  toasts, tooltips. A menu floating over arbitrary content needs a solid
  ground — translucency there is noise, not continuity.
- **Sticky bars take the blur**: content scrolls UNDER them, and `/60` alone
  would let it fight the bar's own text. `backdrop-blur` + `/60` keeps the
  hue of the backdrop without the legibility fight. (`/80` was tried first
  and reads as fully solid over a gradient — hence the one number, `/60`.)
- **The plain brain costs nothing**: with no background saved, every one of
  these sits on the shell's solid `bg-background` ground and the alphas are
  invisible. Translucency is only ever VISIBLE when a backdrop exists.
- **App frames**: apps consume `var(--card)`; the frame document overrides
  the token to 70% only when it painted a Neat ground (`app-frame-html.ts`
  in `@mantle/share-ui`) — mirror the workspace numbers there, not new ones.

---

## 3. Typography & fonts

- **Four slots, one library.** Settings → Appearance picks a face and a size for
  the interface, the wordmark, the peer name and Pages/Notes prose. The registry
  is `packages/web-ui/src/display-fonts.ts`; every face in it is a variable font
  with at least two axes. See §3a.
- **Sans (everything):** Inter by default, self-hosted, wired as `--font-sans`
  on `<html>`. Just use default text, don't set font-family — the interface
  choice overrides that var and everything inheriting from the root follows.
- **Never set a wordmark/peer/prose font by hand.** Use the `.wordmark`,
  `.peer-name` and `.prose-document` classes in `app.css`, which pair each face
  with its size so the two halves of a choice can't be applied separately.
- `--font-serif` / `--font-mono` are fallback strings only (mono is fine for
  code/`font-mono`).
- **Do not add per-theme fonts.** Typography is a brain-level choice, orthogonal
  to the colour theme.
- Headings: page title lives in the **top bar** (see §8): don't add a big
  on-page `<h1>` that duplicates it. Section headings: `h2`,
  `text-base`/`text-lg font-semibold`.
- **Sizing, keep it readable.** Primary text `text-sm`, secondary/meta
  `text-xs`. Avoid `text-[10px]`/`text-[11px]` except for tiny corner
  tags/badges, list/table meta was deliberately bumped up a notch this round.

### 3a. Adding a face

Never hand-write a `@font-face` range. Run the importer, which reads the axis
ranges out of the file's own `fvar` table, converts to woff2, installs into
**both** apps' public dirs with the licence, and prints the registry row:

```sh
node scripts/fonts-import.mjs <family>/<Face>-VariableFont_*.ttf
```

Paste the row into `display-fonts.ts` and fill in `fallback` + `shelf`. The
importer refuses a face with fewer than two axes, and `display-fonts.test.ts`
asserts the registry, the shipped files and the licences agree in both
directions, per app. woff2 only: a `.ttf` left behind fails that test.

A declared range that is wider than the file's own is clamped by the browser, but
a MISSING one is not — without `font-weight` the browser treats a variable file
as a single 400 and synthesises bold, which reads as smeared headings everywhere.
That is the whole reason the ranges are machine-read.

---

## 4. Component inventory (`components/ui/`)

Prefer these over hand-rolled markup:

`button`, `dialog`, `alert-dialog`, `dropdown-menu`, `input`, `label`,
`textarea`, `checkbox`, `badge`, `select`, `tabs`, `toggle` / `toggle-group`,
`tooltip`, `popover`, `card`, `avatar`, `separator`, `skeleton`, `switch`,
`slider`, `radio-group`, `command`, `sheet`, `table`, `toast`, `sidebar`,
`resizable`, `submit-button`, `field`, `secret-input`.

### 4a. Our relationship to shadcn — read this before copying upstream code

**The primitive library is Radix UI.** Not Base UI, not React Aria. When you
read shadcn docs, use the `radix` variant of the page
(`ui.shadcn.com/docs/components/radix/…`).

**These components are a hand-maintained fork, not a managed shadcn install.**
There is no `components.json`, so `shadcn add` has never run here and will
overwrite rather than merge. They were vendored around the 2024 generation and
have been edited in place since. Concretely, ours differ from upstream in ways
you must preserve when porting:

|             | upstream today                             | ours                   |
| ----------- | ------------------------------------------ | ---------------------- |
| component   | plain function (React 19 ref-as-prop)      | `React.forwardRef`     |
| styling     | CSS layer classes (`cn-input`, `cn-field`) | inline utility strings |
| `data-slot` | everywhere                                 | only on `field.tsx`    |

Two more traps when copying upstream source verbatim:

- **`text-primary` is banned as ink.** The `mantle/use-ink-for-text` lint rule
  rejects it; use `text-primary-ink`. Upstream uses the fill colour freely.
- **Radix imports are mid-migration.** 5 components import from the unified
  `radix-ui`, 17 from scoped `@radix-ui/react-*`. Either resolves; don't
  churn a file just to change its import style.

Adopting upstream's CSS-layer styling wholesale is a **separate, large
decision** — it would have to be reconciled with the generated theme system
(`pnpm themes:build` in `packages/share-ui`). Don't start it incidentally.

Shared app-level patterns (`components/`):

- **`layout/back-link.tsx`**: `<BackLink href>` standard detail-page back link.
- **`layout/page-title.tsx`**: `<SetPageTitle title>` sets the centered top-bar
  title (no on-page duplicate needed).
- **`tag-pill.tsx`**: `<TagPill tag>` + `tagColorClass()` (themed tag color).
- **`tag-input.tsx`**: `<TagInput value onChange>` pill tag editor (`string[]`).
- **`markdown-editor.tsx`**: `<MarkdownEditor value onChange>` toolbar +
  split/preview editor.
- **`ui/toast.tsx`**: `useToast()` for all feedback.

---

## 5. Buttons & icons

- Use `<Button>` with `variant` (`default|secondary|outline|ghost|destructive|
link`) and `size` (`default|sm|lg|icon`). For links styled as buttons:
  `<Button asChild><Link …/></Button>`.
- **Icons inside buttons are bare:** `<Button><Plus /> New</Button>`. The
  Button base already supplies `gap-2` spacing and auto-sizes SVGs to `size-4`.
  **Do NOT** add `mr-*`/`ml-*` or `h-*/w-*` to an icon inside a Button; it
  double-spaces and fights the base. (Standalone icons outside buttons may keep
  margins/sizes.)
- **Heights line up at `h-9`:** `Button size="sm"` is `h-9`; the matching
  `ToggleGroup` size is `default` (also `h-9`), **not** `sm` (`h-8`). Match
  sibling controls.
- **Every size has a square icon twin at the same height.** Use the twin;
  **never hand-size a Button with `className="size-7"`** and never use a
  labelled size to hold a lone icon (that gives a rectangle, not a square).

  | Labelled  | Height | Icon-only twin |
  | --------- | ------ | -------------- |
  | `2xs`     | 24px   | `icon-2xs`     |
  | `xs`      | 32px   | `icon-xs`      |
  | `sm`      | 36px   | `icon-sm`      |
  | `default` | 40px   | `icon`         |
  | `lg`      | 44px   | `icon-lg`      |

  The 24px rung is the CHIP rung — a context pill, a tag, an attachment, and
  the dismiss inside one. `xs` at 32px is taller than the chips around them and
  reflows the row, which is why 46 call sites hand-rolled `px-2 py-1` and
  `p-1`/`p-0.5` rather than reach for it. `icon-2xs` sets its icon to
  `size-3.5` rather than `size-4`.

  So a ghost delete beside a `size="sm"` Edit is `size="icon-sm"`, not
  `size="icon"` (40px, 4px taller) and not `size="sm"` (a 40x36 rectangle).
  Before the twins existed both workarounds were widespread, and one screen
  rendered buttons at four different heights.

- Icon-only buttons: an `icon*` size + an `aria-label`.
- **A clickable ROW is `RowButton`, not `Button`.** A list item, a table cell, a
  disclosure header — anything whose whole strip is the target and whose
  geometry comes from the layout around it. `Button` brings a height, padding
  and centred content, and hand-sizing those away is forbidden above, so a row
  built from one is the wrong control. `RowButton` carries only the interaction
  contract: the same focus ring, the same disabled behaviour, `text-left`, and
  `type="button"` by default (a raw `<button>` in a `<form>` defaults to
  `submit`, which is how a disclosure row came to submit a form). Width,
  padding and background stay with the caller, because they belong to the
  layout.
- Icons come from `lucide-react`. Decorative icons get `aria-hidden`.

---

## 6. Forms

**The reference implementation is `app/(app)/tasks/task-form.tsx`.** Read it
before writing a form; the rules below are what it does and why.

### 6a. Structure: the `Field` family, never loose `div`s

Forms compose `FieldGroup` / `Field` / `FieldLabel` / `FieldDescription` /
`FieldError` from `@mantle/web-ui/ui/field`. **Do not** stack `div`s with
`space-y-*` and a bare `<Label>`; that shape is what let every screen's form
drift into a slightly different one.

```tsx
<form onSubmit={submit} noValidate>
  <FieldGroup>
    <Field data-invalid={!!error || undefined}>
      <FieldLabel htmlFor="task-title">Title</FieldLabel>
      <Input
        id="task-title"
        aria-invalid={!!error || undefined}
        aria-describedby={error ? 'task-form-error' : undefined}
      />
      <FieldError id="task-form-error">{error}</FieldError>
    </Field>

    <Field>
      <FieldLabel htmlFor="task-body">Notes</FieldLabel>
      <Textarea id="task-body" aria-describedby="task-body-description" />
      <FieldDescription id="task-body-description">What it is for.</FieldDescription>
    </Field>

    <div className="flex justify-end gap-2 border-t border-border pt-4">
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <SubmitButton pending={submitting}>Save task</SubmitButton>
    </div>
  </FieldGroup>
</form>
```

- `FieldGroup` owns the gap between fields (`gap-4`); `Field` owns the gap
  between label, control and description (`gap-1.5`). **Never re-space either
  by hand** — that is the whole point of the wrapper.
- **Two controls side by side**: wrap them in a plain
  `<div className="grid gap-4 sm:grid-cols-2">`, and keep each cell a `Field`.
  The grid is layout; the `Field` is still the unit.
- **A control with no single focusable id** (`TagInput`) takes
  `<FieldLabel asChild><span>…</span></FieldLabel>` rather than a dangling
  `htmlFor` that points at nothing.
- `noValidate` on the `<form>`: we render our own messages, so the browser's
  native bubble would be a second, uglier copy of the same thing.
- ⚠ **A vertical `Field` stretches its DIRECT children to full width**
  (`*:w-full`), which is what you want for a control and not what you want for
  a small button. An "+ Add another" beside a repeating group becomes a
  full-width bar the moment you move it inside a `Field`. Wrap it in a plain
  `<div>` and let the wrapper take the stretch — do NOT fight it with `w-fit`
  on the button, which lands at the same specificity and wins or loses by
  source order.

### 6b. Validation is three attributes, not a red `<p>`

A failed field carries all three, and `FieldError` renders nothing when there
is no message, so it can be mounted unconditionally:

| Where        | What                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| `Field`      | `data-invalid` → turns the label `destructive-ink`                            |
| the control  | `aria-invalid` → turns its border `destructive`                               |
| `FieldError` | `role="alert"` → announces, and `id` matches the control's `aria-describedby` |

**Put the error inside the `Field` it belongs to**, not at the foot of the
form. `role="alert"` only helps if it names the control the user is standing on.

### 6c. The composer surface: boxed, left, width from the panel

A create/edit form in a master-detail detail pane is a **card**, not a bare
pane. Same treatment for create and edit; they are the same form. The read
view gets the same column, so opening a record and editing it do not change
width under you.

```tsx
import { formShellClass } from '@mantle/web-ui/ui/form-shell'; // or <FormShell>

<div className="p-6">
  <div className={formShellClass}>
    <div className="flex items-center gap-2">
      <ListTodo className="size-5 text-primary-ink" aria-hidden />
      <h2 className="text-lg font-semibold">New task</h2>
    </div>
    <TaskForm … />
  </div>
</div>
```

The shell is `space-y-4 rounded-lg border border-border bg-card/70 p-5
shadow-sm`, exported once as `formShellClass` (the `listCardClass`
arrangement) — do not hand-roll the string.

- **No `max-w-*` here.** The form fills its panel, and `<MasterDetail>` gives
  that panel a default width of `672px` with a drag handle on its right edge
  (§8). A cap here would fight the handle: the user drags, and the form
  refuses to follow. The measure is still protected — it is just protected by
  the panel, in one place, rather than re-declared per screen.
- **Tucked left, never centred.** The composer sits against the list it adds
  to. That is what the empty third panel in §8 is for: it holds the slack on
  the right so the form does not drift to the middle of a wide display.
  Events and contacts still centre theirs (`mx-auto max-w-2xl`); **Tasks is
  the norm** and they are the ones to change.
- `bg-card/70` + `shadow-sm` is what separates the composer from the pane. It
  is also what exposes any field that does not match its siblings, which is a
  feature. The fill is translucent (70, the idle `ListCard` alpha) so the
  workspace's Neat backdrop reads through the shell like every other surface.
- The read view takes the card treatment only if its content is _not_ already
  cards. Tasks does not box it, because the body and checklist are cards
  already and a wrapper would nest borders three deep.

### 6d. Text boxes

- Use `Input`, `Textarea`, `TagInput`, `DateTimePicker`. **Never a raw
  `<input>` / `<textarea>`.** A hand-rolled one loses the focus ring, the
  invalid state, the placeholder colour and the thin scrollbar, all silently.
- **`Input` and `Textarea` are kept identical** on background, border, shadow,
  focus ring and font size, so they read as one control set on a card. If you
  change one, change the other. The only deliberate differences are
  textarea-only: `min-h` instead of a fixed height, and `scrollbar-thin`.
- **`Input` has a size scale, on `Button`'s rungs.** A field and a button in one
  row line up without either being hand-sized. **Never hand-size a field with
  `className="h-7"`** — reach for the rung.

  | `Input size=` | Height | Matching `Button size=` |
  | ------------- | ------ | ----------------------- |
  | `xs`          | 32px   | `xs`                    |
  | `sm`          | 36px   | `sm`                    |
  | `default`     | 40px   | `default`               |
  | `lg`          | 44px   | `lg`                    |

  Two things the scale deliberately does **not** copy from `Button`:
  - **No `2xs` (24px) twin.** 24px cannot hold 16px text, and every rung keeps
    `text-base` below `md` on purpose — iOS Safari zooms the page in when a
    focused field's text is under 16px and does not zoom back out. A smaller
    rung buys its height from padding, never from the text, because the text is
    the user's content rather than our chrome. (`Button`'s `xs` is `text-xs`; a
    button's label is ours to shrink.)
  - **`size` shadows the native attribute** of that name, which is a character
    count. It is `Omit`ted from the props, so a field that wants a character
    width says `className="w-…"` like the rest of the layout.

- **`SelectTrigger` has the same scale, and its `default` matches `Input`'s.**
  A select and a field on one form must be the same height, so the rungs and
  heights are identical to the table above:

  | `SelectTrigger size=` | Height | Type      |
  | --------------------- | ------ | --------- |
  | `xs`                  | 32px   | `text-xs` |
  | `sm`                  | 36px   | `text-sm` |
  | `default`             | 40px   | `text-sm` |
  | `lg`                  | 44px   | `text-sm` |
  - **The default was `h-9` until the scale landed, and that 4px was a live bug
    source.** `/settings/profile` rendered Site name 40, Peer name 40,
    Speciality **36**, Timezone 40, Locale 40, then three more selects at
    **36** — every select short of every field beside it, in one form stack.
    It does not show up in a screenshot: **measure heights from the DOM.**
  - **Unlike `Input`, the rung carries the type size**, as `Button`'s does. The
    iOS-zoom rule above is about a focused TEXT field; a trigger is a `<button>`
    showing a label we wrote, so it shrinks like a button's. Don't take `xs` for
    its height and add `text-sm` back without saying why (the studio header's
    agent picker is the one such site: it names what the page is about).
  - **No `2xs`**, for its own reason: 24px has no room for a value, a chevron
    and a focus ring.
  - `w-full` is already in the trigger's base classes; adding it is noise.
  - **Below `xs`, stay off the scale rather than rounding up.** A 28px control
    is a pill or a dev-tool row, not a small field, and rounding it to 32 moves
    everything around it. Say so beside it.

- **A field whose box belongs to its wrapper stays raw**, behind the rule's
  `eslint-disable` with the reason written beside it — the field analogue of
  reaching for `RowButton` instead of `Button`. A tag entry inside a bordered
  chip row, a grid cell editor, a column name edited in place: the wrapper
  already carries the border, the height and the focus-within ring, and a
  second box inside it draws a box inside a box. `Input` cannot give those up,
  and a smaller rung does not help — the problem is the box, not the height.
  That is a different case from a _small boxed_ field, which takes `xs`.
- **Every settings field carries a `<FieldHint>`** (`ui/field-hint.tsx`): the
  dimmed one-liner under the control. Not decoration: a number with no stated
  effect is a number nobody dares change.
  - **Say the effect, not the value.** "Default 3" tells the operator nothing.
    Lead with what moving the field _does_, and fold the default into that
    sentence ("…; 20 is plenty"). Read defaults from source, never guess them.
  - **Two sentences, ~120 chars, no jargon that isn't already on screen.**
  - **`warn` is for fields where excess bites**: money, box load, or answer
    quality. It renders in `warning-ink` after the description, so the hint
    reads in two tones. Most fields have no `warn`; using it everywhere makes
    it invisible where it counts.
  - **Wire it up for screen readers**: give the hint the field's `id` and put
    `aria-describedby={hintId(id)}` on the input.
  - **Field hints only.** A `<fieldset>` intro that explains a whole section
    stays a plain `<p className="text-xs text-muted-foreground">`; it isn't
    describing one control, so it takes no `id` and no `aria-describedby`.
    Don't restate the section intro on each field inside it.

  ```tsx
  <Label htmlFor="historyLimit">Turns to replay</Label>
  <Input id="historyLimit" aria-describedby={hintId('historyLimit')} … />
  <FieldHint id="historyLimit" warn="Each replayed turn is re-billed on every request.">
    How much of the recent conversation is re-sent with every message.
  </FieldHint>
  ```

- **Date / time entry uses `<DateTimePicker value onChange clearable?>`**
  (`components/ui/date-time-picker.tsx`), the shadcn Calendar in a popover +
  a time field. Don't use the native `datetime-local` input (used by events +
  heartbeats; value is a `Date | null`).
- **A password, key, secret or token is entered through `<SecretInput>`**
  (`components/ui/secret-input.tsx`), never `<Input type="password">` and never
  a plain text `Input`. It is masked by default and carries the eye toggle, so
  the value can be checked before it is submitted. It takes every `Input` prop;
  `noun` names the value in the toggle's label ("Show key"), and
  `wrapperClassName` sizes it in a row. The one-time reveal dialogs (a new API
  key, a vault reveal) are a different flow and stay as they are.
- **Every form submit uses `<SubmitButton>`** (`components/ui/submit-button.tsx`)
  , never a bare `<Button type="submit">`. It standardises the two things a
  save button must do:
  - **Descriptive label, verb + noun.** "Save agent", "Save profile",
    "Create event", "Save key", never a bare "Save"/"Create", and the label
    does **not** change while saving (no "Saving…" text-swap). The user should
    always read _what_ the button persists.
  - **In-flight feedback.** While the submit runs the button disables itself
    and shows a leading spinner; the label stays put (no layout reflow).
  - **Driving the busy state:** client forms (the common case, `fetch` +
    `useState`/`useTransition`) pass `pending={saving}`. Server-action forms
    (`<form action={…}>`) pass nothing, `SubmitButton` reads `useFormStatus`.
  - For create/edit dialogs, switch the label on mode:
    `{mode === 'create' ? 'Create agent' : 'Save agent'}`.
- **Multi-select → `<ToggleList>`** (`components/toggle-list.tsx`), not a wall of
  pills. Each row is a non-interactive container (name + description + a real
  shadcn `<Switch>`); **the Switch is the only control, clicking the row body
  does nothing** (explicit toggle, no whole-row click) and there is **no hover
  fill** (on-state shows a `border-l-primary` bar). Optional `group` clusters rows
  under sub-headers. It flows inline in the page (no inner scroll); pass
  `collapsible` to fold a long catalog behind a header that shows the
  `N of M selected` count, and `searchable` for a filter bar (text search + an
  All / On / Off selection filter, shown once a list exceeds ~6 items). Used by
  the agents Tools/Skills/Delegates pickers and AI workers.

### 6e. The outer settings-card: a form in a content area wears the card

**A form that stands in a content area** — a settings hub screen, a standalone
centred screen like `/login` — is wrapped in the sectioned card used by
`settings/(hub)/mcp` (`mcp-client.tsx`). This is the expected treatment
whenever a form is involved; don't lay the form bare on the page surface.

```tsx
<section className="rounded-xl border border-border bg-card">
  <div className="border-b border-border p-4 md:p-5">
    {/* header: title + description (+ an optional header control, e.g. a Switch) */}
  </div>
  <div className="p-4 md:p-5">{/* the form / body */}</div>
</section>
```

- The shell is `rounded-xl border border-border bg-card`; the header block is
  separated from the body by `border-b border-border`; both inset `p-4 md:p-5`.
- **References:** `/settings/mcp` (sectioned settings cards) and `/login`
  (brand block + strapline in the header section, the form in the body).
- **Distinct from §6c:** the master-detail COMPOSER keeps its own
  `rounded-lg … shadow-sm` card inside the detail pane. This section covers
  forms OUTSIDE that scaffold — standalone and hub content areas.

---

## 7. Dialogs, confirmations & feedback

- **Never use `window.prompt` / `window.confirm` / `window.alert`.**
- **Creating / editing** → `Dialog`. Constrain width (default `DialogContent`
  is wide): `className="sm:max-w-md"` / `sm:max-w-2xl`.
- **Destructive confirmation** → `AlertDialog`. Style the action red:
  `<AlertDialogAction className="bg-destructive text-destructive-foreground
hover:bg-destructive/90">`.
- **Feedback** → `useToast()`: `toast.success('Saved')`, `toast.error(msg)`.
  Prefer toasts over inline error banners for transient outcomes. Don't blow
  away a loaded view to show an error.
- Opening a Dialog/AlertDialog from a `DropdownMenuItem`: keep the dialog as a
  separate state-controlled component (not nested in the menu) to avoid Radix
  focus/pointer-events lockups.

### 7a. A scrolling body needs a gutter on BOTH sides

A long dialog gets a scrolling body: `max-h-[55vh] overflow-y-auto`. There is
no such thing as vertical-only overflow — CSS resolves the other axis to `auto`
as well, so **the box also clips its own children horizontally**, hard against
the edge.

That matters because a focus ring is painted OUTSIDE the control it belongs to:
our inputs and buttons carry `focus-visible:ring-2` on `ring-offset-2`, which
is 4px of ring beyond the border on every side. Give the scroller padding on
one side only (the reflex is `pr-1`, to keep the scrollbar off the text) and
the ring is sliced off flat on the other — the control reads as a pair of stray
horizontal lines running into the edge rather than as a highlighted box.

Pad both sides, then take the space back out of the parent's own padding so
nothing moves:

```tsx
<div className="-mx-1 max-h-[55vh] space-y-4 overflow-y-auto px-1 scrollbar-thin">
```

`px-1` is 4px, exactly the ring's reach. `-mx-1` widens the scroller into the
dialog's `px-5`, so children, dividers and text sit where they always did; only
the clipping stops. The same recipe applies to any scroller holding focusable
children — a `<ul>` of rows, a settings pane, a picker list — not just dialogs.
See `components/avatar-builder.tsx`.

---

## 8. Page layout & the master-detail pattern

### Centered content pages

Simple/standalone pages: `mx-auto max-w-{2xl..6xl} space-y-6 px-6 py-8`.

### Collapsible shell rails (`--nav-w` / `--activity-w`)

The left nav and right Activity column collapse to a 3.5rem icon rail. Their
live widths are published by `AppShell` as the `--nav-w` / `--activity-w` CSS
variables on the shell root (with matching `data-{nav,activity}-collapsed`).
**Any element that frames the content by offsetting against a rail must use the
vars, never a hardcoded `md:left-64` / `lg:right-80`**, e.g. `md:left-[var(--nav-w)]
lg:right-[var(--activity-w)]` (see `main`, `FleetLayout`, the mail shell). A new
full-screen fixed overlay that hardcodes the width will silently break collapse.
Descendants that need to restyle when collapsed key off the root via
`group-data-[nav-collapsed=true]/shell:…` (the mobile drawer portals outside the
root, so it always renders expanded). Shortcuts: **⌘/Ctrl+B** toggles the nav,
**⌘/Ctrl+J** toggles Activity (suppressed while typing/editing, so ⌘B still bolds
in the page editor).

### No header, no footer — the rail owns the chrome (`--top-bar-h`)

The shell has NO fixed header and NO footer bar; every control they held lives
in the left rail (`components/layout/rail/`): the brand block (wordmark + peer
name), the account/theme/search rows, the nav, and a bottom toolbar holding the
sidebar collapse toggle (⌘B), the per-screen Help launcher, Highlight content,
and the Assistant (⌘I, registered ONCE on the assistant provider, never
per-button). The Activity column owns its own collapse toggle (⌘J) in its
header, with the mirrored expand control on its icon rail.

Full-height fixed regions end at **`bottom-0`** and start at
**`top-[var(--top-bar-h)]`** — `main`, the assistant panel, the help rail,
`FleetLayout`, and the mail shell all do. `--top-bar-h` is defined on
`.mantle-shell` in `client/web/app/globals.css`, NOT inline: it is
breakpoint-dependent (3rem below `md` for the mobile-only top bar, 0 at `md`+
and in focus mode), and the media query is written as `48rem` so it flips at
exactly the same instant as Tailwind's `md` (rem in a media query resolves
against the browser default font size — a hand-written `768px` diverges when
that default isn't 16px). `--footer-h`/`--header-h` no longer exist; a region
written against them gets an invalid `var()` and loses its anchor silently.

### Full-height pages

The app `<main>` is a fixed, full-height `overflow-y-auto scrollbar-thin`
region. For full-height screens the **page wrapper returns the client directly**
(no `max-w` box; just `<><SetPageTitle/><Client/></>`) and the root takes the
height. **Every flex/grid scroll pane must carry `min-h-0`**: grid items and
flex children default to `min-height:auto`, so without it the pane grows to its
content and `<main>` scrolls _behind_ it (the dreaded double scrollbar / bottom
gap / cut-off). `min-h-0` is necessary but **not sufficient**: a correctly-sized
but `position:static` `overflow-y-auto` pane still leaks its scrollable overflow
into `<main>` when its content is far taller than the viewport, so the actual
scroll container (the detail pane) must also be `relative` (see the master-detail
rules below).

**Scrollbars are always needle-thin. No exceptions.** There is ONE global
default, in share-ui `app.css`: every element that scrolls gets a 4px thumb
(6px under the pointer) in the theme's primary colour on a transparent track,
with no buttons and no corner. You do not add a class for it. The only
opt-out is hiding the bar: `scrollbar-hidden`, or Tailwind's own
`scrollbar-none`.

`scrollbar-thin` and `scrollbar-hair` still appear across the code. They are
plain aliases of the default now; leave them or drop them, the bar is the same.
Do not add a new scrollbar class or a per-element width.

Two traps, both of which drew a fat grey bar in production:

- **Never set `scrollbar-width` or `scrollbar-color` in Chromium or Safari
  code paths.** Since Chromium 121 either property (and `scrollbar-color` is
  inherited) switches the `::-webkit-scrollbar` pseudo elements off for that
  element, and Chrome draws its own 11px grey bar. Tailwind 4 ships a
  `scrollbar-thin` utility that sets `scrollbar-width: thin`, which is how
  every `.scrollbar-thin` pane got the fat bar in October 2026; share-ui resets
  both properties to `auto` in those engines. Firefox gets the standard
  properties from share-ui, since it has no pseudo elements.
- **A third-party widget can outrank the global rule** with its own
  `::-webkit-scrollbar` styling (Excalidraw does). Restate the needle in that
  widget's theme file, as `components/draw/draw-theme.css` does.

When auditing, read computed `scrollbarWidth` and the gutter
(`offsetWidth - clientWidth`) in the browser rather than grepping for a class:
the needle measures 6px, Chrome's fallback bar 11px or more.

### Resizable panes: `<MasterDetail>` (the scaffold, in code)

**New screens use `@mantle/web-ui/ui/master-detail` rather than hand-rolling
the grid below.** It owns the rules that make the scaffold work — both panes
`min-h-0`, the detail pane `relative`, `scrollbar-thin` on both — so they
cannot be dropped. **Every list+detail screen is now on it**; the hand-written
grid below is kept as documentation of what the scaffold does, not as a live
pattern. If you find a screen still using it, port it.

⚠ **Size the node you pass to `list` / `detail` with `h-full`, never
`flex-1`.** The pane wrappers are blocks, so a flex property on your node is
inert: the node falls back to its content height, nothing under it has a
definite parent to resolve a percentage against, and any `h-full` descendant
collapses. It is silent — the screen looks fine until something inside wants
real height. `/apps` shipped a 150px app viewport this way (an iframe's
intrinsic height) in a pane that was 400px tall.

```tsx
<MasterDetail id="tasks" list={…} detail={…} />
```

- **Three panels, not two.** List (fixed) | detail (fixed) | an empty spacer.
  The spacer exists only to give the detail a right edge to drag against, so a
  form keeps a readable measure instead of stretching to 1200px on a wide
  display. Defaults: list `340px`, detail `672px` (= `max-w-2xl`).
- **`listFills`** inverts it: the LIST takes the slack and there is no spacer.
  For a left pane that wants every pixel — the Kanban board.
- **`detailFills`** is the mirror: the list keeps its draggable width and the
  DETAIL takes the slack. For a detail pane that is not reading text — Apps
  embeds an app viewport, and the 672px measure exists to protect a FORM's
  line length, not to shrink the thing the screen is for.
  - ⚠ **PROSE is not one of those.** `detailFills` leaves the pane with no
    right edge, so the reader can widen the list and nothing else — the page
    just sprawls to the window. `/pages` shipped that and it was wrong. A
    document the reader READS wants the three-panel default with a bigger
    opening measure and `maxDetailSize="100%"`: it tucks left, it opens
    readable, and its own handle has no ceiling.
- **`detailFirst`** puts the detail on the left. The board reads left-to-right
  across its columns, so the form belongs where that sweep starts.
- **`listCollapsed`** drives the list column to zero — focus mode on a list
  screen, where leaving the list beside the content defeats the point. **The
  list stays mounted**, so its search text, scroll position and page survive
  the round trip; `{zen ? null : list}` looks identical and quietly makes focus
  mode a reset button. Passed by `/apps`, `/notes`, `/draw`, `/pages` and
  `/tables` — the four focus-mode screens plus Tables' own collapse toggle.
  - **Know what focus mode gives back.** Under the three-panel default the
    width the list gives up goes to the empty SPACER, not to the detail — the
    chrome disappears and the content stays exactly as wide as it was, pinned
    against the left edge. With `detailFills` the content absorbs it instead.
    Prose wants a THIRD shape: `detailFills` with a `<MeasurePane>` inside the
    detail (`/pages` and the team readers are the reference). The pane takes
    the slack; the page keeps its chosen measure and re-CENTERS in the wider
    room — focus mode removes the chrome without re-flowing the paragraph the
    reader is in the middle of, and without stranding it at the screen edge.
  - **Passing it at all is what makes the panel collapsible**, which is why it
    has no default. `collapsible` also means "collapse when dragged below
    `minSize`", so setting it for everyone would let any list be dragged out of
    existence. A screen that never passes it stops at `minListSize`, exactly as
    before.
- **Prose sits in a `<MeasurePane>`** (`ui/measure-pane`): a CENTERED column
  with a remembered width, one handle on its right edge, no ceiling. The
  margins split the slack equally and grow together as the room does; when the
  room is narrower than the measure the column simply fills it. The drag moves
  the width at 2× the pointer — both edges give way at once, which is what
  keeps the handle under the pointer — and double-click resets. A full-page
  prose route (`/pages/[id]`) uses it directly; a list screen whose detail is
  prose uses it INSIDE `detailFills` (`/pages`). Without it a prose route picks between 1400px line lengths, a
  hard-coded `max-w-*` the reader cannot touch, or — the first cut of this
  component — a left-pinned panel-plus-spacer that could never reach the
  middle of the window.
- **`id` is the persistence key**, saved to `localStorage`. Unique per screen,
  and per _view_ where a screen has more than one: `tasks` and `tasks-board`
  are separate, because a board wants far more room than a 340px list.
- Below `md` it falls back to the CSS grid and nothing resizes.

> ⚠ **Compose a card from `ListCard`'s own parts**, not from remembered
> classes: `ListCardTitle` (add `wrap` where finding a record by name is the
> point, as on `/pages`), `ListCardSnippet`, `ListCardTags`,
> `ListCardMeta`. Every list screen does this now. It did not use to: thirty of
> them passed `<ListCard>` and then wrote the inside out by hand, which is how
> `truncate text-sm font-medium` came to lose its `truncate` on one screen and
> its `text-sm` on another. The parts are the only place those rules can be
> changed once — a class you type into a card is a class that will drift.
>
> `/docs` is the one exception and a deliberate one: its left column is a nav
> TREE, not a list of records (`handover-resizable-columns.md` §3).
>
> **Marking a card for attention: the `accent` prop**, never a class. It draws
> the slim `border-l-[3px]` bar (the compact-nav idiom) in a semantic status
> token — `primary` | `info` | `warning` | `success` — and composes with
> `selected`, whose ring and tint stay legible beside it. Status tokens only:
> `chart-*` is DATA ink and a literal green/red ignores the theme (§2). One
> marker per card, most urgent wins: `primary` = pinned, `info` = unread,
> `warning` = needs attention. (The team forum was the reference; it went
> with the team portal in member logins Phase 6, and no screen passes
> `accent` today.)

**Every draggable edge shows a grip, at rest, without hovering it.** If a
column can be resized, the user must be able to see that before they go
looking. `ResizableHandle withHandle` — what `MasterDetail` renders — is the
reference: a 1px `bg-border` rule with an always-drawn grip
(`GripVerticalIcon` in a bordered `h-4 w-3` chip) sitting on it. An edge whose
only affordance appears on hover is a hidden feature; an edge with no grip at
all is an invisible one.

**Fixed rails use `<RailHandle>` instead** (`ui/rail-handle`). The nav and
activity columns are `position: fixed` and publish their width as a CSS
variable that six other surfaces read; they are not flex children of a panel
group, so panels cannot wrap them. Widths persist to a **cookie**, not
localStorage, and are seeded server-side in `app/(app)/layout.tsx` so the rail
does not jump on load. A **collapsed rail has no handle** — the toggle owns
that width.

`RailHandle` meets the grip rule the same way `ResizableHandle` does: it draws
the **identical chip** — `h-4 w-3`, bordered, `bg-border`, a `size-2.5`
`GripVerticalIcon` — at rest, straddling the rail's edge. Only the positioning
differs, because a fixed rail has an edge rather than a divider to centre on.
The 1px `after:` rule stays `bg-transparent` until hover: the rail's own
`border-r`/`border-l` already draws that line, so painting a second one there
would be a doubled border, not a stronger affordance.
`shell-layout.spec.ts` holds this — it measures the grip's painted box against
the divider's with the pointer parked away, so restyling one and not the other
fails.

> ⚠ **Never put a transition on a property you read from a CSS variable.** See
> the long note in `globals.css`: the element stops tracking the variable
> entirely. Animate the variable instead; the consumers follow.

### Choosing the three widths (and the padding that comes with them)

The scaffold gives you two decisions per screen. Getting them wrong is not
subtle — it shows up as dead space or as a divider that does nothing.

**1. Who absorbs the slack?** Pick by asking what the DETAIL holds:

| the detail is                           | prop                                                | why                                                                                                                        |
| --------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| a form                                  | _(default)_                                         | the 672px measure is what stops fields running to 1200px line lengths                                                      |
| prose the reader READS                  | _(default)_, wider opening + `maxDetailSize="100%"` | it wants a measure AND a right edge; `/pages` opens at 900px because its `xl:` outline rail eats 224px of whatever it gets |
| a table, diff, transcript, app viewport | `detailFills`                                       | not reading text; the cap would shrink the thing the screen exists for                                                     |
| columns read left-to-right              | `listFills`                                         | the board wants every pixel                                                                                                |

**2. Can it reach the window edge?** The default ceiling is `maxDetailSize`
(1100px), with the leftover parked in the empty spacer. That is right for a
form and wrong for a gallery: `/settings/appearance` shows 43 theme swatches
beside 34 avatar styles, and at the default it clipped mid-card while ~570px
of a 1920px window sat empty. **`maxDetailSize="100%"` lets the drag run the
spacer to zero**, so the ceiling becomes the window minus the rails.

> Keep the OPENING measure at 672px even then. Widening the ceiling is an
> ability, not a new default — the twelve settings forms behind the same
> divider still want to open readable.

⚠ **`minListSize` must be ≤ `defaultListSize`.** `/apps/[id]`'s Code tab opens
its file tree at 200px, so its floor comes down to 160; leaving
`MasterDetail`'s 260px default would put the minimum ABOVE the opening width
and the divider could only ever travel one way.

#### Padding: 24px inside the pane, and the trap that hides it

**Every detail pane insets its content by `p-6`.** That is the number, and the
settings hub's thirteen screens are the reference.

⚠ **A screen that was centred has no padding of its own.** `mx-auto max-w-2xl`
supplied the visual gap for free, so the moment you drop the cap (as you must —
see the anatomy section below) the content goes flush against the divider.
Three screens were sitting on `p-1` and one on nothing at all, and it was
invisible until the centring went. **Check the inset after removing a cap; do
not assume the screen had any.**

⚠ **The opposite mistake is as easy.** `/settings/appearance` pads the row that
holds its two columns, so adding `p-6` to the inner column too inset it twice —
48px against its neighbour's 24. Read the whole page wrapper before adding
padding, not just the component you are looking at.

**Rules span, content insets.** A divider under a filter bar or above a pager
runs the full width of the pane; only what sits between them is inset. The
audit log is the worked example: filter bar, table and pager all at 24px, with
both rules edge to edge.

#### Finding the scaffold's own divider

`[data-slot="resizable-handle"]` on its own is **ambiguous**, and increasingly
so: the shell rails have handles, and a detail pane may bring its own group
(`/team-admin` splits a member transcript from its access log). Scope to the
innermost panel group that holds the list, then take only its direct children:

```ts
page
  .locator('[data-slot="resizable-panel-group"]:has([data-testid="list"])')
  .last()
  .locator(':scope > [data-slot="resizable-handle"]');
```

A test that grabs `.last()` unscoped drags the wrong divider sideways and then
reports "the divider did not move" — which reads exactly like a scaffold bug.

⚠ **Wait for a handle before touching the list.** `MasterDetail` paints the CSS
grid until `useMediaQuery` resolves and then swaps to panels — a different tree,
so the list subtree is rebuilt once on mount, on every screen. A test that tags
or measures the list before that swap is racing a remount: green alone, red
under a full run. The handle exists only in the panel branch, so it is the
"settled" signal. It has already cost more than one debugging cycle; do not rediscover it.

### A layout-owned list: card lists of SCREENS, not records

Two sections use the scaffold for navigation rather than for records — `/debug`
(twelve tabs) and `/settings` (thirteen single-panel screens). The shape is
worth copying whenever a cluster of sibling screens has no collection behind it.

- **The list is a `<ListCard>` per SCREEN**: title, a line saying what it is
  for, and optionally one live stat. It replaced a horizontal tab strip on
  `/debug` — twelve tabs never fitted the row.
- **It lives in a Next `layout.tsx`, and the detail IS `children`.** That is
  what makes the cards' queries mount ONCE for the section instead of re-firing
  on every click. `focus-mode`-style tests should assert the nav element
  survives navigation.
- ⚠ **Use a route group when the cluster has siblings that must stay out.** A
  layout applies to everything beneath it, so `settings/layout.tsx` would put
  the hub rail beside `/settings/agents` — a list inside a list. The hub lives
  at `settings/(hub)/layout.tsx`; a route group changes the file tree and NOT
  the path, so every `/settings/<name>` URL and deep link is untouched.
- **`/settings` is a landing explainer, not a redirect** to the first card. A
  redirect answers a question the reader has not asked and makes the back button
  bounce.

#### When a stat line earns its place

A stat is worth a request when it is **actionable** — something that changes
whether you open the screen at all. "3 merge candidates waiting" and "0.230.66 →
0.230.67 available" qualify; "you have a profile" does not. Five of the settings
hub's thirteen carry one, and the other eight deliberately do not: thirteen
stat queries on merely opening `/settings` is the other half of the argument.

**Reuse the screen's own `queryKey` and URL** so the card and the screen share
one react-query cache entry instead of fetching the same thing twice. Opening a
screen whose card has loaded is then free, and the list warms the cache.

### Sibling-view tabs: top of the list pane

⚠ **Not for filtering one collection.** Sources or states of the SAME items
(Mine / Library, Brain / Private) are not sibling views: show them in one
list with a state pill and a State filter (see "The item list kit" below).

When a screen offers a **selection between sibling views or routes** and lives
in the resizable card-list scaffold, the switcher goes in the **navigation area
at the top of the LIST pane** — its own `border-b border-border p-3` row,
above the search / filter / New controls. Not in the detail pane, and not an
on-page tab strip above the whole scaffold.

**The reference is `/models`** (`models-nav.tsx`): a segmented switcher styled
like `TabsList` (the `bg-muted` pill is what makes the navigation findable),
built from real `<Link>`s with `aria-current="page"` because the tabs are
routes. Use Radix `Tabs` only when the selection is genuinely local state;
the placement rule is the same either way.

### Master-detail: the anatomy, and the rules that outlive the scaffold

**This is THE pattern for a list+editor screen**, and it is one shape whichever
scaffold renders it:

- **Left: a scrollable list of `<ListCard>`s**, with the screen's search /
  filter / New controls above it and an optional `<ListPager>` pinned below.
  Fixed width, and **draggable** — the divider is the user's, not the screen's.
- **Right: the detail for the selected row**, and it **hugs the divider —
  tucked LEFT, never centred**. A `mx-auto max-w-*` in this pane is wrong
  twice: it walks the content away from the list it belongs to, and it means
  dragging the divider wider does nothing. The measure is the panel's job now
  (§8's three-panel model), declared once, not re-declared per screen. §6c is
  the same rule for the composer card.
- **The detail opens with `ItemHeader`**: one 44px row, fixed slots on the
  right. See "Detail header anatomy".

Everything below applies to BOTH scaffolds. The rules about _behaviour_ —
selection, the card, pagination — are the durable part; the grid vs
`<MasterDetail>` question is only about who owns the boxes.

#### The legacy hand-written grid

⚠ **Not for new work, and nothing uses it any more** — use `<MasterDetail>`
above. The settings screens, `docs` and `team-admin` were ported during phase 2;
`team-section` (the old /team member workspace, since retired with the team
portal) was the last holdout and went over on 2026-08-19. It is kept here because the rules underneath it are the
scaffold's reasons, and reading them is how you know what `<MasterDetail>` is
protecting you from.

```tsx
<div className="md:grid md:h-full md:grid-cols-[340px_1fr] md:overflow-hidden">
  {/* LEFT: list */}
  <div className="flex flex-col border-b border-border md:h-full md:min-h-0 md:border-b-0 md:border-r">
    <div className="flex items-center justify-between gap-2 border-b border-border p-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Things</h2>
      <Button size="sm" onClick={openCreate}><Plus /> New</Button>
    </div>
    <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
      {items.map((it) => /* accent card */)}
    </div>
    {/* optional fixed footer, e.g. pager */}
  </div>
  {/* RIGHT: editor / detail — `relative` is load-bearing, see rule below */}
  <div className="relative md:h-full md:min-h-0 md:overflow-y-auto md:scrollbar-thin">
    {selected ? /* editor */ : /* empty state */}
  </div>
</div>
```

Rules — the first two are the legacy grid's; the rest are the pattern's and
hold either way:

- **Both panes need `md:min-h-0`** (see double-scrollbar note above). Left is a
  flex column; only its list div scrolls (`md:flex-1 md:overflow-y-auto`).
- **The scrolling detail pane needs `relative`** (`position` only, no other
  effect). `min-h-0` correctly sizes the pane to the grid track, but a
  `position:static` `overflow-y-auto` pane still lets its _scrollable overflow_
  propagate up to `<main>` when its content is much taller than the viewport,
  producing a **second, outer scrollbar** that overlaps and clips the editor.
  Making the pane a positioned element (`relative`) closes that boundary so only
  the pane scrolls. Symptom: two stacked scrollbars on the right pane, the outer
  one cutting off text. This bit tool-groups/skills/tools (whose tall tool-picker
  lists pushed content to ~8000px); agents never had it because its pane was
  already `relative`. Always include `relative` on the detail pane.
- **List card** (selectable list item): use the shared **`<ListCard>`**
  (`@mantle/web-ui/ui/list-card`) — never hand-roll the class string again.
  Selection = `border-primary` + `ring-1 ring-primary` + a soft `bg-accent/50`
  tint (the checked-card idiom, see §2):
  ```tsx
  import { ListCard } from '@mantle/web-ui/ui/list-card';

  <ListCard selected={isSel} dimmed={!row.enabled} onClick={…}>…</ListCard>
  // Link rows: <ListCard asChild selected={…}><Link href={…}>…</Link></ListCard>
  // Extra layout via className (merged): className="group flex items-start gap-2"
  ```
- **Auto-select the first item** so the right pane is never blank:
  `selected ?? items[0]`.
- **Editor header (right pane):** anatomy, action order and the delete idiom
  are in **"Detail header anatomy"** below — follow that, not this bullet's
  older description. What is specific to settings editors: top-right also
  holds boolean flags as shadcn **`Switch`es** (Enabled, Default-for-kind, …),
  the form body has the rest, and there is a Save/Cancel footer. Don't put the
  Enabled toggle in the form body; it lives in the header.
- **Selection model, pick one:**
  - _Client state_ when the list rows already hold everything the detail needs
    (e.g. Notes rows include content) → instant, no fetch. `useState` for
    selection; re-derive the selected object from fresh props each render so
    saves reflect immediately.
  - _URL-driven_ (`?selected=id`, `?mode=add|edit|…`) when the detail needs a
    server fetch or reuses server-action forms (Traces, AI workers, Accounts) →
    cards are `<Link>`s, the server page renders the right pane. Make a create
    action redirect back to `?selected=<newId>` so it lands on the same screen.
- **Grouped lists** (AI workers by kind, Tools builtin/user-defined) → sections
  inside the left scroll area, each with its own sub-header / `+ Add`.
- **Read-only oversight:** when a record's fields are code/seed-managed (built-in
  tools), still let it be selected and show the fields **read-only** (disabled
  inputs / muted blocks); only send the editable subset on save.
- **Search / filter / pagination are URL-driven (SSR), not client-side.** The
  reference is `/pages`; `/tasks`, `/events`, `/secrets` follow it. The server
  page reads `q` / `page` / filters from `searchParams`, calls
  `list({ …filters, limit, offset })` + a `count*()`, and passes
  `rows / total / page / pageSize / query / filters` to the client. The client
  uses the **`useListNav()`** hook (`go(patch)` merges into the query string;
  `null` clears a key, and filter/search changes pass `page: null` to reset),
  a debounced search input, and **`<ListPager>`** (footer count + prev/next,
  shown whenever there are rows). Don't filter a loaded list in `useMemo`,
  paginating a client-filtered slice is wrong.

### The item list kit: one list, state as a pill (2026-09-29)

Every list of ITEMS (the admin Pages, Notes, Tables and Draw screens' card
lists, the client portal's "Shared with you") is built from ONE kit, `client/web/components/item-list/`. Do not hand-roll a
list header, card, filter row or pager on a list screen again; extend the
kit instead. Files keeps its file-manager layout (a folder rail and a
table), but follows the same state rule below.

**The rule (Jason, 2026-09-29): show everything the reader can see, by
default, and say each item's state on the item.** A list never hides items
behind a source switch (Mine / Team drafts / Library / Accepted, Brain /
Private), never preselects a source, and never opens on the emptiest view.
Where an item stands is a small pill on its card; the reader narrows the
list with a quiet State filter only when they want to.

- **Header: `<ItemListHeader>`**: the search box and the create actions
  (`<NewButton>`, an Upload button) on one row, the filter row under it.
  `heading` only where the screen has no page title of its own (the client
  portal).
- **Filter row: quiet ghost triggers, never a row of blocks.** `<SortMenu>`,
  `<TagFilter>` (a popover combobox that also holds the card density switch),
  `<StateFilter>` (All items first; the pills, then groups such as Brain or By
  me), `<ChoiceFilter>` for any other short choice (the client's kind),
  `<DetailsToggle>` where there are no tags to hold the density switch, and
  `<ClearFilter>` while a filter is on. A segmented `ToggleGroup` of sources
  above the list is exactly what this replaced.
- **Card: `<ItemCard>`**, the /pages card anatomy: the leading glyph
  (`<ItemIcon>`), the TITLE written out in full (it wraps), a level badge
  beside it, then a footer row: the drag handle and the updated stamp
  (`<UpdatedStamp>`) or a sub-page link at the start; the state pill, then the
  actions (`<ItemCardAction>`) at the end. The pill sits immediately LEFT of
  the first action. Summaries and tags only with the density switch on.
  Actions a reader may not take are simply absent: no disabled buttons.
- **State pill: `<StatePill>`**, lower-case words, `rounded-full border px-2
py-0.5 text-[11px]`: `private`, `draft` (shared with the team), `submitted`
  (info ink), `returned` (warning ink), `with admin`. The words are the
  brain's (`MemberItemPill`); the brain's own items wear none. One pill per
  card.
- **Scroll area and pager: `<ItemListScroll>`, `<ItemListEmpty>` and
  `<ListPager noun>`** ("26 pages · page 1 / 2"). The pager is always the
  shared one.
- **The brain merges, never the client.** A list that mixes sources (a
  member's own items and the Library, an admin's private items and the
  brain's) is ONE request the brain answers merged and paged
  (`GET /api/member/items`, `?state=` on the admin lists). Never merge two
  paged lists in the browser: page 2 of a client-side merge is wrong. The
  State filter goes to the brain the same way.
- **URL-driven, as §8 says**: `q`, `state`, `page` (and `sort`, `tag`,
  `kind`) in the URL; the open item too (`?id=`, `?selected=`, and `?pid=` for
  an admin's private item). The first card opens on a wide screen; a phone
  shows the list first.

The reference screen: `/pages` (the admin card, drag and drill-down).

**A member's workspace is not a list (Jason, 2026-10-09).** Pages, notes,
draw, tables and files open in the FOLDER VIEW for a member: the admin's
`ItemTree`, layout and search, read as `source="member"` (the member manages
only its own folders and drafts; nothing admin-only is offered). What the
tree does not hold (own items with an admin, the member's accepted work,
clients' requests) shows in small collapsible sections above it, each hidden
while empty (`components/member/member-workspace.tsx`,
`member-item-sections.tsx`, built on `ReviewSections`). There is no List or
Folders switch and no State filter; old `?view=`, `?state=` and `?page=`
links land in the folders.

### Detail header anatomy (right pane)

**The item header contract (2026-10-21).** Every workspace item's detail
pane (pages, notes, tables, drawings, files and folders, apps, formulas,
journal, tasks, events, contacts, agents, Recall maps) opens with THE same
header, in read and edit mode alike: `ItemHeader`
(`components/layout/item-header.tsx`). Never hand-roll a header row, a title
band, a tags row or a banner under it. **The reference is `/pages`**
(`pages-client.tsx`, the `PagePreview` header).

```tsx
<ItemHeader
  sticky
  section="Pages"                        // the back link's word while maximised
  visual={<span aria-hidden>{icon}</span>}
  title={title}
  badges={isDraft ? <HeaderPill>uncommitted</HeaderPill> : null}
  edit={{ href: `/pages/${id}` }}       // the pencil; { disabled: true } when read-only
  access={<AccessSlot type="page" nodeId={id} canShare={access.share} shares={row} />}
  tools={[useExportTool(id)]}            // the kind's own tools
  onDelete={confirmDelete}               // the bin; deleteDisabled when not allowed
  info={{ tags, path, description, rows: [{ label: 'Updated', value: … }] }}
/>
```

- **One row, 44px at the default text size** (`h-11 px-4`, rem: it grows
  with the reader's text size), sticky with the chrome-bar surface
  (`bg-background/60 backdrop-blur`, `border-b`). Nothing under it: a thin
  meta line was tried and dropped. Pinned by tests.
- **The title is 15px at the default text size** (`text-[0.9375rem]
font-semibold`) on every kind, the glyph inside the `h2`, the title cut to
  fit, then at most ONE state pill (`HeaderPill`, the list's `StatePill`
  shape). In edit mode the title stays in this row.
- **Fixed slots, counted from the right, the same on every kind and mode:**
  More (⋯) first, Edit (the pencil) second, Delete (the bin) third, Focus
  fourth, Info fifth, Access sixth. The component draws them; a screen never
  reorders them. A login that may not edit or delete sees that pencil or bin
  greyed in its slot (`edit={{ disabled: true }}`, `deleteDisabled`), so
  nothing beside it moves. To their left: the kind's `tools`, then the word
  buttons (`textActions`, at most two: the mode's primary verbs).
- **Edit is the pencil, never a word button.** Commit, Done, Save, Publish,
  New ▾ and Upload are word buttons with their icon.
- **Tools fold into More** as the pane narrows (priority+, measured by
  `useHeaderOverflow`, never per-screen breakpoints), from the end of the
  list. A tool with `choices` (Download) is a menu inline and a sub-menu once
  folded. The word buttons and the fixed slots never fold.
- **Access shows who it is shared with:** `AccessSlot` draws the share
  icon and the item's workspaces as overlapping tiles (three, then "+N"), a
  globe for an open link, the icon alone when shared with no one. A login
  that may not share sees the same stack, not clickable. It reads the list
  row's marks; a row without them (an item opened by its detail route, a deep
  link) falls back to the item's grants.
- **A kind with nothing to share or edit leaves that slot out** (a journal
  entry has no Access; a contact's form is always open, so no pencil). That is
  the only way a fixed slot goes missing.
- **More (⋯) always lists every action the item has** (2026-10-21), the ones
  shown as icons too, so it is never empty: edit and the kind's tools; Copy
  link (the item's address, without `?edit=1`), Duplicate (apps: the only kind
  with a copy route) and Move to folder… (`move`: the tree of that kind opens
  its own Move dialog); Access…, About…, Maximise; Delete last, in red.
- **Info holds everything that is not the title:** description, folder path,
  tags, dates, level, a read-only note. No tags row or description line under
  the title.
- **Editor toolbars belong to the content**, not this row.
- **Focus is the only way the folders go away.** `FocusToggle` (fourth from the
  right) hides the shell chrome and the list. While maximised the header shows
  ONE back link at its far left, "‹ Pages" (`section`), which brings the
  folders back and keeps the item open; Esc does the same (the shell's key,
  not while a dialog, menu or field has it).
- **Every open item has its own address, read and edited** (2026-10-21), so
  it can be copied and shared without opening the editor: `/pages/<id>` reads
  the page, `/pages/<id>?edit=1` edits it, both inside the list screen with
  the folders beside them (a section layout renders the list client for the
  index and the item route). Picking an item pushes its address.
- A screen not yet moved to the slots passes `iconActions` (its own icon
  group) and keeps it; move it over when you touch the screen.
- **Delete is a ghost icon button that is grey until hover:**
  `variant="ghost" size="sm" className="text-muted-foreground
hover:text-destructive-ink"` plus an `aria-label`. It carries **no text
  label**. Delete always confirms through an `AlertDialog`.
  - The always-red variant (`text-destructive-ink
hover:text-destructive-ink`) **has been retired** — every delete
    affordance in the app now uses grey-until-hover. Several still carry a
    `Trash2 + "Delete"` text label; dropping the label is per-screen work
    (phase 2), the colour is not.
  - **Two deliberate survivors**, both non-delete and both text-only: "Reset to
    default" (`studio/structure-editor.tsx`) and "Cancel" a run
    (`runs/active-runs-strip.tsx`). A trash glyph carries the warning on its
    own, so grey at rest costs nothing; a word does not, and greying those two
    would leave a destructive action looking like any other ghost button.
    Don't "finish the sweep" by changing them.

### A detail pane with an inspector: the Recall Cards view (2026-10-22)

When one item is built from MANY parts (a Recall map is a set of cards), its
detail pane is a workbench of three columns, every edge a `ResizableHandle`
and every width remembered (`app/(app)/recall/v2/cards-view.tsx`):

| Column    | Holds                                                                                                                                  | Never holds                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Parts     | each part's title, wrapped, behind a glyph for its kind; a mark when it wants attention                                                | slugs, ids, sizes: noise at a glance |
| Text      | a bar (the trail to the part, the unsaved state, Delete, Save), then the title and the body, which fills the column                    | settings, switches, relations        |
| Inspector | everything ABOUT the part: kind, link name, when it last changed and by whom, size; its switches; its relations both ways; its history | the body                             |

- **Save is always in view**, in the text column's bar. A form whose button
  sits under 6,000 characters of body is a form nobody finishes.
- **Relations read before they edit.** An option is one line (where it goes,
  what it is called, when to take it) and its target is a link; the pencil
  opens its fields, and an incomplete one opens by itself. Show the reverse
  too ("Reached from"): the trail is followed in both directions.
- **The trail is the breadcrumb**: the shortest walk from the entry part to
  this one, each step a link. A part no walk reaches says so there.
- **Attention is counted**: the parts column marks a part that needs the
  owner (unreachable, a pending request) and its header counts them; the
  count is a toggle that shows only those.
- **The frame measures itself**, not the window: the folders, the rails and
  Maximise change its width. Three columns from 880px, two from 560px, stacked
  below. The text column is the same element in every layout, so a width
  change never remounts the editor and never loses unsaved text; the
  inspector is a portal slot that falls back under the text.

### Detail (deep-link) pages

Start with `<BackLink href>`; title via `<SetPageTitle>`. **Keep these working
as deep links** even after a master-detail supersedes the in-app navigation
(e.g. `/traces/[id]`, `/settings/accounts/[id]/*`), other screens link to them.

### Radius / spacing

`rounded-md` (controls), `rounded-lg` (cards); gaps in multiples of `0.25rem`
(`gap-1.5`, `gap-2`, `space-y-4`).

---

## 9. Tags

- Stored and passed as `string[]` (not comma strings).
- **Edit:** `<TagInput value onChange>`, comma/Enter commits a pill, Backspace
  removes last, paste splits on commas; normalizes lowercase + dedupes.
- **Display:** `<TagPill tag>`, deterministic color from `chart-1..5` via
  `tagColorClass(tag)` (same tag → same color, recolors with the theme).

---

## 10. Markdown

- **Editing:** `<MarkdownEditor>` (toolbar + Edit/Split/Preview + live preview).
- **Rendering:** `ReactMarkdown` + `remarkGfm` inside
  `prose prose-sm dark:prose-invert max-w-none`.
- **Theme-accented prose, add `prose-accent`** next to `prose` to brighten the
  flat black-and-white markdown with theme tokens: `primary-ink` h1/h2/h3 (+ h2
  divider), `info-ink` h4, primary links,
  tinted inline-code chips, accent-bar blockquote, coloured list markers, gradient
  hr. Defined in `globals.css` (one block, all CSS-var driven, recolours with
  every theme × light/dark). It's **opt-in**: docs reader, Notes (read + public
  share), and Pages (editor + read + public) add it; the Pages editor surface is
  `prose` **and** `ProseMirror`, so it also picks up Pages-only `.ProseMirror`
  polish, code-block cards (`--muted` panel + 3px `primary` spine), a `primary`
  caret (which keeps the _transparent_ gradient h1 editable), and a themed text
  selection. Selectors are class+element so they outrank Typography's `:where()`
  rules without `!important`. Don't hand-style headings per-surface, add the class.

---

## 11. Tailwind v4 gotchas

- **No dynamically constructed class names.** The scanner only sees literal
  strings, so `bg-chart-${n}` will NOT generate. Keep a literal array (see
  `tag-pill.tsx`'s `TAG_COLORS`) and index into it.
- Content is auto-detected (no `tailwind.config`); literal classes anywhere in
  source are picked up.
- Opacity modifiers on theme tokens work via `color-mix`, safe to use.

---

## 12. Accessibility

- Icon-only buttons/links need `aria-label`; decorative icons get `aria-hidden`.
- Confirm destructive actions (AlertDialog), don't rely on hover-only controls
  as the sole affordance.
- Respect focus rings (`focus-visible:ring-*` is built into the primitives,
  don't strip it). Clipping one counts as stripping it: a scroll container with
  padding on a single side cuts the ring off at the bare edge (§7a).

---

## 13. Workflow

- **Typecheck before committing:** `pnpm --filter @mantle/web run typecheck`
  (and `--filter @mantle/content` etc. if you touched a shared package).
- Work in a git worktree; auto commit + ff-merge into `main` after each change.
  **Don't push unless asked.** Commit messages end with the project's
  `Co-Authored-By` trailer.
- Remove dead code you replace (unused imports, orphaned components), e.g.
  the old `PageHeader` and `tree-rail` were deleted when superseded.
- Prefer extracting a reusable component (like `BackLink`, `TagPill`) the
  second time a pattern appears, then adopt it everywhere for consistency.

---

## 14. Anti-patterns (don't do these)

- ❌ Hardcoded colors (`#fff`, `text-[oklch(...)]`, `bg-gray-200`), including
  literal `bg-green-600`/`bg-red-600` for approve/deny, use `primary`/`destructive` (§2).
- ❌ Mixing a fill with a foreign foreground, `bg-accent text-foreground`,
  `hover:bg-accent hover:text-foreground`, pair each fill with its own
  `-foreground` (§2). Breaks on light-accent themes.
- ❌ A coloured-`accent` hover on a `bg-sidebar` surface (muddies grey text),
  use a neutral `hover:bg-foreground/[0.06]` (§2).
- ❌ `window.prompt/confirm/alert`.
- ❌ A bare `<Button type="submit">` in a form, a bare "Save"/"Create" label,
  or a "Saving…" text-swap, use `<SubmitButton pending={…}>Save <noun></SubmitButton>` (§6).
- ❌ `mr-1 h-3.5 w-3.5` (or any margin/size) on an icon inside a `<Button>`.
- ❌ Native `<select>`/`<input type=checkbox>` when `Select`/`Checkbox` exist.
- ❌ Inline error banners for transient failures (use toasts).
- ❌ A big on-page `<h1>` duplicating the top-bar page title.
- ❌ Per-theme fonts, or a face outside the registry.
- ❌ A hand-rolled `font-family: var(--font-wordmark)` — use `.wordmark` etc.
- ❌ Putting `.prose-document` on chat, changelog or help markdown: that class is
  for DOCUMENTS (Pages, Notes, their shares, and /print), not for interface prose.
- ❌ Dynamically built Tailwind class names.
- ❌ A flex/grid scroll pane without `min-h-0`, or a master-detail detail pane
  without `relative` (either causes a second, outer scrollbar, see §8).
- ❌ `overflow-y-auto pr-1` on a box holding focusable children: the scroller
  clips sideways too and shears the focus ring off the open edge, use
  `-mx-1 px-1` (§7a).
- ❌ `text-[10px]`/`text-[11px]` for normal list/table text (use `text-xs`+).
- ❌ The Enabled toggle buried in the form body on a master-detail editor; it
  goes top-right in the header as a `Switch`.
- ❌ A source or state switch above a list (Mine / Team drafts / Library,
  Brain / Private) that hides items until the reader picks one, or a list that
  preselects a source. One list of everything, the state as a pill on the
  card, a quiet State filter (§8, "The item list kit").
- ❌ A hand-rolled list header, card, filter row or pager on a list screen:
  compose `components/item-list/` (§8).
