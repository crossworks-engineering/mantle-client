'use client';

/**
 * /contacts master-detail. List on the left (340px accent cards), form on the
 * right. URL-driven search + pagination via useListNav; selection via ?id=.
 * Saving the form PATCHes /api/contacts/[id]; the "New" button POSTs an empty
 * contact and navigates to it so the form is the same surface for create+edit.
 *
 * Contact shares (brain migration 0214): the detail has a "Sharing" block
 * (Enable sharing, the code once, Regenerate, Revoke all) and a "Shared" tab
 * beside the details. A brain before 0214 sends no `sharing`: neither shows.
 */

import { useItemAddress } from '@/components/layout/use-item-address';
import { ItemHeader } from '@/components/layout/item-header';
import { useZenMode } from '@/components/layout/zen-mode';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Phone, Plus, Search, UserRound, X } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { Input } from '@mantle/web-ui/ui/input';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@mantle/web-ui/ui/field';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { Textarea } from '@mantle/web-ui/ui/textarea';
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
import { useToast } from '@mantle/web-ui/ui/toast';
import { TagInput } from '@/components/tag-input';
import { ListPager } from '@mantle/web-ui/layout/list-pager';
import { useListNav } from '@/lib/use-list-nav';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
// IMPORTANT: import from the *leaf* `contacts-format` subpath, NOT the
// `@/lib/contacts` re-export — that one barrels through `@mantle/content` →
// `@mantle/db` → `postgres` (Node-only `fs`), which Next can't ship to the
// browser. The DB-using server code keeps using @/lib/contacts as before.
import {
  formatCell,
  hasIdentity,
  isPlausibleEmailOrDomain,
  normalizeCountryCode,
  type ContactRow,
} from '@mantle/content-core/contacts-format';
import { ListCard, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { useSurfaceAssist } from '@/components/assistant/use-surface-assist';
import { ItemTree } from '@/components/item-tree/item-tree';
import { useTreeSearch } from '@/components/item-tree/use-tree-search';
import { contactsAdapter } from '@/components/item-tree/kinds/simple';
import { treeKey } from '@/components/item-tree/tree-api';
import { useTreeServes } from '@/components/item-tree/use-tree-kinds';
import { useFileNewItem } from '@/components/item-tree/use-file-new-item';
import type { TreeFolder } from '@mantle/web-ui/types/tree';
import { Tabs, TabsList, TabsTrigger } from '@mantle/web-ui/ui/tabs';
import { brainHasContactShares, type SharingContactRow } from '@/lib/contact-shares';
import { ContactSharedTab, ContactSharingBlock } from './contact-sharing';
import { play } from '@/lib/sounds/play';

type ContactsListResponse = {
  contacts: ContactRow[];
  total: number;
  page: number;
  pageSize: number;
};

export function ContactsClient() {
  // Maximise from the item header collapses the list.
  const { zen } = useZenMode();
  const searchParams = useSearchParams();
  const { go, pending } = useListNav();
  const newContact = useCreateContact();
  const newButton = (
    <NewContactButton onClick={() => newContact.create()} pending={newContact.pending} />
  );

  // URL is the source of truth (matches the old SSR page).
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const query = searchParams.get('q')?.trim() ?? '';
  // The contact in the address (`/contacts/<id>`; its form is always open,
  // so there is no `?edit=1`). An old `?id=` link moves there.
  const address = useItemAddress('contacts', 'id');
  const requestedId = address.id;

  // The item tree when this brain serves it for contacts (docs/folder-tree.md);
  // the paged card list for a brain before it, or if a tree call 404s.
  const treeServes = useTreeServes('contacts');
  const [treeGone, setTreeGone] = useState(false);
  const showTree = treeServes === true && !treeGone;
  const [treeQuery, setTreeQuery] = useTreeSearch();

  const listQuery = useQuery({
    queryKey: ['contacts', { q: query, page }],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (query) qs.set('q', query);
      if (page > 1) qs.set('page', String(page));
      const s = qs.toString();
      return apiFetch<ContactsListResponse>(`/api/contacts${s ? `?${s}` : ''}`);
    },
    placeholderData: (prev) => prev,
    enabled: !showTree,
  });

  const contacts = (showTree ? undefined : listQuery.data?.contacts) ?? [];
  const total = listQuery.data?.total ?? 0;
  const pageSize = listQuery.data?.pageSize ?? 50;

  // Selection defaults to the first row (master-detail convention); ?id wins. A
  // deep-linked id outside the current slice is fetched directly, as is every
  // contact opened from the tree (it has no rows, so no first-row default).
  const selectedId = requestedId ?? contacts[0]?.id ?? null;
  const selectedContactQuery = useQuery({
    queryKey: ['contacts', selectedId],
    queryFn: () =>
      apiFetch<{ contact: ContactRow }>(`/api/contacts/${selectedId}`).then((r) => r.contact),
    enabled: !!selectedId && !contacts.some((c) => c.id === selectedId),
  });
  const selected =
    (selectedId ? contacts.find((c) => c.id === selectedId) : null) ??
    (selectedContactQuery.data?.id === selectedId ? selectedContactQuery.data : null) ??
    null;

  // Pin the contact on screen, so "draft an email to them" has a referent.
  useSurfaceAssist({
    node: selected
      ? { id: selected.id, kind: 'contact', label: selected.title || 'Unnamed contact' }
      : null,
  });

  const [q, setQ] = useState(query);

  if (!showTree && listQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!showTree && listQuery.isError && !listQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <p className="text-muted-foreground">
          {listQuery.error instanceof Error ? listQuery.error.message : 'Failed to load contacts.'}
        </p>
        <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  // The form state (ContactForm) mirrors `selected` and resets when the
  // selection changes (it's keyed on selected.id). Local edits stay client-only
  // until Save runs.
  return (
    <MasterDetail
      id="contacts"
      listCollapsed={zen}
      list={
        showTree ? (
          <aside className="flex h-full flex-col bg-muted/20">
            {newContact.confirm}
            <ItemTree
              kind="contacts"
              adapter={contactsAdapter}
              selectedItemId={selectedId}
              query={treeQuery}
              onQueryChange={setTreeQuery}
              searchPlaceholder="Search contacts and folders…"
              actions={newButton}
              newItemInFolder={{ label: 'contact', onCreate: (f) => newContact.create(f) }}
              onOpenItem={(item) => address.open(item.id)}
              onUnsupported={() => setTreeGone(true)}
            />
          </aside>
        ) : (
          <>
            {/* ─── LIST ─────────────────────────────────────────────────── */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') go({ q: q || null, page: null });
                  }}
                  onBlur={() => {
                    if (q !== query) go({ q: q || null, page: null });
                  }}
                  placeholder="Search contacts…"
                  className="pl-8"
                />
              </div>
              {newButton}
            </div>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto scrollbar-thin p-3">
              {contacts.length === 0 ? (
                <li className="px-2 py-8 text-center text-sm text-muted-foreground">
                  {query ? `No contacts match "${query}".` : 'No contacts yet. Click + to add one.'}
                </li>
              ) : (
                contacts.map((c) => (
                  <li key={c.id}>
                    <ListCard
                      onClick={() => address.open(c.id)}
                      disabled={pending}
                      selected={selected?.id === c.id}
                      className="text-sm"
                    >
                      <div className="flex items-center gap-1.5">
                        <ListCardTitle>{c.title}</ListCardTitle>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {/* Surface company on the secondary line — but only when
                          it's not already the title (i.e. a company-only contact
                          whose title IS the company). For person@company contacts
                          the title is the person and we show the company here. */}
                        {c.company && c.company !== c.title ? (
                          <span className="truncate">{c.company}</span>
                        ) : c.email ? (
                          <span className="truncate">{c.email}</span>
                        ) : null}
                        {c.contactCounts.email && c.contactCounts.email > 0 ? (
                          <span className="ml-auto whitespace-nowrap">
                            ✉ {c.contactCounts.email}
                          </span>
                        ) : null}
                      </div>
                    </ListCard>
                  </li>
                ))
              )}
            </ul>
            <div className="border-t border-border px-3 py-2">
              <ListPager
                total={total}
                page={page}
                pageSize={pageSize}
                pending={pending}
                onGo={(p) => go({ page: p === 1 ? null : p })}
              />
            </div>
          </>
        )
      }
      detail={
        selected ? (
          <ContactForm key={selected.id} contact={selected} />
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
            {!showTree && contacts.length === 0
              ? 'Add your first contact. Saskia will then be able to email them.'
              : 'Pick a contact on the left.'}
          </div>
        )
      }
    />
  );
}

