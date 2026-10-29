'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  RecallMapCreateDTO,
  RecallMapCreateResultDTO,
  RecallMapDetailDTO,
  RecallMapPatchDTO,
  RecallWriteResultDTO,
} from '@mantle/web-ui/types/recall-v2';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { Switch } from '@mantle/web-ui/ui/switch';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { Field, FieldDescription, FieldLabel } from '@mantle/web-ui/ui/field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { treeKey } from '@/components/item-tree/tree-api';
import { RECALL_LINE_MAX, RECALL_TITLE_MAX, recallKeys, writeErrorText } from '@/lib/recall-v2';
import type { MapWrite } from './use-map-write';
import { play } from '@/lib/sounds/play';

/** A new native map. The brain writes its entry card (`start`) with it, and
 *  an owner-created map is published at once. */
export function CreateMapDialog({
  open,
  onOpenChange,
  onCreated,
  folderName = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (mapId: string) => void;
  /** "New map inside" a tree folder: its name, for the title. */
  folderName?: string | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [enterWhen, setEnterWhen] = useState('');
  const [pending, setPending] = useState(false);
  const valid = title.trim() !== '' && enterWhen.trim() !== '';

  async function onSave() {
    setPending(true);
    try {
      const body: RecallMapCreateDTO = { title: title.trim(), enterWhen: enterWhen.trim() };
      const res = await apiSend<RecallMapCreateResultDTO>('/api/recall/maps', 'POST', body);
      await qc.invalidateQueries({ queryKey: recallKeys.maps });
      void qc.invalidateQueries({ queryKey: treeKey('recall') });
      play('success');
      toast.success(`Map created. Agents open it as ${res.slug}.`);
      onOpenChange(false);
      onCreated(res.mapId);
    } catch (err) {
      play('danger');
      toast.error(writeErrorText(err, 'Could not create the map.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!pending ? onOpenChange(o) : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{folderName ? `New map in “${folderName}”` : 'New map'}</DialogTitle>
          <DialogDescription>
            A map is a set of cards agents walk one at a time. It starts with its entry card.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="recall-map-title">Title</FieldLabel>
            <Input
              id="recall-map-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="MantleOS fleet"
              maxLength={RECALL_TITLE_MAX}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="recall-map-enter">Enter when</FieldLabel>
            <Input
              id="recall-map-enter"
              value={enterWhen}
              onChange={(e) => setEnterWhen(e.target.value)}
              placeholder="working on any MantleOS server or box"
              maxLength={RECALL_LINE_MAX}
            />
            <FieldDescription>
              The catalog line. Agents read it to decide whether this map is for them.
            </FieldDescription>
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <SubmitButton pending={pending} disabled={!valid} onClick={onSave} type="button">
            Create map
          </SubmitButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Title, enter-when and slug. A rename keeps the slug on purpose (agents
 *  and skills remember slugs); changing the slug is a separate, explicit act,
 *  and the old one keeps resolving. */
export function MapSettingsDialog({
  map,
  write,
  open,
  onOpenChange,
}: {
  map: RecallMapDetailDTO;
  write: MapWrite;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [title, setTitle] = useState(map.title);
  const [enterWhen, setEnterWhen] = useState(map.enterWhen);
  const [slug, setSlug] = useState(map.slug);
  const patch: Omit<RecallMapPatchDTO, 'version'> = {};
  if (title.trim() && title.trim() !== map.title) patch.title = title.trim();
  if (enterWhen.trim() && enterWhen.trim() !== map.enterWhen) patch.enterWhen = enterWhen.trim();
  if (slug.trim() && slug.trim() !== map.slug) patch.slug = slug.trim();
  const changed = Object.keys(patch).length > 0;

  async function onSave() {
    const res = await write.run(
      (version) =>
        apiSend<RecallWriteResultDTO>(`/api/recall/maps/${map.id}`, 'PATCH', {
          ...patch,
          version,
        }),
      'Could not save the map.',
    );
    if (!res) {
      play('danger');
      return;
    }
    play('success');
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!write.pending ? onOpenChange(o) : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Map settings</DialogTitle>
          <DialogDescription>
            Renaming the map renames its entry card too. The slug stays unless you change it here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="recall-map-settings-title">Title</FieldLabel>
            <Input
              id="recall-map-settings-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={RECALL_TITLE_MAX}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="recall-map-settings-enter">Enter when</FieldLabel>
            <Input
              id="recall-map-settings-enter"
              value={enterWhen}
              onChange={(e) => setEnterWhen(e.target.value)}
              maxLength={RECALL_LINE_MAX}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="recall-map-settings-slug">Slug</FieldLabel>
            <Input
              id="recall-map-settings-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="font-mono"
            />
            <FieldDescription>
              What agents and skills remember. The old slug keeps working after a change.
            </FieldDescription>
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={write.pending}>
            Cancel
          </Button>
          <SubmitButton pending={write.pending} disabled={!changed} onClick={onSave} type="button">
            Save map
          </SubmitButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A new card after `fromSlug`. With "Link from" on, the card it is added
 *  from gains an option to it. The brain has no single write for both, so it
 *  is two: the card, then the option. Once the card is made the dialog closes
 *  and the new card opens, whatever happens to the option: a second click
 *  must never make a second card. A failed option is reported by `linkFrom`,
 *  and the card is left an orphan, which the brain warns about. */
export function AddCardDialog({
  mapId,
  from,
  write,
  open,
  onOpenChange,
  onAdded,
  linkFrom,
}: {
  mapId: string;
  from: { slug: string; title: string } | null;
  write: MapWrite;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (slug: string) => void;
  /** Adds the option from `from` to the new card. Null when the open card
   *  has unsaved edits: writing its options now would overwrite them. */
  linkFrom: ((slug: string, title: string, useWhen: string) => Promise<void>) | null;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [link, setLink] = useState(from !== null && linkFrom !== null);
  const [useWhen, setUseWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const linking = from !== null && link && linkFrom !== null;
  // The brain refuses an option without a use-when line: it is what an agent
  // reads to decide whether to follow it.
  const valid = title.trim() !== '' && (!linking || useWhen.trim() !== '');

  async function onSave() {
    if (busy) return;
    setBusy(true);
    const t = title.trim();
    const res = await write.run(
      (version) =>
        apiSend<RecallWriteResultDTO>(`/api/recall/maps/${mapId}/cards`, 'POST', {
          title: t,
          bodyMd: '',
          options: [],
          version,
          ...(from ? { after: from.slug } : {}),
        }),
      'Could not add the card.',
    );
    if (!res?.cardSlug) {
      play('danger');
      setBusy(false);
      return;
    }
    play('success');
    const slug = res.cardSlug;
    // Wait for the map to list the new card, so opening it does not land on
    // the entry card for a moment. A failed reload only costs that moment.
    await qc.refetchQueries({ queryKey: recallKeys.map(mapId), exact: true }).catch(() => {});
    onOpenChange(false);
    onAdded(slug);
    if (linking && linkFrom) void linkFrom(slug, t, useWhen.trim());
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!busy ? onOpenChange(o) : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New card</DialogTitle>
          <DialogDescription>
            It opens in the editor next, empty, for you to write.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="recall-card-new-title">Title</FieldLabel>
            <Input
              id="recall-card-new-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={RECALL_TITLE_MAX}
              autoFocus
            />
          </Field>
          {from && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
              <div className="min-w-0">
                <FieldLabel htmlFor="recall-card-new-link">Link from {from.title}</FieldLabel>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {linkFrom
                    ? 'Adds an option on that card leading here, so agents can reach it.'
                    : 'Save the open card first to link from it.'}
                </p>
              </div>
              <Switch
                id="recall-card-new-link"
                checked={link && linkFrom !== null}
                onCheckedChange={setLink}
                disabled={linkFrom === null}
              />
            </div>
          )}
          {linking && (
            <Field>
              <FieldLabel htmlFor="recall-card-new-use-when">Use when</FieldLabel>
              <Input
                id="recall-card-new-use-when"
                value={useWhen}
                onChange={(e) => setUseWhen(e.target.value)}
                maxLength={RECALL_LINE_MAX}
                placeholder="you need the detail for one box"
              />
              <FieldDescription>
                When an agent on {from.title} should follow the option to this card.
              </FieldDescription>
            </Field>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} disabled={!valid || busy} onClick={onSave} type="button">
            Add card
          </SubmitButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
