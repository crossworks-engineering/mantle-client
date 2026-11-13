'use client';

import { useState, type ReactNode } from 'react';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@mantle/web-ui/ui/dropdown-menu';

/** One tab's look, chosen or not: the Tables tab bar's, and any extra tab a
 *  caller adds after them. */
export function tabClass(active: boolean): string {
  return (
    'flex items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-3 py-1.5 text-sm transition-colors ' +
    (active
      ? 'border-primary font-medium text-foreground'
      : 'border-transparent text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground')
  );
}

/** The workbook tab bar (v2.1 P5): switch, add, rename (double-click or menu),
 *  delete. Every change lands on the DRAFT — Discard reverts, Commit
 *  publishes. `readOnly` (app-bound tables) keeps switching and drops the
 *  add/rename/delete affordances — tab structure belongs to the app.
 *
 *  Shared with the file database viewer in Files (read only): `counts` puts
 *  each tab's row count beside its name, and `trailing` adds one more tab of
 *  the caller's at the end, drawn with `tabClass` so it looks the same. */
export function TabBar({
  tabs,
  activeTab,
  switching,
  readOnly = false,
  onSwitch,
  onAdd,
  onRename,
  onDelete,
  counts = false,
  label = 'Workbook tabs',
  trailing,
}: {
  tabs: { id: string; name: string; rows: number }[];
  activeTab: string | undefined;
  switching: boolean;
  readOnly?: boolean;
  onSwitch: (id: string) => void;
  onAdd?: () => void;
  onRename?: (id: string, name: string) => void;
  onDelete?: (id: string) => void;
  counts?: boolean;
  label?: string;
  trailing?: ReactNode;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const finishRename = (id: string) => {
    const name = editName.trim();
    setEditing(null);
    const current = tabs.find((t) => t.id === id);
    if (name && current && name !== current.name) onRename?.(id, name);
  };
  return (
    <div
      className="flex items-center gap-0.5 overflow-x-auto scrollbar-thin border-b border-border bg-muted/30 px-2"
      role="tablist"
      aria-label={label}
    >
      {tabs.map((t) => {
        const active = t.id === activeTab;
        return (
          <span key={t.id} className="group flex items-center">
            {editing === t.id ? (
              // The `xs` rung puts this at 32px against the 34px the tabs beside
              // it measure (`text-sm` on `py-1.5`, plus their 2px bottom border),
              // so the strip shifts by 2px on a rename where the old h-7 field
              // shifted it by 6. The raw field it replaces also suppressed its own
              // focus ring while being the only thing on screen that takes keys.
              <Input
                size="xs"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => finishRename(t.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditing(null);
                }}
                className="mx-1 w-28 focus-visible:ring-inset focus-visible:ring-offset-0"
                aria-label={`Rename tab ${t.name}`}
                autoFocus
              />
            ) : (
              <RowButton
                role="tab"
                aria-selected={active}
                disabled={switching}
                onClick={() => onSwitch(t.id)}
                onDoubleClick={
                  readOnly
                    ? undefined
                    : () => {
                        setEditing(t.id);
                        setEditName(t.name);
                      }
                }
                className={tabClass(active)}
                title={
                  readOnly
                    ? `${t.name} — ${t.rows.toLocaleString()} rows`
                    : `${t.name} — ${t.rows.toLocaleString()} rows (double-click to rename)`
                }
              >
                {t.name}
                {counts && (
                  <span className="text-xs font-normal tabular-nums text-muted-foreground">
                    {t.rows.toLocaleString()}
                  </span>
                )}
              </RowButton>
            )}
            {readOnly ? null : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6 text-muted-foreground opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                    aria-label={`Tab options: ${t.name}`}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onClick={() => {
                      setEditing(t.id);
                      setEditName(t.name);
                    }}
                  >
                    <Pencil className="mr-2 size-3.5" /> Rename tab
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive-ink focus:text-destructive-ink"
                    disabled={tabs.length <= 1}
                    onClick={() => onDelete?.(t.id)}
                  >
                    <Trash2 className="mr-2 size-3.5" /> Delete tab
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </span>
        );
      })}
      {trailing}
      {!readOnly && (
        <Button
          size="icon"
          variant="ghost"
          className="size-7 shrink-0 text-muted-foreground"
          onClick={onAdd}
          disabled={switching}
          aria-label="Add tab"
        >
          <Plus className="size-4" />
        </Button>
      )}
    </div>
  );
}
