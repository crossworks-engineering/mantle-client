'use client';

import type { ReactNode } from 'react';
import { FolderOpen, Plus, X } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@mantle/web-ui/ui/dropdown-menu';
import { RadioGroup, RadioGroupItem } from '@mantle/web-ui/ui/radio-group';
import { Switch } from '@mantle/web-ui/ui/switch';
import { cn } from '@mantle/web-ui/lib/utils';
// Relative, not '@/': the node test runner renders this (grant-access-view.test.ts).
import {
  APP_MCP_HINT,
  APP_MCP_LABEL,
  GRANT_COLUMNS,
  HOME_ADD_FIRST_TEXT,
  NO_ADDABLE_TEXT,
  READ_ONLY_PANEL_TEXT,
  embedsLine,
  rowActionsFor,
  rowControlTitles,
  rowNote,
  sortAddable,
  sortRows,
  writeLabel,
  type GrantRow,
  type GrantsView,
} from '../../lib/grants';
import type { LookSource } from '../../lib/workspace-look';
import { WorkspaceTile } from '../workspaces/workspace-tile';

export type GrantAccessHandlers = {
  onWrite: (row: GrantRow, write: boolean) => void;
  onRemove: (row: GrantRow) => void;
  onRestore: (row: GrantRow) => void;
  /** "Change here": a folder row becomes the item's own. */
  onHand: (row: GrantRow) => void;
  onAdd: (ws: { wsId: string; name: string }) => void;
  /** Asks to move the item to another workspace (a Home pick). The host
   *  confirms first, naming the new home; nothing moves before that. */
  onMove: (ws: { wsId: string; name: string }) => void;
  onGrantEmbeds: () => void;
  onMcpAccess: (on: boolean) => void;
};

/** One grid for the header and every row, so the columns line up whatever
 *  a row can do: name, Home, Writable, Revoke. */
export const GRANT_GRID =
  'grid grid-cols-[minmax(0,1fr)_2.75rem_3.5rem_2.75rem] items-center gap-x-1';

/** A disabled control's reason, read by a screen reader through the
 *  control's aria-describedby. Nothing when the control may be used. */
function WhyOff({ id, text }: { id: string; text: string | null }) {
  return text ? (
    <span id={id} className="sr-only">
      {text}
    </span>
  ) : null;
}

/**
 * The Grant Access panel's body (plan 7.1): the item's workspaces, one row
 * each in four columns under a header (name with "Via folder X" and "Change
 * here", or "Removed here" with Restore; the Home radio; the Writable
 * switch; Revoke), "Add workspace" over the workspaces the user moderates,
 * the embeds not granted where the item is (with "Grant these too"), and on
 * an app its MCP access. A control the user cannot use stays in its column,
 * dimmed, with why as its tooltip; a user who may not manage reads the same
 * columns with every control off. Pure: the host loads, confirms and writes.
 */
