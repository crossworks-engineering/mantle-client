'use client';

import { Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { cn } from '@mantle/web-ui/lib/utils';
import { useZenMode } from '@/components/layout/zen-mode';

/**
 * The focus-mode control: the shell hides its chrome and the folders, and
 * the content takes the whole viewport. It is the ONLY way the folders go
 * away (item header contract, 2026-10-21).
 *
 * ONE button does both directions. In the item header it sits in a fixed
 * slot, fourth from the right on every kind (left of Delete, Edit, More);
 * while maximised the header also shows its back link ("‹ Pages") and Esc
 * leaves (the shell's key).
 * Whichever toolbar renders this must survive focus mode itself.
 *
 * An icon button the size of every other header icon (`icon-sm`), pressed
 * while on.
 */
export function FocusToggle() {
  const { zen, toggle } = useZenMode();
  const label = zen ? 'Show the folders (Esc)' : 'Maximise: hide the folders';
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className={cn(zen && 'bg-accent text-accent-foreground')}
      onClick={toggle}
      aria-pressed={zen}
      aria-label={zen ? 'Exit focus mode' : 'Focus mode'}
      title={label}
      data-testid="focus-toggle"
    >
      {zen ? <Minimize2 /> : <Maximize2 />}
    </Button>
  );
}
