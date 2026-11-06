'use client';

import * as React from 'react';
import { GraduationCap, Loader2 } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { uuid } from '@mantle/web-ui/lib/secure-context-fallbacks';
import { agentHands } from '@/lib/agent-ui/hands';
import { findTarget } from '@/lib/agent-ui/dom';
import { lessonCallTag, type AgentResult } from '@/lib/agent-ui/model';
import { listLessons, loadLesson, type LessonEntry } from '@/lib/lessons/source';
import type {
  Lesson,
  LessonAction,
  LessonCheck,
  LessonStep,
  LessonViewer,
} from '@/lib/lessons/model';

// ── the one place a lesson is asked for ─────────────────────────────────────

type Ask = { picker: boolean; offer: string | null };
let ask: Ask = { picker: false, offer: null };
const askListeners = new Set<() => void>();
const setAsk = (next: Partial<Ask>) => {
  ask = { ...ask, ...next };
  for (const fn of askListeners) fn();
};

/** Open the list of lessons (the profile menu's Lessons). */
export function openLessonPicker(): void {
  setAsk({ picker: true });
}

function useAsk(): Ask {
  return React.useSyncExternalStore(
    (fn) => {
      askListeners.add(fn);
      return () => askListeners.delete(fn);
    },
    () => ask,
    () => ask,
  );
}

const CHECK_MS = 5000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function checkHolds(check: LessonCheck | undefined): boolean {
  if (!check) return true;
  if (check.route && location.pathname !== check.route) return false;
  if (check.visible && !('el' in findTarget(check.visible, new Map()))) return false;
  return true;
}

async function runAction(a: LessonAction): Promise<AgentResult> {
  const hands = agentHands();
  if ('go' in a) return hands.go(a.go);
  if ('click' in a) return hands.click(a.click);
  if ('type' in a) return hands.type(a.type.target, a.type.text, { replace: a.type.replace });
  if ('select' in a) return hands.select(a.select.target, a.select.option);
  return hands.wait(a.wait.target, a.wait.ms);
}

/**
 * Lessons (lib/lessons): the profile menu's list of them, the "Start this
 * lesson?" card a `?lesson=<id>` link opens (a link never starts one by
 * itself), and the lesson card that plays one with the agent's hands.
 * Every part is `data-agent-host`, so the hands never press it.
 *
 * `adminWorkspaceId`: the Admin workspace, when the viewer is in it (the
 * shell names it). Only lessons homed there are offered (`lessonTrusted`).
 */
export function Lessons({ adminWorkspaceId }: { adminWorkspaceId: string | null }) {
  const { picker, offer } = useAsk();
  const [running, setRunning] = React.useState<Lesson | null>(null);
  const [problems, setProblems] = React.useState<string[] | null>(null);
  const viewer = React.useMemo<LessonViewer>(() => ({ adminWorkspaceId }), [adminWorkspaceId]);

  // A link may OFFER a lesson; only the user's Start plays it.
  React.useEffect(() => {
    const id = new URLSearchParams(location.search).get('lesson');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setAsk({ offer: id });
  }, []);

  const start = React.useCallback(
    async (id: string) => {
      setAsk({ picker: false, offer: null });
      setProblems(null);
      try {
        const loaded = await loadLesson(id, viewer);
        if ('problems' in loaded) setProblems(loaded.problems);
        else setRunning(loaded.lesson);
      } catch (err) {
        setProblems([err instanceof Error ? err.message : 'The lesson could not be loaded.']);
      }
    },
    [viewer],
  );

  return (
    <div data-agent-host="">
      {picker && (
        <LessonPicker viewer={viewer} onStart={start} onClose={() => setAsk({ picker: false })} />
      )}
      {offer && !running && (
        <LessonOffer onStart={() => void start(offer)} onClose={() => setAsk({ offer: null })} />
      )}
      {problems && (
        <Dialog open onOpenChange={(o) => !o && setProblems(null)}>
          <DialogContent data-agent-host="">
            <DialogHeader>
              <DialogTitle>This lesson cannot be played</DialogTitle>
            </DialogHeader>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </DialogContent>
        </Dialog>
      )}
      {running && <LessonCard lesson={running} onEnd={() => setRunning(null)} />}
    </div>
  );
}

