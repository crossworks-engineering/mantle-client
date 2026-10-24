'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { Editor, Range } from '@tiptap/core';
import {
  Code2,
  Columns2,
  Columns3,
  Columns4,
  FilePlus2,
  FolderOpen,
  Heading1,
  Heading2,
  Heading3,
  FoldVertical,
  Image as ImageIcon,
  Info,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Paperclip,
  PenTool,
  Sigma,
  Sparkles,
  Table as TableIcon,
  TextQuote,
  Type,
  type LucideIcon,
  Presentation,
} from 'lucide-react';
import { cn } from '@mantle/web-ui/lib/utils';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { columnsContent } from './column';
import { randomAsideAngle, randomAsideColor } from '@mantle/web-ui/aside-style';
import { uploadAndInsert } from './upload';
import { openDrawPicker } from './draw-picker';
import { openCanvasPicker } from './canvas-picker';

/** Open a native file picker, upload the chosen file, and insert the matching
 *  node (image or file chip) at the current selection. */
function pickAndUpload(editor: Editor, range: Range, accept: string) {
  editor.chain().focus().deleteRange(range).run();
  const input = document.createElement('input');
  input.type = 'file';
  if (accept) input.accept = accept;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void uploadAndInsert(editor, file);
  };
  input.click();
}

/**
 * Create a page NEXT TO this one (in the same folder; pages do not nest,
 * folder phase 7) and drop a page link card (`childPage`) at the cursor. The
 * folder comes from the SlashCommand extension's storage. The page row is
 * created server-side immediately, so it exists in the tree the moment the
 * card appears; the card insert itself is an editor change that autosaves
 * into this page's draft like any other edit. Rename the new page from inside
 * it; the card refreshes its title on mount.
 */
async function insertNewPage(editor: Editor, range: Range) {
  const storage = editor.storage as unknown as Record<
    string,
    | { pageId?: string | null; folderId?: string | null; onPageCreated?: (() => void) | null }
    | undefined
  >;
  const pageId = storage.slashCommand?.pageId ?? null;
  const folderId = storage.slashCommand?.folderId;
  // Remove the "/page" text regardless: the menu has already committed.
  editor.chain().focus().deleteRange(range).run();
  if (!pageId) return; // not inside a saved brain page
  try {
    const { page } = await apiSend<{
      page: { id: string; title: string; icon: string | null };
    }>('/api/pages', 'POST', {
      title: 'Untitled page',
      // Unknown (a brain before the pages tree): the brain's default place.
      ...(folderId !== undefined ? { folderId } : {}),
    });
    storage.slashCommand?.onPageCreated?.();
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'childPage',
        attrs: { pageId: page.id, title: page.title, icon: page.icon ?? null },
      })
      .run();
  } catch {
    // Best-effort; the slash text is already removed so the editor is clean.
  }
}

export type SlashItem = {
  /** Stable key: what code matches on (the title is display copy). */
  id: string;
  title: string;
  description: string;
  group: string;
  icon: LucideIcon;
  keywords?: string[];
  command: (opts: { editor: Editor; range: Range }) => void;
};

