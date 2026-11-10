'use client';

import { useState } from 'react';
import { Button } from '@mantle/web-ui/ui/button';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import { boxName, type FleetBox } from '@/lib/fleet';

/** The boxes a fleet write goes to. A box removed since it was picked is
 *  not sent. */
export function useBoxPick(boxes: readonly FleetBox[]) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const chosen = boxes.filter((b) => picked.has(b.id));
  const count = chosen.length === 1 ? '1 box' : `${chosen.length} boxes`;
  return { picked, setPicked, chosen, count };
}

/** One checkbox per box, with All boxes or Clear. `idPrefix` keeps each
 *  form's ids apart. */
export function BoxPicker({
  boxes,
  picked,
  setPicked,
  idPrefix,
}: {
  boxes: readonly FleetBox[];
  picked: Set<string>;
  setPicked: (next: Set<string>) => void;
  idPrefix: string;
}) {
  const all = boxes.length > 0 && boxes.every((b) => picked.has(b.id));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  return (
    <fieldset className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <legend className="text-sm font-medium">Boxes</legend>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setPicked(all ? new Set() : new Set(boxes.map((b) => b.id)))}
        >
          {all ? 'Clear' : 'All boxes'}
        </Button>
      </div>
      <ul className="space-y-1.5">
        {boxes.map((b) => (
          <li key={b.id} className="flex items-center gap-2">
            <Checkbox
              id={`${idPrefix}-${b.id}`}
              checked={picked.has(b.id)}
              onCheckedChange={(v) => toggle(b.id, v === true)}
            />
            <label htmlFor={`${idPrefix}-${b.id}`} className="text-sm">
              {boxName(b)}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
