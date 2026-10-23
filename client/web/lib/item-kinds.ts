/**
 * Item kinds in the owner's words, and the lists to refresh after an item's
 * access changes. This file held the access levels (admin > team > client >
 * public) until workspaces W8: items are shared by workspace grants now, so
 * only the kind words and the query keys are left.
 *
 * Pure: no React, so the rules are unit-tested (item-kinds.test.ts).
 */

/** Each item kind in the owner's words (links, contact shares). */
export const ITEM_KIND_LABEL: Record<string, string> = {
  page: 'Page',
  note: 'Note',
  draw: 'Drawing',
  present: 'Canvas',
  task: 'Task',
  event: 'Event',
  file: 'File',
  app: 'App',
  table: 'Table',
  formula: 'Formula',
  branch: 'Folder',
};

export function kindLabel(type: string): string {
  return ITEM_KIND_LABEL[type] ?? type;
}

/** The TanStack Query prefixes to refresh after an item's access changes, so
 *  its list card and detail follow. */
export function queryKeysForType(type: string): string[][] {
  switch (type) {
    case 'page':
      return [['pages']];
    case 'note':
      return [['notes']];
    case 'draw':
      return [['draws']];
    case 'present':
      return [['presents']];
    case 'table':
      return [['tables']];
    case 'app':
      return [['apps']];
    case 'formula':
      return [['formulas'], ['formula']];
    case 'file':
    case 'branch':
      return [['files']];
    case 'task':
      return [['tasks']];
    case 'event':
      return [['events']];
    default:
      return [];
  }
}
