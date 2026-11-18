import { describe, expect, it } from 'vitest';
import {
  crumbText,
  dragDepth,
  dropPathAt,
  folderCrumbs,
  isFileDrag,
  trackPageDrag,
} from './file-drop';

/** A stand-in for a DOM element: `closest` walks the given chain. */
function el(chain: Array<Record<string, string>>) {
  return {
    closest: (selector: string) => {
      const name = selector.slice(1, -1);
      const hit = chain.find((attrs) => name in attrs);
      return hit ? { getAttribute: (n: string) => hit[n] ?? null } : null;
    },
  };
}

describe('isFileDrag', () => {
  it('is true only for a drag that carries files', () => {
    expect(isFileDrag(['Files'])).toBe(true);
    expect(isFileDrag(['text/plain', 'Files'])).toBe(true);
    expect(isFileDrag(['text/plain'])).toBe(false);
    expect(isFileDrag([])).toBe(false);
    expect(isFileDrag(null)).toBe(false);
  });

  it('is never one for a drag that began in the page (an image Chrome lists as Files)', () => {
    expect(isFileDrag(['Files'], true)).toBe(false);
    expect(isFileDrag(['text/uri-list', 'Files'], true)).toBe(false);
    expect(isFileDrag(['Files'], false)).toBe(true);
  });
});

describe('trackPageDrag', () => {
  const fire = (t: EventTarget, type: string) => t.dispatchEvent(new Event(type));

  it('is on from a dragstart until the drag ends or drops', () => {
    for (const end of ['dragend', 'drop']) {
      const win = new EventTarget();
      const drag = trackPageDrag(win);
      expect(drag.active()).toBe(false);
      fire(win, 'dragstart');
      expect(drag.active()).toBe(true);
      fire(win, end);
      expect(drag.active()).toBe(false);
    }
  });

  it('clears on the next pointerdown or mousemove when the drag was swallowed', () => {
    for (const next of ['pointerdown', 'mousemove']) {
      const win = new EventTarget();
      const drag = trackPageDrag(win);
      fire(win, 'dragstart');
      fire(win, next);
      expect(drag.active()).toBe(false);
    }
  });

  it('hears nothing once stopped', () => {
    const win = new EventTarget();
    const drag = trackPageDrag(win);
    drag.stop();
    fire(win, 'dragstart');
    expect(drag.active()).toBe(false);
  });
});

describe('dragDepth', () => {
  it('stays above 0 while the drag crosses child borders (no flicker)', () => {
    // enter the zone, enter a child (the child's enter comes before the
    // zone's leave), leave the zone: still inside.
    let d = 0;
    d = dragDepth(d, 'enter');
    d = dragDepth(d, 'enter');
    d = dragDepth(d, 'leave');
    expect(d).toBe(1);
    d = dragDepth(d, 'leave');
    expect(d).toBe(0);
  });

  it('never goes below 0, and a drop or the end clears it', () => {
    expect(dragDepth(0, 'leave')).toBe(0);
    expect(dragDepth(3, 'end')).toBe(0);
  });
});

describe('dropPathAt', () => {
  it('takes the nearest drop target under the pointer', () => {
    const target = el([{ 'data-drop-path': 'files.work.reports' }, { 'data-drop-path': 'files' }]);
    expect(dropPathAt(target, 'files.home')).toBe('files.work.reports');
  });

  it('falls back to the folder the screen is in', () => {
    expect(dropPathAt(el([{ class: 'row' }]), 'files.home')).toBe('files.home');
    expect(dropPathAt(null, 'files.home')).toBe('files.home');
    // A text node or the window has no `closest`.
    expect(dropPathAt({}, 'files.home')).toBe('files.home');
    // An empty attribute is not a folder.
    expect(dropPathAt(el([{ 'data-drop-path': '' }]), 'files.home')).toBe('files.home');
  });
});

describe('folderCrumbs', () => {
  it('names the root and reads each folder by its title, else its segment', () => {
    const titles = new Map([['files.work', 'Work']]);
    expect(folderCrumbs('files.work.q3_reports', (p) => titles.get(p))).toEqual([
      'Files',
      'Work',
      'q3-reports',
    ]);
    expect(folderCrumbs('files')).toEqual(['Files']);
    expect(folderCrumbs('files.a', undefined, 'All files')).toEqual(['All files', 'a']);
  });

  it('joins as one line', () => {
    expect(crumbText(['Files', 'A', 'B'])).toBe('Files › A › B');
  });
});
