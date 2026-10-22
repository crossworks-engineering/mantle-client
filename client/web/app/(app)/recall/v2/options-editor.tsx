'use client';

import { useState } from 'react';
import { ArrowRight, Check, Map as MapIcon, Pencil, Plus, X } from 'lucide-react';
import type { RecallNodeDTO, RecallOptionDTO } from '@mantle/web-ui/types/recall-v2';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Input } from '@mantle/web-ui/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { cn } from '@mantle/web-ui/lib/utils';
import {
  RECALL_LABEL_MAX,
  RECALL_LINE_MAX,
  cardKindOf,
  optionTargetValue,
  type OptionTarget,
} from '@/lib/recall-v2';
import { CardKindIcon } from './card-list';

/** An option the brain would refuse as it stands: it must have all three. */
function incomplete(o: RecallOptionDTO): boolean {
  return !o.targetSlug || !o.label.trim() || !o.useWhen.trim();
}

/**
 * A card's options: where an agent can go next, and when. Each one is an
 * affordance ("use when ..."), never a command. A target is another card in
 * this map, or the entry card of another published map.
 *
 * Each option READS as a line of the trail (where it goes, what it is called,
 * when to take it); the pencil opens its fields. One that is missing a part
 * opens by itself, so nothing incomplete hides behind a summary. A target in
 * this map is a link: following it opens that card.
 *
 * The list is the card's WHOLE option list: the brain replaces it on save.
 */
export function OptionsEditor({
  options,
  targets,
  nodes,
  onChange,
  onOpen,
}: {
  options: RecallOptionDTO[];
  targets: OptionTarget[];
  /** The map's cards, for each target's title and kind. */
  nodes: RecallNodeDTO[];
  onChange: (options: RecallOptionDTO[]) => void;
  /** Open a card of this map (the screen guards unsaved edits). */
  onOpen: (slug: string) => void;
}) {
  const [editing, setEditing] = useState<ReadonlySet<number>>(() => new Set());

  function update(i: number, patch: Partial<RecallOptionDTO>) {
    onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  }
  function setTarget(i: number, value: string) {
    const t = targets.find((x) => x.value === value);
    const cur = options[i];
    if (!t || !cur) return;
    const next: RecallOptionDTO = {
      label: cur.label || t.label.replace(/ \(another map\)$/, ''),
      useWhen: cur.useWhen,
      targetSlug: t.targetSlug,
    };
    if (t.targetMap) next.targetMap = t.targetMap;
    onChange(options.map((o, j) => (j === i ? next : o)));
  }
  function toggle(i: number, on: boolean) {
    setEditing((cur) => {
      const next = new Set(cur);
      if (on) next.add(i);
      else next.delete(i);
      return next;
    });
  }
  function remove(i: number) {
    onChange(options.filter((_, j) => j !== i));
    // Indexes after the removed row move up one.
    setEditing((cur) => new Set([...cur].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j))));
  }

  return (
    <div className="space-y-2">
      {options.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No options. An agent that opens this card has nowhere to go from it, which is right for a
          card at the end of a trail.
        </p>
      )}
      {options.map((o, i) => {
        const value = optionTargetValue(o);
        const target = o.targetMap ? null : nodes.find((n) => n.slug === o.targetSlug);
        const mapTarget = o.targetMap ? targets.find((t) => t.value === value) : null;
        // A target the list does not offer (an unpublished map, a card since
        // deleted) still shows, so saving does not silently change it.
        const known = targets.some((t) => t.value === value);
        const open = editing.has(i) || incomplete(o);
        return (
          <div
            key={i}
            className={cn(
              'rounded-md border bg-card/70 p-2',
              open ? 'border-primary/40' : 'border-border',
            )}
          >
            {open ? (
              <div className="space-y-2">
                <Select
                  value={o.targetSlug ? value : undefined}
                  onValueChange={(v) => setTarget(i, v)}
                >
                  <SelectTrigger aria-label={`Option ${i + 1} target`} className="h-8">
                    <SelectValue placeholder="Go to…" />
                  </SelectTrigger>
                  <SelectContent>
                    {!known && o.targetSlug && (
                      <SelectItem value={value}>
                        {o.targetMap ?? o.targetSlug} (unavailable)
                      </SelectItem>
                    )}
                    {targets.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label={`Option ${i + 1} label`}
                  value={o.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  placeholder="Label, as an agent sees it"
                  maxLength={RECALL_LABEL_MAX}
                  className="h-8"
                />
                <Input
                  aria-label={`Option ${i + 1} use when`}
                  value={o.useWhen}
                  onChange={(e) => update(i, { useWhen: e.target.value })}
                  placeholder="Use when…"
                  maxLength={RECALL_LINE_MAX}
                  className="h-8"
                />
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => remove(i)}
                    className="text-muted-foreground hover:text-destructive-ink"
                  >
                    <X /> Remove
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => toggle(i, false)}
                    disabled={incomplete(o)}
                    title={
                      incomplete(o)
                        ? 'An option needs a target, a label and a use when.'
                        : undefined
                    }
                  >
                    <Check /> Done
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <ArrowRight className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1 space-y-0.5">
                  {target ? (
                    <RowButton
                      onClick={() => onOpen(target.slug)}
                      className="flex max-w-full items-start gap-1.5 text-left text-sm font-medium hover:underline"
                    >
                      <CardKindIcon kind={cardKindOf(target)} className="mt-[0.2rem]" />
                      <span className="min-w-0 break-words">{target.title}</span>
                    </RowButton>
                  ) : (
                    <p className="flex items-start gap-1.5 text-sm font-medium">
                      <MapIcon className="mt-[0.2rem] size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 break-words">
                        {mapTarget
                          ? mapTarget.label.replace(/ \(another map\)$/, '')
                          : `${o.targetMap ?? o.targetSlug} (unavailable)`}
                        {o.targetMap && (
                          <span className="font-normal text-muted-foreground"> · another map</span>
                        )}
                      </span>
                    </p>
                  )}
                  <p className="text-xs break-words text-muted-foreground">
                    <span className="text-foreground/80">“{o.label}”</span> · use when {o.useWhen}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-2xs"
                  aria-label={`Edit option ${o.label}`}
                  onClick={() => toggle(i, true)}
                >
                  <Pencil />
                </Button>
              </div>
            )}
          </div>
        );
      })}
      <Button
        variant="outline"
        size="xs"
        onClick={() => {
          toggle(options.length, true);
          onChange([...options, { label: '', useWhen: '', targetSlug: '' }]);
        }}
        disabled={targets.length === 0}
      >
        <Plus /> Option
      </Button>
    </div>
  );
}
