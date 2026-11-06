import { describe, expect, it } from 'vitest';
import { isLessonsFolder, lessonSource, lessonTrusted, parseLesson } from './model';

const GOOD = `
title: Add a task
steps:
  - say: Tasks live on the Tasks screen.
    do:
      - go: /tasks
    check: { route: /tasks }
  - say: New task opens an empty task.
    point: { role: button, name: New task }
    do:
      - click: { role: button, name: New task }
      - type: { target: { role: textbox, name: Title }, text: Buy milk }
      - wait: { ms: 500 }
`;

describe('parseLesson', () => {
  it('reads steps with their say, point, actions and check', () => {
    const { lesson, problems } = parseLesson(GOOD);
    expect(problems).toEqual([]);
    expect(lesson!.title).toBe('Add a task');
    expect(lesson!.steps).toHaveLength(2);
    expect(lesson!.steps[0]).toEqual({
      say: 'Tasks live on the Tasks screen.',
      do: [{ go: '/tasks' }],
      check: { route: '/tasks' },
    });
    expect(lesson!.steps[1]!.point).toEqual({ role: 'button', name: 'New task' });
    expect(lesson!.steps[1]!.do).toEqual([
      { click: { role: 'button', name: 'New task' } },
      { type: { target: { role: 'textbox', name: 'Title' }, text: 'Buy milk' } },
      { wait: { target: null, ms: 500 } },
    ]);
  });

  it('names every problem instead of throwing', () => {
    const { lesson, problems } = parseLesson(`
title: ''
steps:
  - say: ''
    do:
      - go: /tasks?lesson=2
      - click: { selector: '#x' }
      - delete: { id: x }
    check: {}
`);
    expect(lesson).toBeNull();
    expect(problems).toEqual(
      expect.arrayContaining([
        'The lesson needs a title.',
        'Step 1: it needs a `say`.',
        'Step 1: `go` takes an app path with no query or hash.',
        'Step 1: `click` must name a control.',
        'Step 1: `delete` is not an action (go, click, type, select, wait).',
        'Step 1: `check` needs a `route` or a `visible`.',
      ]),
    );
  });

  it('refuses YAML that does not parse, and a lesson with no steps', () => {
    expect(parseLesson('title: [').problems[0]).toMatch(/not valid YAML/);
    expect(parseLesson('title: x').problems).toEqual(['The lesson needs at least one step.']);
  });
});

describe('lessonSource', () => {
  it("finds the page's first lesson block, and only a lesson block", () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] },
        {
          type: 'codeBlock',
          attrs: { language: 'yaml' },
          content: [{ type: 'text', text: 'a: 1' }],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'lesson' },
          content: [
            { type: 'text', text: 'title: T\n' },
            { type: 'text', text: 'steps: []' },
          ],
        },
      ],
    };
    expect(lessonSource(doc)).toBe('title: T\nsteps: []');
    expect(lessonSource({ type: 'doc', content: [] })).toBeNull();
  });
});

describe('isLessonsFolder', () => {
  it('is the top-level folder named Lessons', () => {
    expect(isLessonsFolder({ name: 'Lessons', depth: 1 })).toBe(true);
    expect(isLessonsFolder({ name: ' lessons ', depth: 1 })).toBe(true);
    expect(isLessonsFolder({ name: 'Lessons', depth: 2 })).toBe(false);
    expect(isLessonsFolder({ name: 'Lesson notes', depth: 1 })).toBe(false);
  });
});

describe('a lesson types after what a field holds', () => {
  it('replaces only when the lesson says replace: true', () => {
    const steps = (t: string) =>
      parseLesson(`title: T\nsteps:\n  - say: s\n    do:\n      - type: ${t}\n`).lesson!.steps[0]!
        .do[0];
    const target = { role: 'textbox', name: 'Title' };
    expect(steps('{ target: { role: textbox, name: Title }, text: a }')).toEqual({
      type: { target, text: 'a' },
    });
    expect(steps('{ target: { role: textbox, name: Title }, text: a, replace: false }')).toEqual({
      type: { target, text: 'a' },
    });
    expect(steps('{ target: { role: textbox, name: Title }, text: a, replace: true }')).toEqual({
      type: { target, text: 'a', replace: true },
    });
  });
});

describe('lessonTrusted', () => {
  const ADMIN_WS = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0';
  const TEAM_WS = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
  const admin = { adminWorkspaceId: ADMIN_WS };
  const member = { adminWorkspaceId: null };

  it('a brain that sends homeIsAdmin decides it, for every viewer', () => {
    for (const viewer of [admin, member]) {
      expect(lessonTrusted({ homeIsAdmin: true, home: { wsId: null } }, viewer)).toBe(true);
      expect(lessonTrusted({ homeIsAdmin: false, home: { wsId: ADMIN_WS } }, viewer)).toBe(false);
    }
    // An Admin user may change it; that is fine in the Admin workspace.
    expect(lessonTrusted({ homeIsAdmin: true }, admin, true)).toBe(true);
    // Anyone else may not play a lesson they may change.
    expect(lessonTrusted({ homeIsAdmin: true }, member, true)).toBe(false);
  });

  it('an older brain: an Admin user checks the home it names; anyone else gets nothing', () => {
    expect(lessonTrusted({ home: { wsId: ADMIN_WS } }, admin)).toBe(true);
    expect(lessonTrusted({ home: { wsId: TEAM_WS } }, admin)).toBe(false);
    expect(lessonTrusted({ home: { wsId: null } }, admin)).toBe(false);
    expect(lessonTrusted({ home: { wsId: null } }, member)).toBe(false);
    expect(lessonTrusted({ home: { wsId: TEAM_WS } }, member)).toBe(false);
  });

  it('a home that could not be read is never trusted', () => {
    expect(lessonTrusted(null, admin)).toBe(false);
    expect(lessonTrusted(undefined, member)).toBe(false);
  });
});