const ITEMS: SlashItem[] = [
  {
    group: 'Basic',
    id: 'text',
    title: 'Text',
    description: 'Plain paragraph.',
    icon: Type,
    keywords: ['paragraph', 'p', 'body'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    group: 'Basic',
    id: 'heading-1',
    title: 'Heading 1',
    description: 'Large section heading.',
    icon: Heading1,
    keywords: ['h1', 'title', 'big'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    group: 'Basic',
    id: 'heading-2',
    title: 'Heading 2',
    description: 'Medium section heading.',
    icon: Heading2,
    keywords: ['h2', 'subtitle'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    group: 'Basic',
    id: 'heading-3',
    title: 'Heading 3',
    description: 'Small section heading.',
    icon: Heading3,
    keywords: ['h3'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  ...([1, 2, 3] as const).map((level): SlashItem => ({
    group: 'Basic',
    id: `fold-heading-${level}`,
    title: `Foldable heading ${level}`,
    description: 'A heading that folds the section under it.',
    icon: FoldVertical,
    keywords: ['toggle', 'fold', 'collapse', `h${level}`],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level, fold: 'open' }).run(),
  })),
  {
    group: 'Pages',
    id: 'new-page',
    title: 'New page',
    description: 'Create a page next to this one and link it here.',
    icon: FilePlus2,
    keywords: ['page', 'new', 'link', 'doc', 'document'],
    command: ({ editor, range }) => void insertNewPage(editor, range),
  },
  {
    group: 'Pages',
    id: 'folder-index',
    title: 'Folder index',
    description: "List this folder's pages, live, for whoever reads this page.",
    icon: FolderOpen,
    keywords: ['folder', 'index', 'list', 'pages', 'contents', 'toc'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'folderIndex', attrs: { folderId: null } })
        .run(),
  },
  {
    group: 'Lists',
    id: 'bullet-list',
    title: 'Bulleted list',
    description: 'A simple bullet list.',
    icon: List,
    keywords: ['ul', 'unordered', 'bullet'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    group: 'Lists',
    id: 'ordered-list',
    title: 'Numbered list',
    description: 'A list with ordering.',
    icon: ListOrdered,
    keywords: ['ol', 'ordered', 'number'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    group: 'Lists',
    id: 'task-list',
    title: 'To-do list',
    description: 'A checklist with checkboxes.',
    icon: ListTodo,
    keywords: ['task', 'todo', 'checkbox', 'check'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    group: 'Blocks',
    id: 'quote',
    title: 'Quote',
    description: 'Capture a quotation.',
    icon: TextQuote,
    keywords: ['blockquote', 'citation'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    group: 'Blocks',
    id: 'callout',
    title: 'Callout',
    description: 'A highlighted info box.',
    icon: Info,
    keywords: ['note', 'aside', 'tip', 'warning', 'info'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'callout',
          attrs: { variant: 'info' },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
  {
    group: 'Blocks',
    id: 'aside',
    title: 'Aside',
    description: 'A boxed note with a themed gradient.',
    icon: Sparkles,
    keywords: ['aside', 'sidebar', 'note', 'panel', 'gradient', 'box'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'aside',
          attrs: { color: randomAsideColor(), angle: randomAsideAngle() },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
  {
    group: 'Blocks',
    id: 'code',
    title: 'Code',
    description: 'A formatted code block.',
    icon: Code2,
    keywords: ['codeblock', 'pre', 'monospace'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    group: 'Blocks',
    id: 'equation',
    title: 'Equation',
    description: 'A block math formula (KaTeX).',
    icon: Sigma,
    keywords: ['math', 'latex', 'formula', 'katex', 'equation'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'blockMath', attrs: { latex: 'E = mc^2' } })
        .run(),
  },
  {
    group: 'Media',
    id: 'image',
    title: 'Image',
    description: 'Upload and embed an image.',
    icon: ImageIcon,
    keywords: ['image', 'picture', 'photo', 'upload', 'img'],
    command: ({ editor, range }) => pickAndUpload(editor, range, 'image/*'),
  },
  {
    group: 'Media',
    id: 'drawing',
    title: 'Drawing',
    description: 'Embed a whiteboard drawing (live snapshot).',
    icon: PenTool,
    keywords: ['draw', 'drawing', 'sketch', 'whiteboard', 'canvas', 'excalidraw'],
    // The picker dialog lives in PageEditor (a static item can't render React);
    // remove the "/drawing" text, then ask it to open at this selection.
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      openDrawPicker(editor);
    },
  },
  {
    group: 'Media',
    id: 'canvas',
    title: 'Canvas',
    description: 'Embed a Present canvas (snapshot; click to open it live).',
    icon: Presentation,
    keywords: ['canvas', 'present', 'deck', 'slides', 'dashboard', 'presentation'],
    // The picker dialog lives in PageEditor, as the drawing picker's.
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      openCanvasPicker(editor);
    },
  },
  {
    group: 'Media',
    id: 'file',
    title: 'File',
    description: 'Attach a file as a download.',
    icon: Paperclip,
    keywords: ['file', 'attachment', 'document', 'upload', 'pdf'],
    command: ({ editor, range }) => pickAndUpload(editor, range, ''),
  },
  {
    group: 'Blocks',
    id: 'divider',
    title: 'Divider',
    description: 'A horizontal rule.',
    icon: Minus,
    keywords: ['hr', 'rule', 'separator', '---'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    group: 'Blocks',
    id: 'table',
    title: 'Table',
    description: 'A simple table (+ to add, trash handles to delete rows/columns).',
    icon: TableIcon,
    keywords: ['grid', 'cells', 'spreadsheet', 'rows'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
        .run(),
  },
  {
    group: 'Columns',
    id: 'columns-2',
    title: '2 columns',
    description: 'Two side-by-side columns.',
    icon: Columns2,
    keywords: ['column', 'grid', 'layout', 'split', '2'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertContent(columnsContent(2)).run(),
  },
  {
    group: 'Columns',
    id: 'columns-3',
    title: '3 columns',
    description: 'Three side-by-side columns.',
    icon: Columns3,
    keywords: ['column', 'grid', 'layout', 'split', '3'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertContent(columnsContent(3)).run(),
  },
  {
    group: 'Columns',
    id: 'columns-4',
    title: '4 columns',
    description: 'Four side-by-side columns.',
    icon: Columns4,
    keywords: ['column', 'grid', 'layout', 'split', '4'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertContent(columnsContent(4)).run(),
  },
];

/** The Folder index gate an editor hands the slash command (its option at
 *  creation, its storage after): on only when the editor's caller said so.
 *  Left out is off: a brain before the pages tree. */
export function folderIndexGate(prop: boolean | undefined): boolean {
  return prop === true;
}

/** Filter the command list by the text typed after the slash. Every login
 *  has every item since workspaces W6b (a create lands in the login's
 *  workspace); the Folder index needs the pages tree, so an editor that says
 *  no (a brain before it) gets no such item. */
export function getSlashItems(query: string, opts: { folderIndex?: boolean } = {}): SlashItem[] {
  const q = query.trim().toLowerCase();
  const items = opts.folderIndex !== false ? ITEMS : ITEMS.filter((i) => i.id !== 'folder-index');
  if (!q) return items;
  return items.filter(
    (i) => i.title.toLowerCase().includes(q) || (i.keywords ?? []).some((k) => k.includes(q)),
  );
}

export type SlashMenuProps = {
  items: SlashItem[];
  command: (item: SlashItem) => void;
};

export type SlashMenuHandle = { onKeyDown: (p: { event: KeyboardEvent }) => boolean };

export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(function SlashMenu(
  { items, command },
  ref,
) {
  const [selected, setSelected] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSelected(0), [items]);

  // Keep the highlighted row in view during keyboard navigation.
  useLayoutEffect(() => {
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const choose = useCallback(
    (i: number) => {
      const item = items[i];
      if (item) command(item);
    },
    [items, command],
  );

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false;
        if (event.key === 'ArrowDown') {
          setSelected((s) => (s + 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowUp') {
          setSelected((s) => (s - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          choose(selected);
          return true;
        }
        return false;
      },
    }),
    [items, selected, choose],
  );

  if (items.length === 0) {
    return (
      <div className="w-80 rounded-xl border border-border bg-popover p-4 text-sm text-muted-foreground shadow-lg">
        No matching blocks
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-caret-menu-scroller
      className="max-h-[min(22rem,var(--caret-menu-max-h,22rem))] w-80 overflow-y-auto scrollbar-thin scrollbar-hair rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg"
    >
      {items.map((item, i) => {
        const showGroup = i === 0 || items[i - 1]?.group !== item.group;
        const Icon = item.icon;
        return (
          <div key={item.id}>
            {showGroup && (
              <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {item.group}
              </div>
            )}
            <RowButton
              data-index={i}
              onMouseEnter={() => setSelected(i)}
              onClick={() => choose(i)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                i === selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
              )}
            >
              {/* On the selected row every child must derive from
                  accent-foreground — a `bg-background` tile or a
                  `text-muted-foreground` line is paired with the WRONG surface
                  and washes out on themes whose accent is light. */}
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-md border',
                  i === selected
                    ? 'border-accent-foreground/25 bg-accent-foreground/10'
                    : 'border-border bg-background',
                )}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">{item.title}</span>
                <span
                  className={cn(
                    'block truncate text-xs',
                    i === selected ? 'text-accent-foreground' : 'text-muted-foreground',
                  )}
                >
                  {item.description}
                </span>
              </span>
            </RowButton>
          </div>
        );
      })}
    </div>
  );
});
