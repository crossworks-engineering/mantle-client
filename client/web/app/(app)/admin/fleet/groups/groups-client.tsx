'use client';

import { useState } from 'react';
import { UsersRound } from 'lucide-react';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Switch } from '@mantle/web-ui/ui/switch';
import type { FleetOverview } from '@/lib/fleet';
import { LABEL, MAX_MEMBERS, parseSlugs, SLUG } from '@/lib/fleet-writes';
import { Callout, DetailPane, FleetScreen, SendBar, TargetList } from '../cc-kit';
import { ConfirmSend } from '../fleet-writes';
import { kindLine, useSettingsSend } from '../settings-send';

/** A worker group on the boxes picked: made, or its members, name and
 *  switch updated, by slug. */
function Groups({ data, refresh }: { data: FleetOverview; refresh: () => void }) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [members, setMembers] = useState('');
  const [enabled, setEnabled] = useState(true);
  const s = useSettingsSend(data.boxes, refresh);

  const groupSlug = slug.trim().toLowerCase();
  const groupName = name.trim();
  const list = parseSlugs(members);
  const slugOk = SLUG.test(groupSlug);
  const nameOk = groupName === '' || LABEL.test(groupName);
  const membersOk =
    list.length >= 1 && list.length <= MAX_MEMBERS && list.every((m) => SLUG.test(m));
  const valid = slugOk && nameOk && membersOk && s.chosen.length > 0;

  const confirm = async () => {
    const ok = await s.go(
      {
        kind: 'workerGroup',
        slug: groupSlug,
        ...(groupName ? { name: groupName } : {}),
        members: list,
        enabled,
      },
      'Could not send the worker group.',
    );
    if (ok) {
      setSlug('');
      setName('');
      setMembers('');
      setEnabled(true);
    }
  };

  return (
    <>
      <MasterDetail
        id="cc-groups"
        list={
          <TargetList
            boxes={data.boxes}
            picked={s.picked}
            setPicked={s.setPicked}
            line={kindLine('workerGroup')}
          />
        }
        detail={
          <DetailPane
            icon={<UsersRound />}
            title="Send a worker group"
            actions={
              <label className="flex items-center gap-2 text-sm" htmlFor="fleet-group-enabled">
                Enabled
                <Switch id="fleet-group-enabled" checked={enabled} onCheckedChange={setEnabled} />
              </label>
            }
          >
            <Callout>
              Each box makes the group, or updates its members, name and switch when the slug is
              there. A box where a member is not an enabled worker changes nothing.
            </Callout>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) s.setConfirming(true);
              }}
            >
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="fleet-group-slug">Slug</FieldLabel>
                    <Input
                      id="fleet-group-slug"
                      className="font-mono"
                      placeholder="review-panel"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={64}
                      value={slug}
                      aria-invalid={groupSlug !== '' && !slugOk}
                      onChange={(e) => setSlug(e.target.value)}
                    />
                    <FieldDescription>
                      {groupSlug !== '' && !slugOk
                        ? 'A slug has small letters, digits, - and _ only.'
                        : 'A group with this slug is updated.'}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="fleet-group-name">Name (optional)</FieldLabel>
                    <Input
                      id="fleet-group-name"
                      autoComplete="off"
                      maxLength={120}
                      value={name}
                      aria-invalid={!nameOk}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="fleet-group-members">Members</FieldLabel>
                  <Input
                    id="fleet-group-members"
                    className="font-mono"
                    placeholder="extractor, summarizer"
                    autoComplete="off"
                    spellCheck={false}
                    value={members}
                    aria-invalid={members.trim() !== '' && !membersOk}
                    onChange={(e) => setMembers(e.target.value)}
                  />
                  <FieldDescription>
                    {members.trim() !== '' && !membersOk
                      ? `Give 1 to ${MAX_MEMBERS} worker slugs, with small letters, digits, - and _ only.`
                      : `1 to ${MAX_MEMBERS} worker slugs, with commas between them.`}
                  </FieldDescription>
                </Field>
                <SendBar count={s.chosen.length}>
                  <SubmitButton pending={false} disabled={!valid}>
                    {s.chosen.length > 0 ? `Send worker group to ${s.count}` : 'Send worker group'}
                  </SubmitButton>
                </SendBar>
              </FieldGroup>
            </form>
          </DetailPane>
        }
      />
      <ConfirmSend
        open={s.confirming}
        pending={s.pending}
        title={`Set worker group ${groupSlug} on ${s.count}?`}
        action="Send worker group"
        onCancel={() => s.setConfirming(false)}
        onConfirm={() => void confirm()}
      >
        Each box makes the group, or updates it when the slug is there. A box where a member is not
        an enabled worker changes nothing.
      </ConfirmSend>
    </>
  );
}

export function GroupsClient() {
  return (
    <FleetScreen needs="writes">
      {(data, refresh) => <Groups data={data} refresh={refresh} />}
    </FleetScreen>
  );
}
