'use client';

import { useState } from 'react';
import { LayoutGrid, Pin, RotateCcw, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mantle/web-ui/ui/alert-dialog';
import { Button } from '@mantle/web-ui/ui/button';
import { Label } from '@mantle/web-ui/ui/label';
import { Slider } from '@mantle/web-ui/ui/slider';
import { Switch } from '@mantle/web-ui/ui/switch';
import type { TreeKind } from '@mantle/web-ui/types/tree';
import { cn } from '@mantle/web-ui/lib/utils';
import {
  DESK_TOOLS,
  KIND_COUNT_MAX,
  KIND_COUNT_MIN,
  KIND_LABELS,
  TOOL_LABELS,
  addWidget,
  countFor,
  removeWidget,
  tidy,
  type DeskPrefs,
  type DeskWidgetId,
} from '@/lib/home-desk';
import { KIND_ICONS } from './widgets/items';
import { TOOL_ICONS } from './desk-tools';

/**
 * The desk's settings, beside it on the right so every change shows on the
 * desk as it is made: which kinds of workspace items sit on it and how many
 * of each (pins count first), whether pins are desk icons, and the tools.
 * Switching something on puts it in the first free spot; off takes it away.
 */
export function DeskSettings({
  prefs,
  kinds,
  onChange,
  onReset,
  onClose,
  className,
}: {
  prefs: DeskPrefs;
  kinds: readonly TreeKind[];
  onChange: (fn: (p: DeskPrefs) => DeskPrefs) => void;
  onReset: () => void;
  onClose: () => void;
  className?: string;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const on = (id: DeskWidgetId) => prefs.items.some((i) => i.id === id);
  const toggle = (id: DeskWidgetId, next: boolean) =>
    onChange((p) => ({
      ...p,
      items: next ? addWidget(p.items, id) : removeWidget(p.items, id),
    }));

  return (
    <aside
      aria-label="Desk settings"
      className={cn(
        'flex h-full w-full flex-col border-l border-border bg-background/95 backdrop-blur-md md:w-80',
        className,
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <LayoutGrid className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="flex-1 text-sm font-semibold">Your desk</h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Close desk settings"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 scrollbar-thin">
        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Workspace items
          </h3>
          <p className="pb-2 text-xs text-muted-foreground">
            Your pins first, then what you opened last. Drag the handle for how many.
          </p>
          <ul className="space-y-1">
            {kinds.map((k) => {
              const id = `kind:${k}` as const;
              const Icon = KIND_ICONS[k];
              const enabled = on(id);
              const n = countFor(prefs, k);
              return (
                <li
                  key={k}
                  className={cn(
                    'rounded-lg px-2 py-2 transition-colors',
                    enabled && 'bg-foreground/[0.04]',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" />
                    <Label
                      htmlFor={`desk-${k}`}
                      className="flex-1 cursor-pointer text-sm font-normal"
                    >
                      {k === 'notes' ? 'Notes (sticky notes)' : KIND_LABELS[k]}
                    </Label>
                    {enabled ? (
                      <span className="min-w-6 rounded-md bg-primary px-1.5 text-center text-xs font-semibold tabular-nums text-primary-foreground">
                        {n}
                      </span>
                    ) : null}
                    <Switch
                      id={`desk-${k}`}
                      checked={enabled}
                      onCheckedChange={(v) => toggle(id, v)}
                    />
                  </div>
                  {enabled ? (
                    <Slider
                      className="mt-3 mb-1 px-1"
                      min={KIND_COUNT_MIN}
                      max={KIND_COUNT_MAX}
                      step={1}
                      value={[n]}
                      onValueChange={([v]) =>
                        onChange((p) => ({ ...p, counts: { ...p.counts, [k]: v } }))
                      }
                      aria-label={`How many ${KIND_LABELS[k].toLowerCase()}`}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Desk icons
          </h3>
          <div className="flex items-start gap-2 rounded-lg px-2 py-2">
            <Pin className="mt-0.5 size-4 text-muted-foreground" />
            <div className="flex-1">
              <Label htmlFor="desk-icons" className="cursor-pointer text-sm font-normal">
                Pinned items as icons
              </Label>
              <p className="text-xs text-muted-foreground">
                Pin a page, app, note or anything else and it sits on the desk as an icon. Drag it
                wherever you like.
              </p>
            </div>
            <Switch
              id="desk-icons"
              checked={prefs.icons}
              onCheckedChange={(v) => onChange((p) => ({ ...p, icons: v }))}
            />
          </div>
        </section>

        <section className="space-y-1">
          <h3 className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tools
          </h3>
          <ul className="space-y-1">
            {DESK_TOOLS.map((t) => {
              const Icon = TOOL_ICONS[t];
              return (
                <li key={t} className="flex items-center gap-2 rounded-lg px-2 py-2">
                  <Icon className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <Label htmlFor={`desk-${t}`} className="cursor-pointer text-sm font-normal">
                      {TOOL_LABELS[t].title}
                    </Label>
                    <p className="truncate text-xs text-muted-foreground">{TOOL_LABELS[t].hint}</p>
                  </div>
                  <Switch id={`desk-${t}`} checked={on(t)} onCheckedChange={(v) => toggle(t, v)} />
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <footer className="flex shrink-0 gap-2 border-t border-border p-3">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => onChange((p) => ({ ...p, items: tidy(p.items) }))}
        >
          <LayoutGrid /> Tidy up
        </Button>
        <Button variant="ghost" size="sm" className="flex-1" onClick={() => setConfirmReset(true)}>
          <RotateCcw /> Reset desk
        </Button>
      </footer>
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset your desk?</AlertDialogTitle>
            <AlertDialogDescription>
              Every widget goes back to where a fresh desk has it. Your notes, pages and pins are
              not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my desk</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onReset}
            >
              Reset desk
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
