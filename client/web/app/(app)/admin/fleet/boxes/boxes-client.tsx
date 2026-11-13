'use client';

import { useState, type FormEvent } from 'react';
import { Plus, Server, Trash2 } from 'lucide-react';
import { apiSend } from '@mantle/web-ui/api-fetch';
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
import { CopyBlock, CopyButton } from '@mantle/web-ui/ui/copy-button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import { ListCard, ListCardMeta, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { formatMicroUsd } from '@mantle/web-ui/traces-format';
import {
  boxName,
  FLEET_PATH,
  ipLine,
  keyBoxText,
  reasonText,
  type FleetBox,
  type FleetOverview,
} from '@/lib/fleet';
import { healthLabel, healthLevel, type FleetMatrixRow } from '@/lib/fleet-matrix';
import { ccHref, changeRows, linkState, type Tone } from '@/lib/fleet-view';
import {
  Callout,
  DetailPane,
  Facts,
  FleetScreen,
  LEVEL_TONE,
  ListEmpty,
  ListPane,
  Part,
  Pill,
  ScreenLink,
  Tile,
  Tiles,
  TONE_TEXT,
  useMatrixRows,
  useParam,
} from '../cc-kit';
import { refusalText } from '../fleet-section';

const NEW = 'new';

function BoxCard({
  box,
  selected,
  onOpen,
}: {
  box: FleetBox;
  selected: boolean;
  onOpen: () => void;
}) {
  const state = linkState(box);
  const ip = ipLine(box.ips);
  return (
    <ListCard
      selected={selected}
      accent={state.tone === 'bad' ? 'warning' : undefined}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2">
        <ListCardTitle className="min-w-0 flex-1">{boxName(box)}</ListCardTitle>
        <Pill tone={state.tone}>{state.label}</Pill>
      </div>
      <ListCardMeta>{box.url}</ListCardMeta>
      {ip && (
        <ListCardMeta className="font-mono" title={ip.title}>
          {ip.text}
        </ListCardMeta>
      )}
      <ListCardMeta>
        {box.lastRunAt ? `Last run ${formatDateTime(box.lastRunAt)}` : 'No run yet'}
        {box.loginCount !== null &&
          ` · ${box.loginCount === 1 ? '1 login' : `${box.loginCount} logins`}`}
      </ListCardMeta>
    </ListCard>
  );
}