/** New: an empty contact, opened in its form. `folder`: "New contact
 *  inside" a tree folder, filed there first. `confirm` is the tree's question
 *  for a shared folder, for the caller to render. */
function useCreateContact() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const address = useItemAddress('contacts');
  const [pending, start] = useTransition();
  const { fileNew, confirm } = useFileNewItem('contacts', 'contact');
  const create = (folder: TreeFolder | null = null) => {
    start(async () => {
      let contact: ContactRow;
      try {
        // Create a fully-empty draft — the form opens to blank fields. Empty
        // contacts are inert (no email ⇒ not in the allowlist, no recipient
        // match ⇒ no counter bumps) until the user fills them in.
        ({ contact } = await apiSend<{ contact: ContactRow }>('/api/contacts', 'POST', {}));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return; // already bounced to /login
        toast.error(e instanceof Error ? e.message : 'Could not create contact');
        return;
      }
      if (folder) await fileNew(contact.id, folder);
      await queryClient.invalidateQueries({ queryKey: ['contacts'] });
      void queryClient.invalidateQueries({ queryKey: treeKey('contacts') });
      address.open(contact.id);
    });
  };
  return { create, pending, confirm };
}

function NewContactButton({ onClick, pending }: { onClick: () => void; pending: boolean }) {
  return (
    <Button size="sm" variant="default" onClick={onClick} disabled={pending} title="Add a contact">
      <Plus aria-hidden />
    </Button>
  );
}

