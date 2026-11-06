/**
 * Lessons, the pure half (plan page 596dbe4d, phase 2): a lesson is a page
 * in the pages folder named "Lessons", holding one fenced `lesson` block of
 * YAML. The app plays it in the user's own window with the agent's hands
 * (lib/agent-ui): each step says something, may point at a control, may do
 * a few actions, and may check that the screen is where it should be. The
 * user can try a step themselves ("Let me try") and the check confirms it.
 *
 *     ```lesson
 *     title: Add a task
 *     steps:
 *       - say: Tasks live on the Tasks screen.
 *         do:
 *           - go: /tasks
 *         check: { route: /tasks }
 *       - say: New task opens an empty task.
 *         point: { role: button, name: New task }
 *         do:
 *           - click: { role: button, name: New task }
 *     ```
 *
 * Parsing never throws: a broken lesson answers its problems in words, so
 * the author sees what to fix.
 */
import { parse as parseYaml } from 'yaml';
import { parseTarget, safeAgentRoute, type AgentTarget } from '../agent-ui/model';

export type LessonAction =
  | { go: string }
  | { click: AgentTarget }
  | { type: { target: AgentTarget; text: string; replace?: boolean } }
  | { select: { target: AgentTarget; option: string } }
  | { wait: { target: AgentTarget | null; ms: number } };

export type LessonCheck = { route?: string; visible?: AgentTarget };

export type LessonStep = {
  say: string;
  point?: AgentTarget;
  do: LessonAction[];
  check?: LessonCheck;
};

export type Lesson = { title: string; steps: LessonStep[] };

/** A lesson's size limits: a lesson is a short walk, not a script. */
export const MAX_STEPS = 30;
export const MAX_ACTIONS = 8;
export const MAX_SAY = 400;

/** The YAML of a page's first ```lesson block, from its document (the
 *  editor's JSON), or null. */
export function lessonSource(doc: unknown): string | null {
  const stack: unknown[] = [doc];
  while (stack.length) {
    const node = stack.shift() as {
      type?: string;
      attrs?: { language?: unknown };
      content?: unknown[];
      text?: string;
    } | null;
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'codeBlock' && node.attrs?.language === 'lesson') {
      return (node.content ?? []).map((c) => (c as { text?: string }).text ?? '').join('');
    }
    if (Array.isArray(node.content)) stack.push(...node.content);
  }
  return null;
}

type Parsed = { lesson: Lesson; problems: [] } | { lesson: null; problems: string[] };

/** A lesson from its YAML, or the problems that stop it. */
export function parseLesson(yamlText: string): Parsed {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    return { lesson: null, problems: [`The lesson is not valid YAML: ${(err as Error).message}`] };
  }
  const problems: string[] = [];
  const top = (raw ?? {}) as { title?: unknown; steps?: unknown };
  const title = typeof top.title === 'string' ? top.title.trim().slice(0, 120) : '';
  if (!title) problems.push('The lesson needs a title.');
  if (!Array.isArray(top.steps) || top.steps.length === 0) {
    problems.push('The lesson needs at least one step.');
    return { lesson: null, problems };
  }
  if (top.steps.length > MAX_STEPS) problems.push(`A lesson has at most ${MAX_STEPS} steps.`);
  const steps: LessonStep[] = [];
  top.steps.slice(0, MAX_STEPS).forEach((s, i) => {
    const step = parseStep(s, (p) => problems.push(`Step ${i + 1}: ${p}`));
    if (step) steps.push(step);
  });
  return problems.length ? { lesson: null, problems } : { lesson: { title, steps }, problems: [] };
}

function parseStep(raw: unknown, problem: (p: string) => void): LessonStep | null {
  const s = (raw ?? {}) as Record<string, unknown>;
  const say = typeof s.say === 'string' ? s.say.trim() : '';
  if (!say) problem('it needs a `say`.');
  if (say.length > MAX_SAY) problem(`its \`say\` is longer than ${MAX_SAY} characters.`);
  let point: AgentTarget | undefined;
  if (s.point !== undefined) {
    point = parseTarget(s.point) ?? undefined;
    if (!point) problem('`point` must name a control: { id }, { role, name } or { ref }.');
  }
  const actions = s.do === undefined ? [] : Array.isArray(s.do) ? s.do : null;
  if (!actions) problem('`do` must be a list.');
  if (actions && actions.length > MAX_ACTIONS) problem(`at most ${MAX_ACTIONS} actions.`);
  const done: LessonAction[] = [];
  for (const a of (actions ?? []).slice(0, MAX_ACTIONS)) {
    const action = parseAction(a);
    if (typeof action === 'string') problem(action);
    else done.push(action);
  }
  let check: LessonCheck | undefined;
  if (s.check !== undefined) {
    const c = (s.check ?? {}) as Record<string, unknown>;
    check = {};
    if (c.route !== undefined) {
      const route = safeAgentRoute(c.route);
      if (route) check.route = route;
      else problem('`check.route` must be an app path with no query.');
    }
    if (c.visible !== undefined) {
      const t = parseTarget(c.visible);
      if (t) check.visible = t;
      else problem('`check.visible` must name a control.');
    }
    if (!check.route && !check.visible) problem('`check` needs a `route` or a `visible`.');
  }
  return say
    ? {
        say: say.slice(0, MAX_SAY),
        ...(point ? { point } : {}),
        do: done,
        ...(check ? { check } : {}),
      }
    : null;
}

