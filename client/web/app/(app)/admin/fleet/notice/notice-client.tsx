'use client';

import { useState } from 'react';
import { Megaphone } from 'lucide-react';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { RadioGroup, RadioGroupItem } from '@mantle/web-ui/ui/radio-group';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { cn } from '@mantle/web-ui/lib/utils';
import type { FleetOverview } from '@/lib/fleet';
import { Callout, DetailPane, FleetScreen, SendBar, TargetList } from '../cc-kit';
import { ConfirmSend } from '../fleet-writes';
import { kindLine, useSettingsSend } from '../settings-send';

const CHOICES = [
  {
    id: 'off',
    title: 'Off',
    text: 'Logins work again on each box.',
  },
  {
    id: 'on',
    title: 'On: block every login',
    text: 'Every login on each box waits, for up to an hour.',
  },
] as const;

/** The update notice on or off on the boxes picked. */
function Notice({ data, refresh }: { data: FleetOverview; refresh: () => void }) {
  const [on, setOn] = useState(false);
  const s = useSettingsSend(data.boxes, refresh);
  const word = on ? 'on' : 'off';
  return (
    <>
      <MasterDetail
        id="cc-notice"
        list={
          <TargetList
            boxes={data.boxes}
            picked={s.picked}
            setPicked={s.setPicked}
            line={kindLine('updateNotice')}
          />
        }
        detail={
          <DetailPane icon={<Megaphone />} title="Update notice">
            <Callout tone="bad" title="On blocks every login on that box for up to an hour">
              It clears by itself after an hour, or when the box runs a new version.
            </Callout>
            <form
              noValidate
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (s.chosen.length > 0) s.setConfirming(true);
              }}
            >
              <RadioGroup
                value={word}
                onValueChange={(v) => setOn(v === 'on')}
                aria-label="Notice"
                className="grid gap-3 sm:grid-cols-2"
              >
                {CHOICES.map((c) => (
                  <label
                    key={c.id}
                    htmlFor={`fleet-notice-${c.id}`}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card/70 p-3 transition-colors hover:bg-muted/50',
                      word === c.id && 'border-primary bg-selected ring-1 ring-primary',
                    )}
                  >
                    <RadioGroupItem id={`fleet-notice-${c.id}`} value={c.id} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{c.title}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{c.text}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
              <SendBar count={s.chosen.length}>
                <SubmitButton
                  pending={false}
                  disabled={s.chosen.length === 0}
                  className={
                    on
                      ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                      : undefined
                  }
                >
                  {s.chosen.length > 0 ? `Turn it ${word} for ${s.count}` : `Turn it ${word}`}
                </SubmitButton>
              </SendBar>
            </form>
          </DetailPane>
        }
      />
      <ConfirmSend
        open={s.confirming}
        pending={s.pending}
        title={`Turn the update notice ${word} for ${s.count}?`}
        action={`Turn it ${word}`}
        onCancel={() => s.setConfirming(false)}
        onConfirm={() =>
          void s.go({ kind: 'updateNotice', on }, 'Could not send the update notice.')
        }
      >
        {on
          ? 'Every login on each box is blocked for up to an hour, until you turn it off or the box runs a new version.'
          : 'Logins work again on each box.'}
      </ConfirmSend>
    </>
  );
}

export function NoticeClient() {
  return (
    <FleetScreen needs="writes">
      {(data, refresh) => <Notice data={data} refresh={refresh} />}
    </FleetScreen>
  );
}
