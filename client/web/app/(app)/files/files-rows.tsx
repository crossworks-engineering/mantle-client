'use client';

/**
 * One file in the Files folder view: a thumbnail tile (grid) and a table
 * row (list). Both draw the same marks in the same places: the status
 * badge on the icon (file-status-badge.tsx), the history mark by the name
 * or on the meta line (file history), and the file's one menu (`menu`,
 * a FileRowMenu the caller builds once for both). A right-click opens
 * that menu; a click opens the file, cmd/ctrl or shift picks.
 */
import type { ReactNode } from 'react';
import { ChevronsRight, EyeOff } from 'lucide-react';
import { KIND_TINT, describeFile } from '@mantle/web-ui/lib/mime-label';
import { cn } from '@mantle/web-ui/lib/utils';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { WorkspaceChips } from '@/components/share/workspace-chips';
import { HistoryMark } from '@/components/file-history/history-mark';
import { ExtractionBadge } from './extraction-badge';
import { FileStatusBadge } from './file-status-badge';
import { fmtRelative, fmtSize, type FileRow } from './files-shared';

type FileItemProps = {
  file: FileRow;
  picked: boolean;
  /** The folder reads its files by name only (its own or an inherited rule). */
  folderNameOnly: boolean;
  onClick: (e: React.MouseEvent) => void;
  /** The file's box: picks it, Shift picks the range. */
  onPick: (range: boolean) => void;
  /** Shift+Space on the box. */
  onRangeKey: (e: React.KeyboardEvent) => void;
  /** A right-click opens the file's menu. */
  onMenu: () => void;
  /** The file's menu (FileRowMenu). */
  menu: ReactNode;
};

/** Read by name only: set on the file, or the folder's rule. */
const nameOnly = (f: FileRow, folderNameOnly: boolean) =>
  f.indexing === 'metadata' || f.indexingApplied === 'metadata' || (!f.indexing && folderNameOnly);

const contextMenu = (onMenu: () => void) => (e: React.MouseEvent) => {
  e.preventDefault();
  onMenu();
};

/** A thumbnail tile. Images load ?thumb=1 (cached 512px JPEG server-side);
 *  a 404 (not an image, render failed) flips the tile to the type icon. The
 *  box is top-left, the menu top-right, the status badge at the thumbnail's
 *  foot, so none of them cover another. */
