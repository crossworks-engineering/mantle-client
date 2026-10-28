'use client';

import { Fragment, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useToast } from '@mantle/web-ui/ui/toast';
import { copyText } from '@mantle/web-ui/lib/secure-context-fallbacks';
import { requestTreeMove, type TreeMoveRequest } from '@/components/item-tree/tree-move-request';
import {
  Check,
  ChevronLeft,
  Copy,
  FolderInput,
  Info,
  Link2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@mantle/web-ui/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@mantle/web-ui/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@mantle/web-ui/ui/popover';
import { TagPill } from '@mantle/web-ui/tag-pill';
import { cn } from '@mantle/web-ui/lib/utils';
import { FocusToggle } from './focus-toggle';
import { useHeaderOverflow } from './header-overflow';
import { useZenMode } from './zen-mode';

/** How long a closing menu takes to hand focus back to its trigger: a
 *  popover opened before that would take the focus move as a click outside
 *  and close. */
export const MENU_CLOSED_MS = 250;

/** One choice of a tool that has several (Download: Markdown, Word, PDF). */
export type HeaderToolChoice = {
  key: string;
  label: string;
  icon?: ReactNode;
  /** A link (a download is a plain anchor), or… */
  href?: string;
  download?: boolean;
  /** …an action, or… */
  onSelect?: () => void;
  /** …a small panel of its own under the tool's button (Download: the PDF's
   *  print options), opened once the menu has closed; `close` shuts it. */
  panel?: (close: () => void) => ReactNode;
};

/** A kind's own tool in the header: an icon button while it fits, a More
 *  menu entry once the pane is too narrow for it. */
export type HeaderTool = {
  key: string;
  /** Its name: the aria-label, the tooltip and the More menu entry. */
  label: string;
  icon: ReactNode;
  href?: string;
  /** With `href`: a download, under this file name. */
  download?: string;
  onSelect?: () => void;
  /** A menu inline, a sub-menu once folded into More. */
  choices?: HeaderToolChoice[];
  /** An on/off view switch (Pan and zoom): pressed while on. */
  pressed?: boolean;
  /** Shown but not usable now; `label` should say why. */
  disabled?: boolean;
};

/** A More menu entry that never sits inline (Duplicate, Move to folder). */
export type HeaderMoreItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
};

/** The Edit slot: the pencil right of Focus, left of More. */
export type HeaderEdit = {
  /** The editor's route, or… */
  href?: string;
  /** …an in-place switch. */
  onSelect?: () => void;
  /** The login may not edit it: the pencil stays in its slot, greyed, so
   *  nothing beside it moves. */
  disabled?: boolean;
  /** On while editing (an in-place editor). */
  pressed?: boolean;
  label?: string;
};

/** What the Info popover holds: everything about the item that is not its
 *  title. Nothing of it sits under the title. */
export type HeaderInfo = {
  description?: ReactNode;
  /** The folders it sits in, outermost first. */
  path?: string[];
  tags?: string[];
  /** Further lines: Updated, Created, Level, a read-only note. */
  rows?: { label: string; value: ReactNode }[];
};

/** The one state pill beside a title (`v12`, `uncommitted`), the shape of
 *  the list's `StatePill`. */
export function HeaderPill({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center rounded-full border border-muted-foreground/40 px-2 py-0.5 text-[11px] font-medium leading-4 text-muted-foreground"
    >
      {children}
    </span>
  );
}

/**
 * THE header of every item's detail pane (item header contract, 2026-10-21):
 * ONE row of 44px (2.75rem: it grows with the reader's text size, as the
 * title's 15px, 0.9375rem, does), read and edit mode alike. No second row, no banner: what
 * is not the title goes behind Info.
 *
 * Left: the glyph inside the `h2`, the title at 15px on every kind (cut to
 * fit), at most one state pill. While the shell is maximised, ONE back link
 * before them ("‹ Pages") brings the folders back and keeps the item open.
 *
 * Right, counted from the right edge and the same on every kind and mode:
 * More (⋯) first, Edit (the pencil) second, Delete third, Focus fourth,
 * Info fifth, Access sixth. To their left the kind's tools, then the word
 * buttons (Commit, Done, New ▾, Upload). Tools stay inline while they fit
 * and fold into More from the end as the pane narrows; the word buttons and
 * the fixed slots never fold.
 *
 * A screen not yet moved to the slots passes `iconActions` (its own icon
 * group) instead; it renders where the fixed slots would.
 */