function LessonPicker({
  viewer,
  onStart,
  onClose,
}: {
  viewer: LessonViewer;
  onStart: (id: string) => void;
  onClose: () => void;
}) {
  const [lessons, setLessons] = React.useState<LessonEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    listLessons(viewer).then(setLessons, (err: unknown) =>
      setError(err instanceof Error ? err.message : 'The lessons could not be loaded.'),
    );
  }, [viewer]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-agent-host="">
        <DialogHeader>
          <DialogTitle>Lessons</DialogTitle>
          <DialogDescription>
            A lesson shows you how something works by doing it in this window while you watch. You
            can stop it, or try each step yourself.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive-ink">{error}</p>
        ) : !lessons ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />
        ) : lessons.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No lessons yet. An admin adds them as pages in the Admin workspace's Lessons folder.
          </p>
        ) : (
          <ul className="space-y-1">
            {lessons.map((l) => (
              <li key={l.id}>
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => onStart(l.id)}
                >
                  <GraduationCap aria-hidden />
                  {l.title}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LessonOffer({ onStart, onClose }: { onStart: () => void; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-agent-host="">
        <DialogHeader>
          <DialogTitle>Start this lesson?</DialogTitle>
          <DialogDescription>
            The link opens a lesson that will use this window while you watch. It only plays lessons
            from the Admin workspace&apos;s Lessons folder, and anything that deletes, sends, shares
            or changes a setting still waits for you.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <Button autoFocus onClick={onStart}>
            Start
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Phase = 'ready' | 'doing' | 'trying' | 'done-step' | 'your-turn';

function LessonCard({ lesson, onEnd }: { lesson: Lesson; onEnd: () => void }) {
  const [index, setIndex] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>('ready');
  const [note, setNote] = React.useState<string | null>(null);
  const step: LessonStep = lesson.steps[index]!;
  const last = index === lesson.steps.length - 1;
  const hands = agentHands();

  // The session runs while the card is up; Stop on the bar ends both. Every
  // write the lesson sets off is tagged as this play's, so the brain
  // refuses a risky one as it does an agent's. A session the user took
  // over stays paused: only their Show me goes on.
  // Begun once per lesson: `onEnd` is read through a ref, so a re-render of
  // the parent (a route change) does not end and restart the session under
  // a running step.
  const onEndRef = React.useRef(onEnd);
  React.useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);
  React.useEffect(() => {
    hands.begin(lesson.title, { tag: lessonCallTag(uuid()) });
    const unsub = hands.subscribe((s) => {
      if (!s.active) onEndRef.current();
    });
    return () => {
      unsub();
      hands.end();
    };
  }, [hands, lesson]);

  // Each step opens by pointing at its control, when it names one.
  React.useEffect(() => {
    setPhase('ready');
    setNote(null);
    if (step.point) void hands.point(step.point, step.say);
  }, [hands, step]);

  // "Let me try": the user does the step and the check says when it holds.
  React.useEffect(() => {
    if (phase !== 'trying' && phase !== 'your-turn') return;
    let live = true;
    void (async () => {
      while (live && !checkHolds(step.check ?? undefined)) await sleep(400);
      if (!live) return;
      setNote('That is it.');
      setPhase('done-step');
    })();
    return () => {
      live = false;
    };
  }, [phase, step]);

  const advance = () => {
    hands.resume();
    if (last) hands.end();
    else setIndex((i) => i + 1);
  };

  const doIt = async () => {
    setPhase('doing');
    setNote(null);
    hands.resume();
    for (const action of step.do) {
      const out = await runAction(action);
      if (!out.ok) {
        if (out.error === 'stopped') return;
        // A step only the user may do, or a screen that is not as the
        // lesson expects: the user takes this one, and the check confirms.
        setNote(
          out.error === 'needs_user'
            ? 'This step is yours to do. Do it, and the lesson goes on.'
            : `${out.message} Try it yourself.`,
        );
        setPhase(step.check ? 'your-turn' : 'done-step');
        return;
      }
    }
    const deadline = Date.now() + CHECK_MS;
    while (Date.now() < deadline && !checkHolds(step.check)) await sleep(200);
    if (!checkHolds(step.check)) {
      setNote('The screen is not where this step expects. Try it yourself.');
      setPhase('your-turn');
      return;
    }
    setPhase('done-step');
  };

  return (
    <section
      data-agent-host=""
      role="region"
      aria-label={`Lesson: ${lesson.title}`}
      className="pointer-events-auto fixed bottom-4 right-4 z-[85] w-[min(22rem,calc(100%-2rem))] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
    >
      <p className="text-xs text-muted-foreground">
        {lesson.title} · step {index + 1} of {lesson.steps.length}
      </p>
      <p className="mt-1 text-sm">{step.say}</p>
      {note && <p className="mt-2 text-sm text-muted-foreground">{note}</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {index > 0 && phase !== 'doing' && (
          <Button size="sm" variant="ghost" onClick={() => setIndex((i) => i - 1)}>
            Back
          </Button>
        )}
        {phase === 'ready' && step.do.length > 0 && step.check && (
          <Button size="sm" variant="outline" onClick={() => setPhase('trying')}>
            Let me try
          </Button>
        )}
        {phase === 'ready' && step.do.length > 0 ? (
          <Button size="sm" autoFocus onClick={() => void doIt()}>
            Show me
          </Button>
        ) : phase === 'doing' ? (
          <Button size="sm" disabled>
            <Loader2 className="animate-spin" aria-hidden />
            Showing
          </Button>
        ) : phase === 'trying' || phase === 'your-turn' ? (
          <Button size="sm" variant="outline" onClick={advance}>
            Skip
          </Button>
        ) : (
          <Button size="sm" autoFocus onClick={advance}>
            {last ? 'Done' : 'Next'}
          </Button>
        )}
      </div>
    </section>
  );
}
