'use client';

import { useCallback, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

/**
 * Every open item has its own address, read and edited (item header
 * contract, 2026-10-21), so it can be copied and shared without opening the
 * editor: `/<section>/<id>` reads it, `/<section>/<id>?edit=1` edits it, both
 * inside the list screen with the folders beside them. The section's layout
 * renders its list client for the index AND the item route, so the tree
 * stays mounted while the address changes.
 */
export function itemHref(section: string, id: string, edit = false): string {
  return `/${section}/${encodeURIComponent(id)}${edit ? '?edit=1' : ''}`;
}

/**
 * The open item of a section's list screen, from its address. `legacyParam`
 * is the query param the screen used before (`?id=`, `?selected=`): a link
 * that still carries one moves to the item's address, keeping its other
 * params.
 */
export function useItemAddress(
  section: string,
  legacyParam?: string,
): {
  /** The item in the address, read or edited. */
  id: string | null;
  /** `?edit=1`: the item is open in its editor. */
  editing: boolean;
  /** Open an item: its address, to read or to edit. */
  open: (id: string, edit?: boolean) => void;
  /** Back to the bare index (the item is gone). */
  close: () => void;
} {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const searchParams = useSearchParams();
  const id = typeof params.id === 'string' ? decodeURIComponent(params.id) : null;
  const editing = !!id && searchParams.get('edit') === '1';
  const legacyId = legacyParam ? searchParams.get(legacyParam)?.trim() || null : null;

  useEffect(() => {
    if (id || !legacyId || !legacyParam) return;
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete(legacyParam);
    const q = rest.toString();
    router.replace(`${itemHref(section, legacyId)}${q ? `?${q}` : ''}`, { scroll: false });
  }, [id, legacyId, legacyParam, router, searchParams, section]);

  // The screen's own params (a search, a view, a filter) travel with the
  // address; only the edit mode is the address's own.
  const keep = useCallback(() => {
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete('edit');
    if (legacyParam) rest.delete(legacyParam);
    return rest;
  }, [searchParams, legacyParam]);
  const open = useCallback(
    (next: string, edit = false) => {
      const rest = keep();
      if (edit) rest.set('edit', '1');
      const q = rest.toString();
      router.push(`${itemHref(section, next)}${q ? `?${q}` : ''}`, { scroll: false });
    },
    [keep, router, section],
  );
  const close = useCallback(() => {
    const q = keep().toString();
    router.push(`/${section}${q ? `?${q}` : ''}`);
  }, [keep, router, section]);
  return { id, editing, open, close };
}
