'use client';

import { useState } from 'react';
import type { FleetBox } from '@/lib/fleet';
import { lastOfKind, type Tone } from '@/lib/fleet-view';
import { FLEET_SETTINGS_PATH, type FleetWriteChange } from '@/lib/fleet-writes';
import { useBoxPick } from './cc-kit';
import { useFleetSend } from './fleet-writes';

/** One settings form's box pick, question and send. */
export function useSettingsSend(boxes: FleetBox[], onChanged: () => void) {
  const pick = useBoxPick(boxes);
  const [confirming, setConfirming] = useState(false);
  const { pending, send } = useFleetSend(FLEET_SETTINGS_PATH, onChanged);
  const go = async (change: FleetWriteChange, fallback: string) => {
    const ok = await send(
      [change],
      pick.chosen.map((b) => b.id),
      fallback,
    );
    if (ok) setConfirming(false);
    return ok;
  };
  return { ...pick, confirming, setConfirming, pending, go };
}

/** What a box card says on a screen that sends one kind of change: the box's
 *  newest word on that kind. Nothing when it was never sent one. */
export const kindLine =
  (kind: FleetWriteChange['kind']) =>
  (box: FleetBox): { tone: Tone; text: string } | null => {
    const last = lastOfKind(box, kind);
    return last ? { tone: last.tone, text: `${last.label}: ${last.text}` } : null;
  };
