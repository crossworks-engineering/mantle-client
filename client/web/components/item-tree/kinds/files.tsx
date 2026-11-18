import { KIND_TINT, describeFile } from '@mantle/web-ui/lib/mime-label';
import { cn } from '@mantle/web-ui/lib/utils';
import type { TreeItem } from '@mantle/web-ui/types/tree';
import { StatePill } from '@/components/item-list/state-pill';
import { HistoryMark } from '@/components/file-history/history-mark';
import { treeItemVersions } from '@/lib/file-history';
import type { TreeKindAdapter } from './types';

/** Files: the file type's icon in its conventional tint, then the state pill
 *  and the extension. The share marks are the row's (TreeName). */
export const filesAdapter: TreeKindAdapter = {
  kind: 'files',
  noun: { one: 'file', many: 'files' },
  lead: (item) => {
    const d = describeFile(null, item.title);
    const Icon = d.icon;
    return (
      <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center">
        <Icon className={cn('size-4', KIND_TINT[d.kind])} />
      </span>
    );
  },
  status: (item) => <FileStatus item={item} />,
};

function FileStatus({ item }: { item: TreeItem }) {
  return (
    <>
      <HistoryMark versions={treeItemVersions(item)} count={false} />
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
