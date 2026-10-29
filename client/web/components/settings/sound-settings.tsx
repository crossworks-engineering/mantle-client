'use client';

/**
 * Sounds, on the profile screen: the on/off switch, a volume, and a play
 * button for every sound in the palette. Saved at once, on its own route
 * (lib/sounds/sync.ts), not with the profile form's Save.
 */

import { useSyncExternalStore } from 'react';
import { Play } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { Label } from '@mantle/web-ui/ui/label';
import { Slider } from '@mantle/web-ui/ui/slider';
import { Switch } from '@mantle/web-ui/ui/switch';
import { cn } from '@mantle/web-ui/lib/utils';
import { play } from '@/lib/sounds/play';
import {
  getSoundPrefs,
  serverSoundPrefs,
  setSoundPrefs,
  subscribeSoundPrefs,
} from '@/lib/sounds/prefs';
import { SOUND_CATALOG, soundLength, type SoundKind } from '@/lib/sounds/recipes';
import { pushSoundPrefs } from '@/lib/sounds/sync';
import { useViewerLogin } from '@/components/workspaces/use-shell-workspaces';

export function useSoundPrefs() {
  return useSyncExternalStore(subscribeSoundPrefs, getSoundPrefs, serverSoundPrefs);
}

export function SoundSettings() {
  const prefs = useSoundPrefs();
  // The login this tab shows: the save names it (lib/sounds/sync.ts).
  const loginId = useViewerLogin()?.loginId;

  const playAll = () => {
    let at = 0;
    for (const { kind } of SOUND_CATALOG) {
      setTimeout(() => play(kind, { force: true }), at);
      at += Math.round(soundLength(kind) * 1000) + 450;
    }
  };

  return (
    <section className="space-y-4 border-t border-border pt-6" data-testid="sound-settings">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="soundsEnabled">Sounds</Label>
          <Switch
            id="soundsEnabled"
            checked={prefs.enabled}
            onCheckedChange={(enabled) => {
              setSoundPrefs({ enabled });
              pushSoundPrefs(loginId);
              if (enabled) play('action', { force: true });
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Short, soft sounds for chat messages, a finished reply, an incoming call and other events.
          Off silences all of them, the call ring included. Follows you to your other devices.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <Label htmlFor="soundsVolume" className={cn('w-16', !prefs.enabled && 'opacity-50')}>
          Volume
        </Label>
        <Slider
          id="soundsVolume"
          className="max-w-xs"
          min={0}
          max={100}
          step={5}
          value={[Math.round(prefs.volume * 100)]}
          disabled={!prefs.enabled}
          onValueChange={([v]) => setSoundPrefs({ volume: (v ?? 0) / 100 })}
          onValueCommit={() => {
            pushSoundPrefs(loginId);
            play('notification', { force: true });
          }}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label>Listen</Label>
          <Button type="button" variant="ghost" size="sm" onClick={playAll}>
            Play all
          </Button>
        </div>
        <ul className="divide-y divide-border rounded-md border border-border">
          {SOUND_CATALOG.map((s) => (
            <SoundRow key={s.kind} kind={s.kind} label={s.label} use={s.use} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function SoundRow({ kind, label, use }: { kind: SoundKind; label: string; use: string }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8 shrink-0"
        aria-label={`Play ${label}`}
        onClick={() => play(kind, { force: true })}
      >
        <Play className="size-3.5" />
      </Button>
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="truncate text-xs text-muted-foreground">{use}</div>
      </div>
      <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
        {Math.round(soundLength(kind) * 1000)} ms
      </span>
    </li>
  );
}