function ContactForm({ contact }: { contact: ContactRow }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const address = useItemAddress('contacts');
  const [firstName, setFirstName] = useState(contact.firstName);
  const [lastName, setLastName] = useState(contact.lastName);
  const [company, setCompany] = useState(contact.company);
  const [emails, setEmails] = useState<string[]>(contact.emails.length ? contact.emails : ['']);
  const [countryCode, setCountryCode] = useState(contact.countryCode || '+27');
  const [cell, setCell] = useState(contact.cell);
  const [description, setDescription] = useState(contact.description);
  const [tags, setTags] = useState<string[]>(contact.tags);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const [pendingDelete, startDelete] = useTransition();
  const [tab, setTab] = useState<'details' | 'shared'>('details');
  const sharingRow = contact as SharingContactRow;
  const sharesKnown = brainHasContactShares(sharingRow);

  // Reset the form whenever a different contact is selected. (`key` on the
  // parent already remounts us; this is belt-and-braces if the parent stops
  // passing key for any reason.)
  useEffect(() => {
    setFirstName(contact.firstName);
    setLastName(contact.lastName);
    setCompany(contact.company);
    setEmails(contact.emails.length ? contact.emails : ['']);
    setCountryCode(contact.countryCode || '+27');
    setCell(contact.cell);
    setDescription(contact.description);
    setTags(contact.tags);
  }, [contact]);

  const cellPreview = useMemo(() => formatCell(countryCode, cell), [countryCode, cell]);
  /** Any non-empty row that is neither an address nor an `@domain` wildcard.
   *  Drives the group's `data-invalid` and its single `role="alert"` message —
   *  per-row messages would stack four copies of the same sentence. */
  const emailsInvalid = useMemo(
    () => emails.some((e) => e.trim() !== '' && !isPlausibleEmailOrDomain(e)),
    [emails],
  );

  const onSave = () => {
    // Client-side identity check — mirrors the server-side guard in
    // updateContact, so the user gets immediate feedback instead of a
    // round-trip + a generic error. The server still enforces it; this is
    // just a UX shortcut.
    if (!hasIdentity({ firstName, lastName, company })) {
      toast.error('Add a first name, last name, or company before saving.');
      return;
    }
    start(async () => {
      try {
        await apiSend<{ contact: ContactRow }>(`/api/contacts/${contact.id}`, 'PATCH', {
          first_name: firstName,
          last_name: lastName,
          company,
          emails: emails.map((e) => e.trim()).filter(Boolean),
          country_code: normalizeCountryCode(countryCode) || countryCode,
          cell,
          description,
          tags,
        });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return; // already bounced to /login
        play('danger');
        toast.error(e instanceof Error ? e.message : 'Could not save');
        return;
      }
      play('success');
      toast.success('Saved');
      // Refetch the list so the row's display name updates if it changed (and
      // the selected-detail row, which is read from the list).
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
      void queryClient.invalidateQueries({ queryKey: treeKey('contacts') });
    });
  };

  const onDelete = () => {
    startDelete(async () => {
      try {
        await apiSend(`/api/contacts/${contact.id}`, 'DELETE');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return; // already bounced to /login
        toast.error(e instanceof Error ? e.message : 'Could not delete');
        return;
      }
      toast.success('Deleted');
      setConfirmDelete(false);
      // Refetch so the deleted row is gone, then drop the id so selection
      // falls back to the first contact (or empty).
      await queryClient.invalidateQueries({ queryKey: ['contacts'] });
      void queryClient.invalidateQueries({ queryKey: treeKey('contacts') });
      address.close();
    });
  };

  const emailCount = contact.contactCounts.email ?? 0;
  const lastEmailAt = contact.lastContactedAt.email;

  return (
    // No `max-w-*`: the panel divider sets the measure now, so dragging the
    // pane wider actually widens the form (§8, resizable panes).
    <div>
      {/* The item header (contract 2026-10-21): one row; when it was added
          behind Info. A contact's form is always open, so it has no Edit
          pencil, and its sharing is the Shared tab, not Access. */}
      <ItemHeader
        section="Contacts"
        visual={<UserRound className="size-4 text-primary-ink" aria-hidden />}
        title={contact.title}
        onDelete={() => setConfirmDelete(true)}
        deleteLabel="Delete contact"
        move={{ kind: 'contacts', item: { id: contact.id, title: contact.title } }}
        info={{ rows: [{ label: 'Added', value: formatDateTime(contact.createdAt) }] }}
        infoLabel="About this contact"
      />
      <div className="flex flex-col gap-6 px-6 py-6">
        {sharesKnown && (
          <Tabs value={tab} onValueChange={(v) => setTab(v === 'shared' ? 'shared' : 'details')}>
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="shared">
                Shared
                {sharingRow.sharing?.shareCount ? ` (${sharingRow.sharing.shareCount})` : ''}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {sharesKnown && tab === 'shared' ? (
          <ContactSharedTab contactId={contact.id} name={contact.title || 'This contact'} />
        ) : (
          <>
            {sharesKnown && (
              <ContactSharingBlock
                contactId={contact.id}
                name={contact.title || 'This contact'}
                sharing={sharingRow.sharing ?? null}
              />
            )}

            {/* Activity summary — counts + last-contacted per method. */}
            {(emailCount > 0 || lastEmailAt) && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{emailCount}</span>
                  <span className="text-muted-foreground">
                    email{emailCount === 1 ? '' : 's'} sent
                  </span>
                </span>
                {lastEmailAt && (
                  <span className="text-muted-foreground">
                    last on <span className="text-foreground">{formatDateTime(lastEmailAt)}</span>
                  </span>
                )}
              </div>
            )}

            <FieldGroup>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="firstName">First name</FieldLabel>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="lastName">Last name</FieldLabel>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="company">Company</FieldLabel>
                <Input
                  id="company"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Modular"
                  aria-describedby="company-description"
                />
                <FieldDescription id="company-description">
                  Optional. Use the company alone for a supplier/org contact, or pair it with a
                  person.
                </FieldDescription>
              </Field>

              <Field data-invalid={emailsInvalid || undefined}>
                <FieldLabel asChild>
                  <span>Email addresses</span>
                </FieldLabel>
                <div className="space-y-2">
                  {emails.map((entry, i) => {
                    const invalid = entry.trim() !== '' && !isPlausibleEmailOrDomain(entry);
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          type="text"
                          value={entry}
                          onChange={(e) =>
                            setEmails((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                          }
                          placeholder={i === 0 ? 'orders@modular.co.za' : '@modular.co.za'}
                          autoComplete="off"
                          // `Input` paints its own invalid border off this attribute,
                          // so the hand-added `border-destructive` was a second way of
                          // saying the same thing — and the one that could drift.
                          aria-invalid={invalid || undefined}
                          aria-describedby={invalid ? 'emails-error' : undefined}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove email"
                          onClick={() =>
                            setEmails((prev) =>
                              prev.length === 1 ? [''] : prev.filter((_, j) => j !== i),
                            )
                          }
                        >
                          <X aria-hidden />
                        </Button>
                      </div>
                    );
                  })}
                </div>
                {/* Wrapped, not bare: a vertical `Field` stretches its DIRECT children
              to full width (`*:w-full`), which turned this small outline button
              into a full-width bar. The wrapper takes the stretch instead. */}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEmails((prev) => [...prev, ''])}
                  >
                    <Plus aria-hidden /> Add email
                  </Button>
                </div>
                {/* The red border was the only signal before, which a screen reader
              never got. §6b wants it announced as well as shown. */}
                <FieldError id="emails-error">
                  {emailsInvalid
                    ? 'An address must be a full address or a leading-@ domain wildcard.'
                    : null}
                </FieldError>
                <FieldDescription>
                  Each line is a full address (<code>orders@modular.co.za</code>) or a whole-domain
                  wildcard (<code>@modular.co.za</code>, trusting all mail from that domain).
                  MantleOS ingests mail from these into the brain; Saskia can email the plain
                  addresses. Adding one backfills the last 90 days.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel asChild>
                  <span>Cell number</span>
                </FieldLabel>
                <div className="grid grid-cols-[88px_1fr] gap-2">
                  <Input
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    placeholder="+27"
                    aria-label="Country code"
                    className="font-mono"
                  />
                  <Input
                    value={cell}
                    onChange={(e) => setCell(e.target.value)}
                    placeholder="760810774"
                    aria-label="Cell number"
                    inputMode="tel"
                  />
                </div>
                {cellPreview && (
                  <FieldDescription className="flex items-center gap-1.5">
                    <Phone className="size-3" aria-hidden />
                    <span className="font-mono">{cellPreview}</span>
                  </FieldDescription>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="description">Description — who is this, for the AI</FieldLabel>
                <Textarea
                  id="description"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Modular is the aluminium-profile supplier we use for printer projects. Sells 2020 and 3030 profiles."
                  aria-describedby="description-description"
                />
                <FieldDescription id="description-description">
                  The brain indexes this — facts and entities land on this contact&apos;s identity,
                  so Saskia can later answer &quot;who supplies aluminium profiles?&quot;.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel asChild>
                  <span>Tags</span>
                </FieldLabel>
                <TagInput value={tags} onChange={setTags} />
              </Field>

              {/* Footer row: divider on top, Save floats right — same shape as the
            task/event forms (`flex justify-end gap-2 border-t pt-4`). */}
              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <SubmitButton type="button" pending={pending} onClick={onSave}>
                  Save contact
                </SubmitButton>
              </div>
            </FieldGroup>
          </>
        )}

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this contact?</AlertDialogTitle>
              <AlertDialogDescription>
                {contact.title} will be removed. Saskia will no longer be able to email this address
                (deleting also removes them from the email allowlist).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pendingDelete}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onDelete}
                disabled={pendingDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {pendingDelete ? 'Deleting…' : 'Delete contact'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
