'use client';

import { useQueryClient } from '@tanstack/react-query';
import { crumbText, folderCrumbs } from '@/lib/file-drop';

/**
 * Where an upload goes, as a breadcrumb line ("Files > A > B"): by the
 * folder titles the Files screen loaded, a path segment where it has not.
 * The dock's rows and the clash prompt say it the same way.
 */
export function useUploadWhere(): (parentPath: string) => string {
  const qc = useQueryClient();
  const folders = qc.getQueryData<{ folders?: Array<{ path: string; title?: string }> }>([
    'files',
    'tree',
  ])?.folders;
  const titles = new Map((folders ?? []).map((f) => [f.path, f.title]));
  return (path: string) => crumbText(folderCrumbs(path, (p) => titles.get(p)));
}
