import type { LucideIcon } from 'lucide-react';
import {
  FileText,
  KeyRound,
  Map as MapIcon,
  PenTool,
  Presentation,
  Sigma,
  Table2,
  UserRound,
} from 'lucide-react';
import type { TreeItem, TreeKind } from '@mantle/web-ui/types/tree';
import { StatePill } from '@/components/item-list/state-pill';
import type { TreeKindAdapter } from './types';

/**
 * The kinds whose rows need nothing of their own: the kind's glyph, the title,
 * then the state pill, and the short `subtype` token when the brain sends one
 * (a secret's kind). The share marks are the row's (TreeName), every kind's.
 */
function simpleAdapter(
  kind: TreeKind,
  noun: TreeKindAdapter['noun'],
  Icon: LucideIcon,
): TreeKindAdapter {
  return {
    kind,
    noun,
    lead: () => (
      <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center">
        <Icon className="size-4 text-muted-foreground" />
      </span>
    ),
    status: (item) => <SimpleStatus item={item} />,
  };
}

function SimpleStatus({ item }: { item: TreeItem }) {
  return (
    <>
      {item.state && <StatePill state={item.state} className="px-1.5 py-0 text-[10px]" />}
      {item.subtype && (
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {item.subtype}
        </span>
      )}
      {item.author && (
        <span className="max-w-24 truncate text-[10px] text-muted-foreground">{item.author}</span>
      )}
    </>
  );
}

export const notesAdapter = simpleAdapter('notes', { one: 'note', many: 'notes' }, FileText);
/**
 * The kinds whose items carry an emoji icon of their own, picked in the
 * editor's header: the item's icon when it has one, else the kind's glyph.
 */
function ownIconAdapter(
  kind: TreeKind,
  noun: TreeKindAdapter['noun'],
  Icon: LucideIcon,
): TreeKindAdapter {
  const base = simpleAdapter(kind, noun, Icon);
  return {
    ...base,
    lead: (item) =>
      item.icon ? (
        <span
          aria-hidden
          className="inline-flex size-5 shrink-0 items-center justify-center text-base leading-none"
        >
          {item.icon}
        </span>
      ) : (
        base.lead(item)
      ),
  };
}

/** Pages (folder phase 7: they live in folders and never nest). */
export const pagesAdapter = ownIconAdapter('pages', { one: 'page', many: 'pages' }, FileText);
/** Drawings and tables: their paged lists showed the item's icon on its row,
 *  so the tree does too. */
export const drawAdapter = ownIconAdapter('draw', { one: 'drawing', many: 'drawings' }, PenTool);
/** Present canvases: in folders like drawings, the item's icon on its row. */
export const presentAdapter = ownIconAdapter(
  'present',
  { one: 'canvas', many: 'canvases' },
  Presentation,
);
export const tablesAdapter = ownIconAdapter('tables', { one: 'table', many: 'tables' }, Table2);
export const formulasAdapter = simpleAdapter(
  'formulas',
  { one: 'formula', many: 'formulas' },
  Sigma,
);
export const contactsAdapter = simpleAdapter(
  'contacts',
  { one: 'contact', many: 'contacts' },
  UserRound,
);
export const secretsAdapter = simpleAdapter(
  'secrets',
  { one: 'secret', many: 'secrets' },
  KeyRound,
);
/** Recall maps: the tree lists maps, never their cards (a card is a row of
 *  its map, not a node). The status slot shows `draft` for a map an agent
 *  created and the owner has not published yet. */
export const recallAdapter = simpleAdapter('recall', { one: 'map', many: 'maps' }, MapIcon);