export function GrantAccessView({
  view,
  busy,
  adminWsId,
  type,
  hint,
  link,
  moderated,
  looks,
  mcpSwitch = true,
  ...on
}: {
  view: GrantsView;
  busy: boolean;
  /** The Admin workspace, offered first to an Admin user (21.8). */
  adminWsId: string | null;
  /** The item's kind, when known ('app' words its Writable switch). */
  type?: string;
  hint?: string;
  /** The open link and the contact shares, under the rows (8.1, kept). */
  link?: ReactNode;
  /** The workspaces this user moderates: a row there may be revoked, or
   *  its Write turned off, without managing the item (contract 10). */
  moderated?: ReadonlySet<string>;
  /** Each workspace's look (colour and icon) by id: its tile starts the
   *  row. A workspace the client does not know draws the neutral default. */
  looks?: ReadonlyMap<string, LookSource>;
  /** Whether an app's MCP access shows here: an Admin user only (W6b fix
   *  round: the brain answers 403 admin-only to anyone else). Hidden for
   *  any other login. */
  mcpSwitch?: boolean;
} & GrantAccessHandlers) {
  const manage = view.mayManage;
  const rows = sortRows(view.rows);
  const addable = sortAddable(view.addable, adminWsId);
  const embeds = view.embedsNotGranted;
  const homeWsId = rows.find((r) => r.isHome)?.wsId ?? '';

  // The radio stays on the current home: a pick only asks the host to move
  // (it confirms first), and the rows come back with the new home once moved.
  const pickHome = (wsId: string) => {
    const row = rows.find((r) => r.wsId === wsId);
    if (!row || busy) return;
    if (!rowActionsFor(row, manage, moderated?.has(row.wsId) === true).move) return;
    on.onMove({ wsId: row.wsId, name: row.name });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-sm font-medium">Who can see this</p>
        {!manage && <p className="text-xs text-muted-foreground">{READ_ONLY_PANEL_TEXT}</p>}
        {/* One radio group over the rows, the Home column. An arrow key picks
            the next row, as on any radio group; a pick only opens the single
            move confirm (pickHome), and nothing moves before its Move button. */}
        <RadioGroup
          value={homeWsId}
          onValueChange={pickHome}
          aria-label={GRANT_COLUMNS.home}
          className="gap-1"
        >
          <div
            aria-hidden
            data-testid="grant-columns"
            className={cn(
              GRANT_GRID,
              // The rows' border width, unseen, so the columns line up to the pixel.
              'border border-transparent px-2.5 text-xs text-muted-foreground',
            )}
          >
            <span />
            <span className="text-center">{GRANT_COLUMNS.home}</span>
            <span className="text-center">{GRANT_COLUMNS.write}</span>
            <span className="text-center">{GRANT_COLUMNS.revoke}</span>
          </div>
          <ul aria-label="Workspaces" className="space-y-1.5">
            {rows.map((row) => {
              const can = rowActionsFor(row, manage, moderated?.has(row.wsId) === true);
              const titles = rowControlTitles(row, can, manage, type);
              const note = rowNote(row);
              // Why a control is off, for a screen reader as for the pointer
              // (its title): each disabled control is described by its reason.
              // Busy alone gives none: it passes. The home row's radio is
              // labelled by its reason already.
              const why = `grant-${view.item.id}-${row.wsId}`;
              const homeWhy = !row.isHome && !can.move ? titles.home : null;
              const writeWhy = can.write ? null : titles.write;
              const revokeWhy = can.remove ? null : titles.revoke;
              return (
                <li
                  key={row.wsId}
                  data-testid="grant-row"
                  className={cn(GRANT_GRID, 'rounded-md border border-border px-2.5 py-1.5')}
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <WorkspaceTile
                      workspace={looks?.get(row.wsId)}
                      size="sm"
                      className={cn('mt-px', row.excluded && 'opacity-50')}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={
                          row.excluded
                            ? 'truncate text-sm text-muted-foreground line-through'
                            : 'truncate text-sm'
                        }
                      >
                        {row.name}
                      </p>
                      {(note || can.changeHere || can.restore) && (
                        <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                          {note && (
                            <span className="flex min-w-0 items-center gap-1">
                              {row.viaFolder && (
                                <FolderOpen className="size-3 shrink-0" aria-hidden />
                              )}
                              <span className="min-w-0 truncate">{note}</span>
                            </span>
                          )}
                          {can.changeHere && (
                            <Button
                              size="2xs"
                              variant="ghost"
                              className="shrink-0"
                              disabled={busy}
                              onClick={() => on.onHand(row)}
                            >
                              Change here
                            </Button>
                          )}
                          {can.restore && (
                            <Button
                              size="2xs"
                              variant="outline"
                              className="shrink-0"
                              disabled={busy}
                              onClick={() => on.onRestore(row)}
                            >
                              Restore
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Each control's tooltip sits on its cell: a disabled
                      control takes no pointer. */}
                  <span className="flex justify-center" title={titles.home}>
                    <RadioGroupItem
                      value={row.wsId}
                      disabled={busy || !(row.isHome ? manage : can.move)}
                      aria-label={row.isHome ? titles.home : `Make ${row.name} the home`}
                      aria-describedby={homeWhy ? `${why}-home-why` : undefined}
                    />
                    <WhyOff id={`${why}-home-why`} text={homeWhy} />
                  </span>
                  <span className="flex justify-center" title={titles.write}>
                    <Switch
                      checked={!row.excluded && row.write}
                      disabled={busy || !can.write}
                      onCheckedChange={(v) => on.onWrite(row, v)}
                      aria-label={writeLabel(type, row.name)}
                      aria-describedby={writeWhy ? `${why}-write-why` : undefined}
                    />
                    <WhyOff id={`${why}-write-why`} text={writeWhy} />
                  </span>
                  <span className="flex justify-center" title={titles.revoke}>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive-ink"
                      disabled={busy || !can.remove}
                      onClick={() => on.onRemove(row)}
                      aria-label={`Revoke ${row.name}`}
                      aria-describedby={revokeWhy ? `${why}-revoke-why` : undefined}
                    >
                      <X />
                    </Button>
                    <WhyOff id={`${why}-revoke-why`} text={revokeWhy} />
                  </span>
                </li>
              );
            })}
          </ul>
        </RadioGroup>
        {manage &&
          (addable.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy}>
                  <Plus />
                  Add workspace
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Share with</DropdownMenuLabel>
                {addable.map((w) => (
                  <DropdownMenuItem key={w.wsId} onSelect={() => on.onAdd(w)}>
                    {w.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <p className="text-xs text-muted-foreground">{NO_ADDABLE_TEXT}</p>
          ))}
        {manage && addable.length > 0 && (
          <p className="text-xs text-muted-foreground">{HOME_ADD_FIRST_TEXT}</p>
        )}
      </div>

      {embeds.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">{embedsLine(embeds.length)}</p>
          <ul className="scrollbar-thin scrollbar-hair max-h-28 space-y-0.5 overflow-y-auto text-xs">
            {embeds.map((e) => (
              <li key={e.nodeId} className="flex min-w-0 justify-between gap-2">
                <span className="min-w-0 truncate">{e.title || 'Untitled'}</span>
                <span className="shrink-0 text-muted-foreground">{e.kind}</span>
              </li>
            ))}
          </ul>
          {manage && (
            <Button size="sm" variant="outline" disabled={busy} onClick={on.onGrantEmbeds}>
              Grant these too
            </Button>
          )}
        </div>
      )}

      {view.app && mcpSwitch && (
        <div className="flex items-start justify-between gap-3 border-t border-border pt-3">
          <div className="min-w-0">
            <p className="text-sm">{APP_MCP_LABEL}</p>
            <p className="text-xs text-muted-foreground">{APP_MCP_HINT}</p>
          </div>
          {manage ? (
            <Switch
              checked={view.app.mcpAccess}
              disabled={busy}
              onCheckedChange={on.onMcpAccess}
              aria-label="MCP access"
            />
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground">
              {view.app.mcpAccess ? 'On' : 'Off'}
            </span>
          )}
        </div>
      )}

      {link}

      {hint && manage && (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
