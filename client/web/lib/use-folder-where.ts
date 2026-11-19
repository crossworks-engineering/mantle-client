'use client';

import { useQueryClient } from '@tanstack/react-query';
import { crumbText, folderCrumbs } from '@/lib/file-drop';

/**
 * A folder path as one breadcrumb line ("Files › A › B"): by the folder
 * titles the Files screen loaded (the tree query), a path segment where it
 * has not. The one way a folder is named outside the tree: the upload dock,
 * the clash prompt, Details' Location and the Needs attention rows.
 */
export function useFolderWhere(): (parentPath: string) => string {
  const qc = useQueryClient();
  const folders = qc.getQueryData<{ folders?: Array<{ path: string; title?: string }> }>([
    'files',
    'tree',
  ])?.folders;
  const titles = new Map((folders ?? []).map((f) => [f.path, f.title]));
  return (path: string) => crumbText(folderCrumbs(path, (p) => titles.get(p))) || 'Files';
}