function parseAction(raw: unknown): LessonAction | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return 'each action is one of go, click, type, select, wait.';
  const keys = Object.keys(raw);
  if (keys.length !== 1) return 'each action names exactly one of go, click, type, select, wait.';
  const [key] = keys as [string];
  const v = (raw as Record<string, unknown>)[key];
  switch (key) {
    case 'go': {
      const route = safeAgentRoute(v);
      return route ? { go: route } : '`go` takes an app path with no query or hash.';
    }
    case 'click': {
      const t = parseTarget(v);
      return t ? { click: t } : '`click` must name a control.';
    }
    case 'type': {
      const o = (v ?? {}) as Record<string, unknown>;
      const t = parseTarget(o.target);
      if (!t || typeof o.text !== 'string') return '`type` takes a `target` and a `text`.';
      return {
        type: {
          target: t,
          text: o.text.slice(0, 2000),
          // Added to what the field holds, unless the lesson says replace.
          ...(o.replace === true ? { replace: true } : {}),
        },
      };
    }
    case 'select': {
      const o = (v ?? {}) as Record<string, unknown>;
      const t = parseTarget(o.target);
      if (!t || typeof o.option !== 'string') return '`select` takes a `target` and an `option`.';
      return { select: { target: t, option: o.option } };
    }
    case 'wait': {
      const o = (v ?? {}) as Record<string, unknown>;
      const t = o.target === undefined ? null : parseTarget(o.target);
      if (o.target !== undefined && !t) return '`wait.target` must name a control.';
      const ms = typeof o.ms === 'number' ? o.ms : 3000;
      return { wait: { target: t, ms } };
    }
    default:
      return `\`${key}\` is not an action (go, click, type, select, wait).`;
  }
}

/** The name of the pages folder lessons live in: a top-level folder of
 *  the Admin workspace, where members cannot write. */
export const LESSONS_FOLDER = 'Lessons';

/** Who is looking at a lesson: the Admin workspace's id when the viewer is
 *  in it (an Admin user; the shell names it), else null. */
export type LessonViewer = { adminWorkspaceId: string | null };

/** What GET /api/grants/:id says of an item's home: `homeIsAdmin` from a
 *  brain that sends it (any login that reads the item gets it), and the
 *  home as the caller may name it. */
export type LessonHome = {
  home?: { wsId: string | null } | null;
  homeIsAdmin?: boolean;
};

/**
 * Whether the Lessons folder, or a lesson in it, may be played to this
 * viewer: it is homed in the Admin workspace, where members cannot write.
 * The same rule for every viewer, Admin users included (fix round
 * contract, section 3):
 *
 *  - a brain that sends `homeIsAdmin` says it: only `true` plays;
 *  - an older brain does not: an Admin user names the home, so it must be
 *    the Admin workspace; anyone else cannot tell, so nothing plays.
 *
 * A lesson the viewer may change is never played to anyone but an Admin
 * user.
 */
export function lessonTrusted(
  grants: LessonHome | null | undefined,
  viewer: LessonViewer,
  mayEdit = false,
): boolean {
  if (!grants) return false;
  if (mayEdit && !viewer.adminWorkspaceId) return false;
  if (typeof grants.homeIsAdmin === 'boolean') return grants.homeIsAdmin;
  if (!viewer.adminWorkspaceId) return false;
  return !!grants.home && grants.home.wsId === viewer.adminWorkspaceId;
}

export function isLessonsFolder(f: { name: string; depth: number }): boolean {
  return f.depth === 1 && f.name.trim().toLowerCase() === LESSONS_FOLDER.toLowerCase();
}