export function ItemHeader({
  lead,
  visual,
  title,
  badges,
  subtitle,
  textActions,
  section,
  access,
  tools = [],
  onDelete,
  deleteLabel = 'Delete',
  deleteDisabled = false,
  info,
  infoLabel = 'About this',
  focus = true,
  edit,
  more = [],
  move,
  onDuplicate,
  iconActions,
  actionsLabel = 'Actions',
  sticky = false,
  testIds,
}: {
  /** Before the title, outside the `h2`: a control that is not part of the
   *  name (a task's done box), or a way back on a screen not moved to
   *  `section` yet. Stays beside the back link while maximised. */
  lead?: ReactNode;
  /** The glyph: an icon, an emoji, a tile. */
  visual?: ReactNode;
  title: ReactNode;
  /** After the title: the one state pill (`HeaderPill`). */
  badges?: ReactNode;
  /** A short line beside the title (a screen not moved to Info yet). */
  subtitle?: ReactNode;
  /** Word buttons, at most two: the current mode's primary verbs
   *  (Commit and Done; New ▾ and Upload). Edit is the pencil slot, not a
   *  word button. */
  textActions?: ReactNode;
  /** The section the maximised back link names ("Pages"). */
  section?: string;
  /** The Access slot: a `GrantAccessControl` with `stackOf`. */
  access?: ReactNode;
  tools?: HeaderTool[];
  /** The Delete slot, just left of Edit. Confirms on the caller's side (an
   *  AlertDialog). */
  onDelete?: () => void;
  deleteLabel?: string;
  /** The login may not delete it: the bin stays in its slot, greyed. */
  deleteDisabled?: boolean;
  info?: HeaderInfo;
  infoLabel?: string;
  /** The Focus slot (on unless the screen has no folders to hide). */
  focus?: boolean;
  /** The Edit slot; leave it out on a kind with no editor. */
  edit?: HeaderEdit;
  /** More entries that never sit inline. */
  more?: HeaderMoreItem[];
  /** "Move to folder…": the tree of this kind opens its Move dialog. */
  move?: TreeMoveRequest | null;
  /** "Duplicate" (a kind with a copy route: apps). */
  onDuplicate?: () => void;
  /** A screen's own icon group, in place of the fixed slots. */
  iconActions?: ReactNode;
  /** The icon group's accessible name. */
  actionsLabel?: string;
  /** Stays at the top while the pane under it scrolls. */
  sticky?: boolean;
  /** The test hooks a screen already pins (the Apps pane's). */
  testIds?: { root?: string; text?: string; icons?: string };
}) {
  const { zen, toggle } = useZenMode();
  const rowRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const fixedRef = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLDivElement>(null);

  const fit = useHeaderOverflow(rowRef, [textRef, fixedRef, leadRef], tools.length);
  const inline = tools.slice(0, fit);
  const toast = useToast();
  // Open a fixed slot's own control (Access, Info) from the More menu, once
  // the menu has closed and handed focus back.
  // The menu hands focus back to its trigger as it closes; a popover opened
  // before that would take the focus move as a click outside and close.
  const openSlot = (slot: 'access' | 'info') =>
    setTimeout(() => {
      fixedRef.current?.querySelector<HTMLElement>(`[data-slot="${slot}"] button`)?.click();
    }, MENU_CLOSED_MS);
  const moreGroups: MoreEntry[][] = [
    [
      ...(edit && !edit.disabled
        ? [
            edit.href
              ? ({
                  kind: 'link',
                  key: 'edit',
                  label: edit.label ?? 'Edit',
                  icon: <Pencil />,
                  href: edit.href,
                } as MoreEntry)
              : ({
                  kind: 'action',
                  key: 'edit',
                  label: edit.label ?? 'Edit',
                  icon: <Pencil />,
                  onSelect: () => edit.onSelect?.(),
                } as MoreEntry),
          ]
        : []),
      ...tools.map((t): MoreEntry => ({ kind: 'tool', key: t.key, label: t.label, tool: t })),
    ],
    [
      {
        kind: 'action',
        key: 'copy-link',
        label: 'Copy link',
        icon: <Link2 />,
        onSelect: () =>
          void copyText(itemLink()).then((ok) =>
            ok ? toast.success('Link copied') : toast.error('Could not copy the link'),
          ),
      },
      ...(onDuplicate
        ? [
            {
              kind: 'action',
              key: 'duplicate',
              label: 'Duplicate',
              icon: <Copy />,
              onSelect: onDuplicate,
            } as MoreEntry,
          ]
        : []),
      ...(move
        ? [
            {
              kind: 'action',
              key: 'move',
              label: 'Move to folder…',
              icon: <FolderInput />,
              onSelect: () => setTimeout(() => requestTreeMove(move), 50),
            } as MoreEntry,
          ]
        : []),
      ...more.map((m): MoreEntry => ({
        kind: 'action',
        key: m.key,
        label: m.label,
        icon: m.icon,
        onSelect: m.onSelect,
      })),
    ],
    [
      ...(access
        ? [
            {
              kind: 'action',
              key: 'access',
              label: 'Access…',
              icon: <Share2 />,
              onSelect: () => openSlot('access'),
            } as MoreEntry,
          ]
        : []),
      ...(info
        ? [
            {
              kind: 'action',
              key: 'info',
              label: `${infoLabel}…`,
              icon: <Info />,
              onSelect: () => openSlot('info'),
            } as MoreEntry,
          ]
        : []),
      ...(focus
        ? [
            {
              kind: 'action',
              key: 'focus',
              label: zen ? 'Show the folders' : 'Maximise: hide the folders',
              icon: zen ? <Minimize2 /> : <Maximize2 />,
              onSelect: toggle,
            } as MoreEntry,
          ]
        : []),
    ],
    onDelete || deleteDisabled
      ? [
          {
            kind: 'action',
            key: 'delete',
            label: deleteLabel,
            icon: <Trash2 />,
            danger: true,
            disabled: deleteDisabled,
            onSelect: () => onDelete?.(),
          } as MoreEntry,
        ]
      : [],
  ];
  const slots = iconActions === undefined;

  return (
    <div
      ref={rowRef}
      data-testid={testIds?.root ?? 'item-header'}
      className={cn(
        'flex min-h-11 items-center gap-3 border-b border-border px-4 py-1',
        slots ? 'h-11 flex-nowrap' : 'flex-wrap',
        sticky && 'sticky top-0 z-10 bg-background/60 backdrop-blur',
      )}
    >
      {zen && section ? (
        <div ref={leadRef} className="flex shrink-0 items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="-ml-1 pl-1.5"
            onClick={toggle}
            aria-label={`Back to ${section} (Esc)`}
            title="Show the folders again (Esc)"
            data-testid="item-header-back"
          >
            <ChevronLeft />
            {section}
          </Button>
          <span aria-hidden className="h-5 w-px bg-border" />
          {lead}
        </div>
      ) : lead ? (
        <div ref={leadRef} className="flex shrink-0 items-center">
          {lead}
        </div>
      ) : null}
      <h2 className="flex min-w-0 flex-1 items-center gap-2 text-[0.9375rem] font-semibold leading-tight">
        {visual ? (
          <span className="inline-flex shrink-0 items-center text-muted-foreground">{visual}</span>
        ) : null}
        <span className="min-w-0 truncate">{title}</span>
        {badges}
        {subtitle ? (
          <span className="min-w-0 flex-1 truncate text-sm font-normal text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </h2>
      {textActions ? (
        <div
          ref={textRef}
          data-testid={testIds?.text ?? 'item-header-text-actions'}
          className="flex shrink-0 items-center gap-2"
        >
          {textActions}
        </div>
      ) : null}
      {slots ? (
        <div
          role="group"
          aria-label={actionsLabel}
          data-testid={testIds?.icons ?? 'item-header-icon-actions'}
          className="flex shrink-0 items-center gap-1"
        >
          {inline.map((t) => (
            <InlineTool key={t.key} tool={t} />
          ))}
          <div ref={fixedRef} className="flex items-center gap-1" data-testid="item-header-slots">
            {access ? <span data-slot="access">{access}</span> : null}
            {info ? (
              <span data-slot="info">
                <HeaderInfoButton label={infoLabel}>
                  <InfoBody info={info} />
                </HeaderInfoButton>
              </span>
            ) : null}
            {focus ? (
              <span data-slot="focus">
                <FocusToggle />
              </span>
            ) : null}
            {onDelete || deleteDisabled ? (
              <span data-slot="delete">
                <HeaderIconButton
                  label={deleteLabel}
                  tooltip={deleteDisabled ? 'You may not delete this' : deleteLabel}
                  disabled={deleteDisabled}
                  onClick={onDelete}
                  className="text-muted-foreground hover:text-destructive-ink"
                >
                  <Trash2 />
                </HeaderIconButton>
              </span>
            ) : null}
            {edit ? (
              <span data-slot="edit">
                <EditButton edit={edit} />
              </span>
            ) : null}
            <span data-slot="more">
              <MoreMenu groups={moreGroups} />
            </span>
          </div>
        </div>
      ) : (
        <div
          role="group"
          aria-label={actionsLabel}
          data-testid={testIds?.icons ?? 'item-header-icon-actions'}
          className="flex shrink-0 items-center gap-1"
        >
          {iconActions}
        </div>
      )}
    </div>
  );
}

function EditButton({ edit }: { edit: HeaderEdit }) {
  const label = edit.label ?? 'Edit';
  if (edit.disabled) {
    return (
      <HeaderIconButton
        label={label}
        // A kind that says why it is greyed (Present: ask Presenter) says it
        // here too; otherwise the read-only reason.
        tooltip={
          edit.label && edit.label !== 'Edit' ? edit.label : 'You can read this, not edit it'
        }
        disabled
      >
        <Pencil />
      </HeaderIconButton>
    );
  }
  if (edit.href) {
    return (
      <HeaderIconButton
        label={label}
        asChild
        aria-pressed={edit.pressed}
        className={cn(edit.pressed && 'bg-accent text-accent-foreground')}
      >
        <Link href={edit.href}>
          <Pencil />
        </Link>
      </HeaderIconButton>
    );
  }
  return (
    <HeaderIconButton
      label={label}
      onClick={edit.onSelect}
      aria-pressed={edit.pressed}
      className={cn(edit.pressed && 'bg-accent text-accent-foreground')}
    >
      <Pencil />
    </HeaderIconButton>
  );
}

/**
 * A choice's panel, as a popover under the button that held the menu (the
 * `PopoverAnchor`): the tool's own icon inline, More once folded. One open
 * at a time; the choice names it after the menu has closed (see
 * `MENU_CLOSED_MS`).
 */
function useChoicePanel(choices: HeaderToolChoice[]) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = choices.find((c) => c.key === openKey && c.panel) ?? null;
  const close = () => setOpenKey(null);
  const show = (key: string) => setTimeout(() => setOpenKey(key), MENU_CLOSED_MS);
  return { open, close, show };
}

function ChoicePanel({
  open,
  close,
  children,
}: {
  open: HeaderToolChoice | null;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <Popover open={open !== null} onOpenChange={(o) => !o && close()}>
      {children}
      {open?.panel ? (
        <PopoverContent align="end" className="w-80" aria-label={open.label}>
          {open.panel(close)}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function InlineTool({ tool }: { tool: HeaderTool }) {
  const panel = useChoicePanel(tool.choices ?? []);
  if (tool.choices) {
    return (
      <ChoicePanel open={panel.open} close={panel.close}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <PopoverAnchor asChild>
              <HeaderIconButton label={tool.label}>{tool.icon}</HeaderIconButton>
            </PopoverAnchor>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {tool.choices.map((c) => (
              <ChoiceItem key={c.key} choice={c} onPanel={panel.show} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </ChoicePanel>
    );
  }
  if (tool.href) {
    return (
      <HeaderIconButton label={tool.label} asChild>
        <a href={tool.href} download={tool.download}>
          {tool.icon}
        </a>
      </HeaderIconButton>
    );
  }
  return (
    <HeaderIconButton
      label={tool.label}
      onClick={tool.onSelect}
      disabled={tool.disabled}
      aria-pressed={tool.pressed}
      className={cn(tool.pressed && 'bg-accent text-accent-foreground')}
    >
      {tool.icon}
    </HeaderIconButton>
  );
}

function ChoiceItem({
  choice,
  onPanel,
}: {
  choice: HeaderToolChoice;
  onPanel: (key: string) => void;
}) {
  if (choice.panel) {
    return (
      <DropdownMenuItem onSelect={() => onPanel(choice.key)}>
        {choice.icon}
        {choice.label}…
      </DropdownMenuItem>
    );
  }
  if (choice.href) {
    return (
      <DropdownMenuItem asChild>
        <a href={choice.href} download={choice.download || undefined}>
          {choice.icon}
          {choice.label}
        </a>
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem onSelect={choice.onSelect}>
      {choice.icon}
      {choice.label}
    </DropdownMenuItem>
  );
}

/** One More menu entry. */
type MoreEntry = { key: string; label: string; icon?: ReactNode; danger?: boolean } & (
  | { kind: 'tool'; tool: HeaderTool }
  | { kind: 'link'; href: string }
  | { kind: 'action'; onSelect: () => void; disabled?: boolean }
);

/**
 * The More slot (Jason, 2026-10-21): ALWAYS every action the item has, the
 * ones shown as icons too, so it is never empty and is the one place that
 * lists them all. In groups: edit and the kind's tools; the item itself
 * (Copy link, Duplicate, Move to folder, the screen's extras); the fixed
 * slots by name (Access, Info, maximise); Delete last, in red.
 */
function MoreMenu({ groups }: { groups: MoreEntry[][] }) {
  const shown = groups.filter((g) => g.length > 0);
  const panel = useChoicePanel(
    groups.flatMap((g) => g.flatMap((e) => (e.kind === 'tool' ? (e.tool.choices ?? []) : []))),
  );
  return (
    <ChoicePanel open={panel.open} close={panel.close}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PopoverAnchor asChild>
            <HeaderIconButton label="More" tooltip="Every action for this item">
              <MoreHorizontal />
            </HeaderIconButton>
          </PopoverAnchor>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {shown.map((group, gi) => (
            <Fragment key={gi}>
              {gi > 0 ? <DropdownMenuSeparator /> : null}
              {group.map((e) => (
                <MoreItem key={e.key} entry={e} onPanel={panel.show} />
              ))}
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </ChoicePanel>
  );
}

function MoreItem({ entry: e, onPanel }: { entry: MoreEntry; onPanel: (key: string) => void }) {
  const cls = e.danger ? 'text-destructive-ink focus:text-destructive-ink' : undefined;
  if (e.kind === 'link') {
    return (
      <DropdownMenuItem asChild className={cls}>
        <Link href={e.href}>
          {e.icon}
          {e.label}
        </Link>
      </DropdownMenuItem>
    );
  }
  if (e.kind === 'action') {
    return (
      <DropdownMenuItem onSelect={e.onSelect} disabled={e.disabled} className={cls}>
        {e.icon}
        {e.label}
      </DropdownMenuItem>
    );
  }
  const t = e.tool;
  if (t.choices) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          {t.icon}
          {t.label}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {t.choices.map((c) => (
            <ChoiceItem key={c.key} choice={c} onPanel={onPanel} />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }
  if (t.href) {
    return (
      <DropdownMenuItem asChild>
        <a href={t.href} download={t.download}>
          {t.icon}
          {t.label}
        </a>
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem onSelect={t.onSelect} disabled={t.disabled}>
      {t.icon}
      {t.label}
      {t.pressed ? <Check className="ml-auto" /> : null}
    </DropdownMenuItem>
  );
}

/** The address of the open item, without its edit mode: what Copy link
 *  copies, so a link always opens the item to read. */
function itemLink(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete('edit');
  return url.toString();
}

function InfoBody({ info }: { info: HeaderInfo }) {
  const rows: { label: string; value: ReactNode }[] = [];
  if (info.path) rows.push({ label: 'Location', value: info.path.join(' / ') || 'Top level' });
  if (info.tags && info.tags.length > 0) {
    rows.push({
      label: 'Tags',
      value: (
        <span className="flex flex-wrap gap-1">
          {info.tags.map((t) => (
            <TagPill key={t} tag={t} />
          ))}
        </span>
      ),
    });
  }
  rows.push(...(info.rows ?? []));
  return (
    <div className="space-y-3">
      {info.description ? <div className="text-foreground">{info.description}</div> : null}
      {rows.length > 0 ? (
        <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
          {rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="min-w-0 text-foreground">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** An icon-only header button: its name is both the aria-label and the
 *  tooltip, so the icon is never the only way to know what it does. */
export function HeaderIconButton({
  label,
  tooltip,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, 'aria-label' | 'title' | 'size'> & {
  label: string;
  /** A longer tooltip than the name, when it helps. */
  tooltip?: string;
}) {
  return (
    <Button size="icon-sm" variant="ghost" aria-label={label} title={tooltip ?? label} {...props}>
      {children}
    </Button>
  );
}

/** The icon-only Info button: what does not fit the one header row, in a
 *  small popover. */
export function HeaderInfoButton({
  label = 'About this',
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <HeaderIconButton label={label}>
          <Info />
        </HeaderIconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2 text-sm">
        {children}
      </PopoverContent>
    </Popover>
  );
}