export function FileTile({
  file: f,
  picked,
  folderNameOnly,
  onClick,
  onPick,
  onRangeKey,
  onMenu,
  menu,
  thumbUrl,
  picking,
}: FileItemProps & {
  /** The thumbnail's URL (with the asset token). */
  thumbUrl: string;
  /** A pick is on: every box shows. */
  picking: boolean;
}) {
  const described = describeFile(f.mimeType, f.filename);
  const TypeIcon = described.icon;
  const isImage = f.mimeType.startsWith('image/');
  return (
    <div className="group relative" onContextMenu={contextMenu(onMenu)}>
      <RowButton
        onClick={onClick}
        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
        data-mark-id={f.id}
        data-mark-kind="file"
        data-mark-label={f.filename}
        title={`${f.filename}, ${described.label}, ${fmtSize(f.sizeBytes)}`}
        className={cn(
          'flex w-full flex-col overflow-hidden rounded-md border bg-card text-left hover:shadow-sm',
          picked
            ? 'border-primary ring-2 ring-primary/40'
            : 'border-border hover:border-primary/40',
        )}
      >
        <span className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-muted/40">
          <FileStatusBadge
            status={f.status}
            extraction={f.extraction}
            size="lg"
            className="top-auto bottom-1.5 right-1.5 z-10"
          />
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- authed same-origin thumbnail; next/image can't carry the asset token
            <img
              src={thumbUrl}
              alt=""
              loading="lazy"
              draggable={false}
              className="h-full w-full object-cover"
              onError={(e) => {
                // Swap to the icon fallback: hide the img, reveal the sibling icon span.
                e.currentTarget.style.display = 'none';
                e.currentTarget.nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <span
            className={
              isImage ? 'hidden items-center justify-center' : 'flex items-center justify-center'
            }
          >
            <TypeIcon aria-hidden className={`size-10 ${KIND_TINT[described.kind]}`} />
          </span>
        </span>
        <span className="flex flex-col gap-0.5 px-2 py-1.5">
          <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 truncate text-xs font-medium">{f.filename}</span>
            <WorkspaceChips item={f} />
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {fmtSize(f.sizeBytes)}
            <HistoryMark versions={f.versions} />
            {nameOnly(f, folderNameOnly) && (
              <span className="inline-flex items-center gap-0.5">
                <EyeOff className="size-2.5" /> name only
              </span>
            )}
            <ExtractionBadge x={f.extraction} compact />
          </span>
        </span>
      </RowButton>
      <Checkbox
        aria-label={`Select ${f.filename}`}
        checked={picked}
        onClick={(e) => {
          e.preventDefault();
          onPick(e.shiftKey);
        }}
        onKeyDown={onRangeKey}
        className={cn(
          'absolute left-2 top-2 bg-background shadow-sm',
          !picked &&
            !picking &&
            'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
        )}
      />
      {menu}
    </div>
  );
}

/** A row of the list. The status badge sits on the type icon, the history
 *  mark after the extension, so the two never meet. */
export function FileListRow({
  file: f,
  picked,
  folderNameOnly,
  onClick,
  onPick,
  onRangeKey,
  onMenu,
  menu,
}: FileItemProps) {
  // MIME first, filename as tie-breaker: files uploaded before the server's
  // mime map learned audio/video/archives are stored as octet-stream, and
  // the extension still names them correctly.
  const described = describeFile(f.mimeType, f.filename);
  const TypeIcon = described.icon;
  return (
    <tr
      className={cn('group', picked ? 'bg-primary/5' : 'hover:bg-muted/30')}
      onContextMenu={contextMenu(onMenu)}
    >
      <td className="px-3 py-2">
        <Checkbox
          aria-label={`Select ${f.filename}`}
          checked={picked}
          onClick={(e) => {
            // Shift on the box picks the range too.
            e.preventDefault();
            onPick(e.shiftKey);
          }}
          onKeyDown={onRangeKey}
        />
      </td>
      <td className="px-3 py-2">
        <RowButton
          onClick={onClick}
          onMouseDown={(e) => e.shiftKey && e.preventDefault()}
          data-mark-id={f.id}
          data-mark-kind="file"
          data-mark-label={f.filename}
          className="flex items-center gap-2 text-left hover:underline"
        >
          <span className="relative inline-flex shrink-0">
            <TypeIcon aria-hidden className={`size-4 shrink-0 ${KIND_TINT[described.kind]}`} />
            <FileStatusBadge status={f.status} extraction={f.extraction} />
          </span>
          <span className="font-medium">{f.filename}</span>
          <span
            title={described.label}
            className="text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            {f.extension}
          </span>
          <HistoryMark versions={f.versions} />
          {nameOnly(f, folderNameOnly) && (
            <span
              title={
                f.indexing === 'metadata'
                  ? 'Name-only: content not indexed (set on this file)'
                  : 'Name-only: content not indexed (inherited from the folder)'
              }
              className="inline-flex items-center gap-0.5 rounded-sm bg-muted px-1 text-[10px] text-muted-foreground"
            >
              <EyeOff className="size-3 shrink-0" /> name only
            </span>
          )}
          <ExtractionBadge x={f.extraction} />
          {f.summary &&
            f.indexingApplied !== 'metadata' &&
            (!f.extraction || f.extraction.state === 'indexed') && (
              <span
                title="Indexed, summary ready"
                className="inline-flex items-center text-primary-ink"
              >
                <ChevronsRight className="size-3.5 shrink-0" />
              </span>
            )}
        </RowButton>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
        {described.label}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {fmtSize(f.sizeBytes)}
      </td>
      <td className="max-w-[40ch] truncate px-3 py-2 text-xs text-muted-foreground">
        {f.summary ?? <span className="italic">—</span>}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{fmtRelative(f.updatedAt)}</td>
      <td className="px-3 py-2 text-right">{menu}</td>
    </tr>
  );
}
