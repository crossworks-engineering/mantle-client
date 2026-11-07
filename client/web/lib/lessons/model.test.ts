import { describe, expect, it } from 'vitest';
import { isLessonsFolder, lessonSource, parseLesson } from './model';

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
