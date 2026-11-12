'use client';

import { useState } from 'react';
import { UsersRound } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { Field, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { boxName } from '@/lib/fleet';
import {
  assignableWorkspaces,
  bulkPlan,
  bulkSkipText,
  describeChange,
  MAX_MEMBER_CHANGES,
  stateWord,
  type FleetPeopleBox,
  type MemberChange,
  type MemberState,
  type Person,
} from '@/lib/fleet-people';
import { Callout, DetailPane, Part } from '../cc-kit';
import { ConfirmSend } from '../fleet-writes';

/** Many people at once: into one workspace of one box, or out of it. */
export function BulkPane({
  people,
  peopleBoxes,
  sending,
  onSend,
  onClear,
}: {
  people: Person[];
  peopleBoxes: FleetPeopleBox[];
  sending: boolean;
  onSend: (changes: MemberChange[]) => Promise<boolean>;
  onClear: () => void;
}) {
  const boxes = peopleBoxes.filter(
    (b) => b.people && people.some((p) => p.logins.some((l) => l.boxId === b.id)),
  );
  const [boxId, setBoxId] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [role, setRole] = useState<MemberState>('user');
  /** The changes the confirm shows, frozen when it opens: exactly these go. */
  const [frozen, setFrozen] = useState<{ title: string; changes: MemberChange[] } | null>(null);
  const box = boxes.find((b) => b.id === boxId);
  const workspaces = assignableWorkspaces(box);
  const plan = box && workspaceId ? bulkPlan(people, box.id, workspaceId, role, peopleBoxes) : null;
  const ws = workspaces.find((w) => w.id === workspaceId);
  const tooMany = (plan?.changes.length ?? 0) > MAX_MEMBER_CHANGES;

  const go = async () => {
    if (!frozen) return;
    if (await onSend(frozen.changes)) setFrozen(null);
  };
  const ask = () => {
    if (!plan || plan.changes.length === 0) return;
    const n = plan.changes.length;
    const where = ws?.name ?? 'the workspace';
    setFrozen({
      title: role === 'none' ? `Remove ${n} from ${where}?` : `Add ${n} to ${where}?`,
      changes: [...plan.changes],
    });
  };

  return (
    <DetailPane
      icon={<UsersRound />}
      title={people.length === 1 ? '1 person picked' : `${people.length} people picked`}
      actions={
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      }
    >
      <Part title="Picked">
        <p className="text-sm text-muted-foreground">
          {people
            .slice(0, 12)
            .map((p) => p.email)
            .join(', ')}
          {people.length > 12 ? `, and ${people.length - 12} more` : ''}
        </p>
      </Part>
      <Part title="Add to a workspace, or remove from it">
        {boxes.length === 0 ? (
          <Callout title="No box to change">
            None of the picked people is on a box that sent its people list.
          </Callout>
        ) : (
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="bulk-box">Box</FieldLabel>
                <Select
                  value={boxId}
                  onValueChange={(v) => {
                    setBoxId(v);
                    setWorkspaceId('');
                  }}
                >
                  <SelectTrigger id="bulk-box">
                    <SelectValue placeholder="Pick a box" />
                  </SelectTrigger>
                  <SelectContent>
                    {boxes.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {boxName(b)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="bulk-ws">Workspace</FieldLabel>
                <Select value={workspaceId} onValueChange={setWorkspaceId} disabled={!box}>
                  <SelectTrigger id="bulk-ws">
                    <SelectValue placeholder="Pick a workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaces.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="bulk-role">Role</FieldLabel>
                <Select value={role} onValueChange={(v) => setRole(v as MemberState)}>
                  <SelectTrigger id="bulk-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="moderator">Moderator</SelectItem>
                    <SelectItem value="none">Remove from it</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              The Admin workspace is not offered: who is an Admin is changed on the box itself.
            </p>
          </FieldGroup>
        )}
        {plan && (
          <div className="space-y-2 rounded-lg border border-border bg-primary/5 p-3 text-sm">
            {plan.changes.length === 0 ? (
              <p>Nothing to change.</p>
            ) : (
              <p>
                {plan.changes.length === 1 ? '1 change' : `${plan.changes.length} changes`}:{' '}
                {role === 'none' ? `remove from ${ws?.name}` : `${stateWord(role)} in ${ws?.name}`}.
              </p>
            )}
            {plan.skipped.map((s) => (
              <p key={s.email} className="text-xs text-muted-foreground">
                {bulkSkipText(s)}
              </p>
            ))}
            {tooMany && (
              <Callout tone="warn" title={`At most ${MAX_MEMBER_CHANGES} changes at once`}>
                Pick fewer people.
              </Callout>
            )}
            {plan.changes.length > 0 && (
              <div className="flex justify-end">
                <Button size="sm" disabled={tooMany} onClick={ask}>
                  {role === 'none' ? 'Remove' : 'Add'}{' '}
                  {plan.changes.length === 1 ? '1 person' : `${plan.changes.length} people`}
                </Button>
              </div>
            )}
          </div>
        )}
      </Part>
      <ConfirmSend
        open={frozen !== null}
        pending={sending}
        title={frozen?.title ?? ''}
        action="Send"
        onCancel={() => setFrozen(null)}
        onConfirm={() => void go()}
      >
        <span className="block">
          {box ? boxName(box) : 'The box'} makes the changes at its next run, within seconds.
        </span>
        <span className="mt-2 block max-h-64 overflow-y-auto scrollbar-thin">
          {frozen?.changes.map((c) => (
            <span key={`${c.boxId}:${c.loginId}`} className="block text-foreground">
              {describeChange(c, peopleBoxes)}
            </span>
          ))}
        </span>
      </ConfirmSend>
    </DetailPane>
  );
}
