import { KIND_TINT, describeFile } from '@mantle/web-ui/lib/mime-label';
import { cn } from '@mantle/web-ui/lib/utils';
import type { TreeItem } from '@mantle/web-ui/types/tree';
import { StatePill } from '@/components/item-list/state-pill';
import type { TreeKindAdapter } from './types';
import { FileStatusBadge } from '@/app/(app)/files/file-status-badge';
import type { FileStatus as FileProcessingStatus } from '@/app/(app)/files/file-status';

/** Files: the file type's icon in its conventional tint, then the state pill
 *  and the extension. The share marks are the row's (TreeName). */
export const filesAdapter: TreeKindAdapter = {
  kind: 'files',
  noun: { one: 'file', many: 'files' },
  lead: (item) => {
    const d = describeFile(null, item.title);
    const Icon = d.icon;
    return (
      <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
        <Icon aria-hidden className={cn('size-4', KIND_TINT[d.kind])} />
        {/* P4: TreeItem.status on file items; not in the published
            TreeItem type yet, and absent from an older brain. */}
        <FileStatusBadge
          status={(item as { status?: FileProcessingStatus }).status}
          className="-right-0.5 -top-0.5"
        />
      </span>
    );
  },
  status: (item) => <FileStatus item={item} />,
};

function FileStatus({ item }: { item: TreeItem }) {
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
