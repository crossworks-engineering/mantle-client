/**
 * Where lessons come from: the top-level pages folder named "Lessons"
 * (lib/lessons/model.ts). Only a page found in that folder, in the caller's
 * own scope, is ever played, and only its published body (never a draft).
 * A lesson acts with the user's own rights, as the user would.
 */
import { apiFetch } from '@mantle/web-ui/api-fetch';
import type { TreeFolderPage } from '@mantle/client-types';
import { isLessonsFolder, lessonSource, parseLesson, type Lesson } from './model';

export type LessonEntry = { id: string; title: string };

async function lessonsFolderId(): Promise<string | null> {
  const root = await apiFetch<TreeFolderPage>('/api/tree/pages?sort=title');
  return root.folders.find(isLessonsFolder)?.id ?? null;
}

/** The lessons the caller can read, by title. */
export async function listLessons(): Promise<LessonEntry[]> {
  const folder = await lessonsFolderId();
  if (!folder) return [];
  const page = await apiFetch<TreeFolderPage>(
    `/api/tree/pages?folder=${encodeURIComponent(folder)}&sort=title`,
  );
  return page.items.map((i) => ({ id: i.id, title: i.title }));
}

export type LoadedLesson = { lesson: Lesson } | { problems: string[] };

/** One lesson, by page id: refused unless it is in the Lessons folder. */
export async function loadLesson(id: string): Promise<LoadedLesson> {
  const lessons = await listLessons();
  if (!lessons.some((l) => l.id === id)) {
    return { problems: ['That page is not in the Lessons folder, so it is not played.'] };
  }
  const { page } = await apiFetch<{ page: { doc: unknown } }>(
    `/api/pages/${encodeURIComponent(id)}`,
  );
  const yaml = lessonSource(page.doc);
  if (yaml === null) return { problems: ['The page has no ```lesson block.'] };
  const parsed = parseLesson(yaml);
  return parsed.lesson ? { lesson: parsed.lesson } : { problems: parsed.problems };
}
