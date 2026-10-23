'use client';

/**
 * The building blocks of the peer screen, so every part of it looks the same:
 * a bordered section with an icon heading, a line under it and an optional
 * control at its right (the workspace screen's section, with that control);
 * a column heading inside a section; one on/off flag row; and the state pill.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Label } from '@mantle/web-ui/ui/label';
import { Switch } from '@mantle/web-ui/ui/switch';
import { cn } from '@mantle/web-ui/lib/utils';
import { peerStateLabel, peerStateTone, type PeerState } from './peer-status';

export function PeerSection({
  id,
  icon: Icon,
  title,
  description,
  control,
  children,
  className,
}: {
  /** The heading's id: the section is labelled by it. */
  id: string;
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  /** A control at the heading's right (a switch, a button). */
  control?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn('rounded-lg border border-border', className)}>
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 id={id} className="text-sm font-semibold">
            {title}
          </h3>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {control ? <div className="flex shrink-0 items-center gap-2">{control}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A heading inside a section: one column of a two-column section. */
export function PeerColumnHeading({
  title,
  description,
  aside,
}: {
  title: string;
  description?: ReactNode;
  /** At the heading's right: a count, a small action. */
  aside?: ReactNode;
}) {
  return (
    <div className="mb-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h4>
        {aside}
      </div>
      {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

/** One flag: a name, an optional line under it, and its switch. The whole
 *  label is the switch's label, so a click on the words flips it too. */
export function FlagRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
  mono = false,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (on: boolean) => void;
  /** A tool name: set in the mono face. */
  mono?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-3', mono ? 'py-1' : 'py-1.5')}>
      <Label
        htmlFor={id}
        className={cn(
          'block min-w-0 flex-1 cursor-pointer font-normal leading-normal',
          disabled && 'cursor-default',
        )}
      >
        <span className={cn('block truncate', mono ? 'font-mono text-xs' : 'text-sm')}>
          {label}
        </span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </Label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/** Where the link stands, as an outline pill (StatePill's shape). */
export function PeerStatePill({ state, className }: { state: PeerState; className?: string }) {
  return (
    <span
      data-state={state}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4',
        peerStateTone(state),
        className,
      )}
    >
      {peerStateLabel(state)}
    </span>
  );
}
