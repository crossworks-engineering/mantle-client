/**
 * Where lessons come from: the top-level pages folder named "Lessons"
 * (lib/lessons/model.ts). Only a page found in that folder, in the caller's
 * own scope, is ever played, and only its published body (never a draft).
 *
 * The folder is meant to be written by Admin users only. The client cannot
 * prove that on its own, so it refuses what it can see: a lesson the
 * caller may change, when the caller is not an Admin user, is not played
 * (someone who may change it could have written it). The brain holds the
 * rest (phase 3).
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
export async function loadLesson(id: string, opts: { adminUser: boolean }): Promise<LoadedLesson> {
  const lessons = await listLessons();
  if (!lessons.some((l) => l.id === id)) {
    return { problems: ['That page is not in the Lessons folder, so it is not played.'] };
  }
  const { page } = await apiFetch<{ page: { doc: unknown; mayEdit?: boolean } }>(
    `/api/pages/${encodeURIComponent(id)}`,
  );
  if (!opts.adminUser && page.mayEdit) {
    return { problems: ['You may change this lesson, so it is not played. Ask an admin.'] };
  }
  const yaml = lessonSource(page.doc);
  if (yaml === null) return { problems: ['The page has no ```lesson block.'] };
  const parsed = parseLesson(yaml);
  return parsed.lesson ? { lesson: parsed.lesson } : { problems: parsed.problems };
}