/** The way to link one more box: the two lines for its .env, then its address. */
function LinkBox({
  data,
  onAdded,
  onCancel,
}: {
  data: FleetOverview;
  onAdded: (id: string | null) => void;
  onCancel?: () => void;
}) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setPending(true);
    try {
      const res = await apiSend<{ box?: { id?: string } }>(`${FLEET_PATH}/boxes`, 'POST', {
        url: url.trim(),
        label: label.trim() || null,
      });
      setUrl('');
      setLabel('');
      toast.success('Box added. Its first run starts now.');
      onAdded(res?.box?.id ?? null);
    } catch (err) {
      toast.error(refusalText(err, 'Could not add the box.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <DetailPane icon={<Plus />} title="Link a box">
      <Part title="Step 1: on the box">
        {data.envLines ? (
          <>
            <p className="text-sm">
              Add these two lines to the .env of the box, then run docker compose up -d on that box.
            </p>
            <CopyBlock code={data.envLines.join('\n')} />
          </>
        ) : (
          <Callout tone="warn" title="The control service has not made its key yet">
            Add control to COMPOSE_PROFILES in the .env of this box, then run docker compose up -d.
            The two lines show here after that.
          </Callout>
        )}
      </Part>
      <Part title="Step 2: here">
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="fleet-box-url">Box URL</FieldLabel>
                <Input
                  id="fleet-box-url"
                  value={url}
                  placeholder="https://box.example.com"
                  inputMode="url"
                  maxLength={400}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="fleet-box-label">Label (optional)</FieldLabel>
                <Input
                  id="fleet-box-label"
                  value={label}
                  maxLength={100}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </Field>
            </div>
            <FieldDescription>
              HTTPS and the host only, no path. This box must reach it over HTTPS.
            </FieldDescription>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              {onCancel && (
                <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
                  Cancel
                </Button>
              )}
              <SubmitButton pending={pending} disabled={!url.trim()}>
                Add box
              </SubmitButton>
            </div>
          </FieldGroup>
        </form>
      </Part>
    </DetailPane>
  );
}

function BoxDetail({
  box,
  row,
  onRemove,
}: {
  box: FleetBox;
  row: FleetMatrixRow | undefined;
  onRemove: () => void;
}) {
  const state = linkState(box);
  const reason = reasonText(box.lastReason);
  const ip = ipLine(box.ips);
  const facts = row?.facts ?? null;
  const level = healthLevel(facts?.status ?? null);
  const key = keyBoxText(box);
  const keyOf = box.keyPending ?? box.keyResult ?? null;
  const changes = changeRows([box]).slice(0, 5);
  return (
    <DetailPane
      icon={<Server />}
      title={boxName(box)}
      pill={<Pill tone={state.tone}>{state.label}</Pill>}
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${boxName(box)}`}
          title="Remove this box"
          className="text-muted-foreground hover:text-destructive-ink"
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      }
    >
      {reason ? (
        <Callout tone="bad" title={reason}>
          {box.lastReason && (
            <span className="text-muted-foreground">
              Reason code <span className="font-mono">{box.lastReason}</span>.{' '}
            </span>
          )}
          {box.lastOkAt
            ? `Its last good run was ${formatDateTime(box.lastOkAt)}.`
            : 'It never had a good run.'}
        </Callout>
      ) : box.lastOkAt ? (
        <Callout tone="ok" title="Linked">
          Last good run {formatDateTime(box.lastOkAt)}.
        </Callout>
      ) : (
        <Callout title="Waiting for the first run" />
      )}

      {facts && (
        <Part
          title="At the last read"
          action={<ScreenLink href={ccHref('matrix', box.id)}>Open in the matrix</ScreenLink>}
        >
          <Tiles>
            <Tile
              label="Health"
              value={healthLabel(level)}
              tone={LEVEL_TONE[level] === 'muted' ? undefined : (LEVEL_TONE[level] as Tone)}
            />
            <Tile
              label="Version"
              value={facts.status ? `v${facts.status.build.version}` : 'Not known'}
            />
            <Tile
              label="Spend today"
              value={facts.status?.spend ? formatMicroUsd(facts.status.spend.last24hMicroUsd) : '–'}
            />
            <Tile label="Agents" value={facts.agents.length} />
          </Tiles>
        </Part>
      )}

      <Part title="Link">
        <Facts
          rows={[
            {
              label: 'Address',
              value: (
                <>
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 break-all font-mono text-[13px]">{box.url}</span>
                    <CopyButton value={box.url} ariaLabel="Copy the box address" />
                  </span>
                  {ip && (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span className="min-w-0 break-all font-mono text-xs" title={ip.title}>
                        {ip.text}
                      </span>
                      <CopyButton value={ip.title} ariaLabel="Copy the box IP" />
                    </span>
                  )}
                </>
              ),
            },
            { label: 'Linked since', value: formatDateTime(box.createdAt) },
            { label: 'Added by', value: box.addedBy ?? 'A login that is gone' },
            {
              label: 'Last run',
              value: box.lastRunAt ? formatDateTime(box.lastRunAt) : 'No run yet',
            },
            {
              label: 'Last good run',
              value: box.lastOkAt ? formatDateTime(box.lastOkAt) : 'None yet',
            },
            {
              label: 'Logins',
              value:
                box.loginCount === null
                  ? 'No login list yet'
                  : box.loginCount === 1
                    ? '1 login'
                    : `${box.loginCount} logins`,
            },
          ]}
        />
      </Part>

      {key && keyOf && (
        <Part
          title="Last provider key"
          action={<ScreenLink href={ccHref('keys')}>Open Provider keys</ScreenLink>}
        >
          <p className="text-sm">
            <span className="font-mono">{keyOf.service}</span>:{' '}
            <span className={TONE_TEXT[key.tone]}>{key.text}</span>{' '}
            <span className="text-muted-foreground">
              By {keyOf.by}, {formatDateTime(keyOf.at)}.
            </span>
          </p>
        </Part>
      )}

      {changes.length > 0 && (
        <Part
          title="Last changes"
          action={<ScreenLink href={ccHref('changes', box.id)}>Open Fleet changes</ScreenLink>}
        >
          <ul className="divide-y divide-border rounded-lg border border-border">
            {changes.map((c) => (
              <li key={c.key} className="space-y-0.5 px-3 py-2 text-sm">
                <p className="font-mono text-[13px]">{c.label}</p>
                <p className={`text-xs ${TONE_TEXT[c.tone]}`}>{c.text}</p>
              </li>
            ))}
          </ul>
        </Part>
      )}
    </DetailPane>
  );
}

function Boxes({ data, refresh }: { data: FleetOverview; refresh: () => void }) {
  const toast = useToast();
  const [param, setParam] = useParam('box');
  const { rows } = useMatrixRows(data.boxes);
  const [removing, setRemoving] = useState<FleetBox | null>(null);
  const [pending, setPending] = useState(false);

  const adding = param === NEW || data.boxes.length === 0;
  const selected = adding ? null : (data.boxes.find((b) => b.id === param) ?? data.boxes[0]!);

  const remove = async () => {
    if (!removing) return;
    setPending(true);
    try {
      await apiSend(`${FLEET_PATH}/boxes/${removing.id}`, 'DELETE');
      toast.success('Box removed');
      setRemoving(null);
      setParam(null);
      refresh();
    } catch (err) {
      toast.error(refusalText(err, 'Could not remove the box.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <MasterDetail
        id="cc-boxes"
        list={
          <ListPane
            title={`Linked boxes (${data.boxes.length})`}
            action={
              <Button size="sm" onClick={() => setParam(NEW)}>
                <Plus /> Link box
              </Button>
            }
          >
            {data.boxes.length === 0 ? (
              <ListEmpty>No box is linked. Link the first one on the right.</ListEmpty>
            ) : (
              data.boxes.map((b) => (
                <BoxCard
                  key={b.id}
                  box={b}
                  selected={selected?.id === b.id}
                  onOpen={() => setParam(b.id)}
                />
              ))
            )}
          </ListPane>
        }
        detail={
          selected ? (
            <BoxDetail
              box={selected}
              row={rows.find((r) => r.id === selected.id)}
              onRemove={() => setRemoving(selected)}
            />
          ) : (
            <LinkBox
              data={data}
              onAdded={(id) => {
                setParam(id);
                refresh();
              }}
              onCancel={data.boxes.length > 0 ? () => setParam(null) : undefined}
            />
          )
        }
      />
      <AlertDialog
        open={removing !== null}
        onOpenChange={(o) => !o && !pending && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing ? boxName(removing) : 'this box'}?</AlertDialogTitle>
            <AlertDialogDescription>
              All calls to this box stop. Logins it disabled stay disabled. To unlink it fully, also
              remove the two control lines from its .env.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              Remove box
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function BoxesClient() {
  return <FleetScreen>{(data, refresh) => <Boxes data={data} refresh={refresh} />}</FleetScreen>;
}
