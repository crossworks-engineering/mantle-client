'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RadioTower } from 'lucide-react';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import { ListCard, ListCardMeta, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { useToast } from '@mantle/web-ui/ui/toast';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { cn } from '@mantle/web-ui/lib/utils';
import type { FleetOverview } from '@/lib/fleet';
import {
  BROADCAST_TEXT_MAX,
  broadcastTextMax,
  BROADCAST_TITLE_MAX,
  boxBroadcastLine,
  broadcastBoxName,
  broadcastIssue,
  broadcastPending,
  broadcastRequest,
  FLEET_BROADCASTS_KEY,
  FLEET_BROADCASTS_PATH,
  markLine,
  takenCount,
  type FleetBroadcast,
  type FleetBroadcastsAnswer,
} from '@/lib/fleet-broadcast';
import {
  Callout,
  DetailPane,
  FleetScreen,
  Part,
  Pill,
  SendBar,
  TargetList,
  TONE_TEXT,
  useBoxPick,
} from '../cc-kit';
import { refusalText } from '../fleet-section';
import { ConfirmSend } from '../fleet-writes';

/** One sent broadcast: its text, who and when, and each box's mark. */
function Sent({ b, boxes }: { b: FleetBroadcast; boxes: FleetBroadcastsAnswer['boxes'] }) {
  const taken = takenCount(b);
  const all = taken === b.boxIds.length;
  return (
    <ListCard asChild>
      <li className="space-y-2" data-testid="broadcast-sent">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <ListCardTitle>{b.title ?? b.body.split('\n')[0]}</ListCardTitle>
            <ListCardMeta>
              {b.madeBy}, {formatDateTime(b.madeAt)}
            </ListCardMeta>
          </div>
          <Pill tone={all ? 'ok' : 'wait'}>
            {taken} of {b.boxIds.length} delivered
          </Pill>
        </div>
        {b.title ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{b.body}</p>
        ) : null}
        <ul className="space-y-1" aria-label="Boxes">
          {b.boxIds.map((id) => {
            const m = markLine(b, id);
            return (
              <li key={id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-medium">{broadcastBoxName(boxes, id)}</span>
                <span className={cn(TONE_TEXT[m.tone])}>{m.text}</span>
                {m.reason ? <span className="text-muted-foreground">{m.reason}</span> : null}
              </li>
            );
          })}
        </ul>
      </li>
    </ListCard>
  );
}

/** Write a broadcast, pick the boxes, send; then each box's mark. */
function Broadcast({ data, refresh }: { data: FleetOverview; refresh: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const pick = useBoxPick(data.boxes);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const list = useQuery({
    queryKey: FLEET_BROADCASTS_KEY,
    queryFn: () => apiFetch<FleetBroadcastsAnswer>(FLEET_BROADCASTS_PATH),
    // While a linked box has had no try yet, read again (the run is at once
    // after a send). A failure waits for the next run, minutes apart: no poll.
    refetchInterval: (q: { state: { data?: FleetBroadcastsAnswer } }) =>
      broadcastPending(q.state.data?.broadcasts, q.state.data?.boxes) ? 5000 : false,
  });
  const issue = broadcastIssue(title, text);
  const send = async () => {
    setPending(true);
    try {
      await apiSend(
        FLEET_BROADCASTS_PATH,
        'POST',
        broadcastRequest(
          title,
          text,
          pick.chosen.map((b) => b.id),
        ),
      );
      toast.success(`Sent to ${pick.count}. Each box shows it at its next run.`);
      setTitle('');
      setText('');
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: FLEET_BROADCASTS_KEY });
      refresh();
    } catch (err) {
      toast.error(refusalText(err, 'Could not send the broadcast.'));
    } finally {
      setPending(false);
    }
  };
  const broadcasts = list.data?.broadcasts ?? [];
  return (
    <>
      <MasterDetail
        id="cc-broadcast"
        list={
          <TargetList
            boxes={data.boxes}
            picked={pick.picked}
            setPicked={pick.setPicked}
            line={(box) => boxBroadcastLine(broadcasts, box.id)}
          />
        }
        detail={
          <DetailPane icon={<RadioTower />} title="Broadcast">
            <Callout title="Every person on each box picked reads it">
              It shows in the Announcements chat on each box, with a push to each person. No one can
              reply there: to answer, a person messages you.
            </Callout>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (!issue && pick.chosen.length > 0) setConfirming(true);
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="fleet-broadcast-title">Title (optional)</FieldLabel>
                  <Input
                    id="fleet-broadcast-title"
                    autoComplete="off"
                    maxLength={BROADCAST_TITLE_MAX}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="fleet-broadcast-text">Message</FieldLabel>
                  <Textarea
                    id="fleet-broadcast-text"
                    rows={6}
                    maxLength={BROADCAST_TEXT_MAX}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <FieldDescription>
                    {text.trim().length} of {broadcastTextMax(title)} characters. Text only.
                  </FieldDescription>
                </Field>
                <SendBar count={pick.chosen.length}>
                  <SubmitButton pending={false} disabled={pick.chosen.length === 0 || !!issue}>
                    {pick.chosen.length > 0 ? `Send to ${pick.count}` : 'Send'}
                  </SubmitButton>
                </SendBar>
              </FieldGroup>
            </form>
            <Part title="Sent">
              {list.isLoading ? (
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Spinner size={20} /> Loading…
                </div>
              ) : list.isError ? (
                <p className="text-sm text-muted-foreground">
                  Could not read the broadcasts. A brain a release behind has none yet.
                </p>
              ) : broadcasts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
              ) : (
                <ul className="space-y-2" aria-label="Sent broadcasts">
                  {broadcasts.map((b) => (
                    <Sent key={b.id} b={b} boxes={list.data?.boxes ?? []} />
                  ))}
                </ul>
              )}
            </Part>
          </DetailPane>
        }
      />
      <ConfirmSend
        open={confirming}
        pending={pending}
        title={`Send to every person on ${pick.count}?`}
        action="Send"
        onCancel={() => setConfirming(false)}
        onConfirm={() => void send()}
      >
        Each person gets it in Announcements, with a push. A sent broadcast cannot be taken back.
      </ConfirmSend>
    </>
  );
}

export function BroadcastClient() {
  return (
    <FleetScreen>{(data, refresh) => <Broadcast data={data} refresh={refresh} />}</FleetScreen>
  );
}
