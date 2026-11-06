/**
 * Where lessons come from: the top-level pages folder named "Lessons" in the
 * Admin workspace (lib/lessons/model.ts). Only a page found in that folder,
 * in the caller's own scope, is ever offered or played, and only its
 * published body (never a draft).
 *
 * Members cannot write in the Admin workspace. The client checks the home
 * of the folder and of each lesson (GET /api/grants/:id, its `homeIsAdmin`)
 * with `lessonTrusted`, for every viewer: a lesson anywhere else is not
 * offered.
 */
import { apiFetch } from '@mantle/web-ui/api-fetch';
import type { GrantsResponse, TreeFolderPage } from '@mantle/client-types';
import {
  isLessonsFolder,
  lessonSource,
  lessonTrusted,
  parseLesson,
  type Lesson,
  type LessonHome,
  type LessonViewer,
} from './model';

export type LessonEntry = { id: string; title: string };

/** What the brain says of an item's home and who may change it, or null
 *  when it cannot be read. The two flags are read off the answer: the
 *  contract package this client pins does not name them yet. */
async function homeOf(id: string): Promise<LessonHome | null> {
  try {
    const g = await apiFetch<
      GrantsResponse & { homeIsAdmin?: unknown; editableOutsideAdmin?: unknown }
    >(`/api/grants/${encodeURIComponent(id)}`);
    return {
      home: g.home ?? null,
      rows: Array.isArray(g.rows) ? g.rows : undefined,
      ...(typeof g.homeIsAdmin === 'boolean' ? { homeIsAdmin: g.homeIsAdmin } : {}),
      ...(typeof g.editableOutsideAdmin === 'boolean'
        ? { editableOutsideAdmin: g.editableOutsideAdmin }
        : {}),
    };
  } catch {
    return null;
  }
}

/** The Lessons folder: of the top-level folders named Lessons, the one
 *  homed in the Admin workspace that only it may change (`lessonTrusted`),
 *  never just the first by name. */
async function lessonsFolderId(viewer: LessonViewer): Promise<string | null> {
  const root = await apiFetch<TreeFolderPage>('/api/tree/pages?sort=title');
  for (const folder of root.folders.filter(isLessonsFolder)) {
    if (lessonTrusted(await homeOf(folder.id), viewer)) return folder.id;
  }
  return null;
}

/** The lessons the caller may play, by title. */
export async function listLessons(viewer: LessonViewer): Promise<LessonEntry[]> {
  const folder = await lessonsFolderId(viewer);
  if (!folder) return [];
  const page = await apiFetch<TreeFolderPage>(
    `/api/tree/pages?folder=${encodeURIComponent(folder)}&sort=title`,
  );
  const checked = await Promise.all(
    page.items.map(async (i) => {
      const mayEdit = (i as { mayEdit?: boolean }).mayEdit === true;
      return lessonTrusted(await homeOf(i.id), viewer, mayEdit) ? i : null;
    }),
  );
  return checked.filter((i) => i !== null).map((i) => ({ id: i.id, title: i.title }));
}

export type LoadedLesson = { lesson: Lesson } | { problems: string[] };

/** One lesson, by page id: refused unless it is in the Admin workspace's
 *  Lessons folder. */
export async function loadLesson(id: string, viewer: LessonViewer): Promise<LoadedLesson> {
  const lessons = await listLessons(viewer);
  if (!lessons.some((l) => l.id === id)) {
    return {
      problems: [
        'That page is not in the Lessons folder of the Admin workspace, so it is not played.',
      ],
    };
  }
  const { page } = await apiFetch<{ page: { doc: unknown; mayEdit?: boolean } }>(
    `/api/pages/${encodeURIComponent(id)}`,
  );
  if (!viewer.adminWorkspaceId && page.mayEdit) {
    return { problems: ['You may change this lesson, so it is not played. Ask an admin.'] };
  }
  const yaml = lessonSource(page.doc);
  if (yaml === null) return { problems: ['The page has no ```lesson block.'] };
  const parsed = parseLesson(yaml);
  return parsed.lesson ? { lesson: parsed.lesson } : { problems: parsed.problems };
}
