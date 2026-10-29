'use client';

import { useEffect, useRef } from 'react';
import { useDefaultLayout, type PanelImperativeHandle } from 'react-resizable-panels';

import { cn } from '../lib/utils';
import useMediaQuery from '../hooks/use-media-query';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './resizable';

const LIST = 'list';
const DETAIL = 'detail';
const SPACER = 'spacer';

/** Tailwind's `md`, the breakpoint the master-detail scaffold has always used. */
const DESKTOP = '(min-width: 768px)';

/**
 * What `useDefaultLayout` reads on the SERVER.
 *
 * It must not be `undefined`: the hook's signature is `storage = localStorage`,
 * so an explicit `undefined` triggers the default, `localStorage` is not a
 * global in Node, and the hook's server snapshot then calls `.getItem` on
 * nothing. The whole subtree falls back to client rendering with
 * "Cannot read properties of undefined (reading 'getItem')".
 *
 * That went unseen while every ported screen read `useSearchParams` (through
 * `useListNav`) without a Suspense boundary, which de-opts the subtree to
 * client-only rendering — so `MasterDetail` was never reached on the server.
 * `/docs` is a layout with no search params and genuinely server-renders, which
 * is what surfaced it.
 *
 * A server render never has a saved layout to honour anyway: the panels are not
 * mounted until `useMediaQuery` resolves, which is client-side by definition.
 */
const NO_STORAGE = { getItem: () => null, setItem: () => {} };

/**
 * The list + detail scaffold from the style guide (§8), with a draggable
 * divider. Owns the pane classes rather than leaving them to each screen,
 * because the rules that make it work are easy to drop and expensive to debug:
 * both panes need `min-h-0`, and the scrolling detail pane needs `relative` or
 * its overflow escapes into `<main>` and paints a second, clipping scrollbar.
 *
 * The layout is remembered per `id` in `localStorage`, so a width the user drags
 * survives a reload and a return visit.
 *
 * THREE panels, not two. The detail pane holds a measure of reading text, so it
 * gets its own width and a handle on its right edge rather than stretching to
 * whatever the window happens to be: on a wide display a full-bleed form runs
 * to 1200px line lengths and reads badly. The third panel is empty — it exists
 * only to give the detail a right edge to drag against. `listFills` and
 * `detailFills` each drop it, for a screen where one side should take the
 * slack instead.
 *
 * Below `md` there is no divider and no spacer: the panes stack, exactly as the
 * grid did.
 *
 * `listCollapsed` drives the list column to zero width WITHOUT unmounting it —
 * what focus mode needs. The list keeps its search text, scroll position and
 * page, so leaving focus mode puts the screen back as it was instead of
 * reloading it. Unmounting would be much simpler and is exactly wrong; see the
 * note on the prop.
 */
export function MasterDetail({
  id,
  list,
  detail,
  defaultListSize = '340px',
  minListSize = '260px',
  maxListSize = '560px',
  defaultDetailSize = '672px',
  minDetailSize = '420px',
  maxDetailSize = '1100px',
  listFills = false,
  detailFills = false,
  detailFirst = false,
  listCollapsed,
  className,
}: {
  /** Persistence key. Unique per screen — two screens sharing one would share a width. */
  id: string;
  list: React.ReactNode;
  detail: React.ReactNode;
  defaultListSize?: string;
  minListSize?: string;
  maxListSize?: string;
  /** `672px` is `max-w-2xl`, the measure these forms used before they were draggable. */
  defaultDetailSize?: string;
  minDetailSize?: string;
  maxDetailSize?: string;
  /**
   * Invert which side absorbs slack. Default: the list is a fixed column and an
   * empty spacer takes the rest. With `listFills`, the LIST takes the rest and
   * there is no spacer — for a left pane that wants every spare pixel, like the
   * Kanban board's columns. The single handle then sets the detail's width,
   * which is the same gesture either way.
   */
  listFills?: boolean;
  /**
   * The mirror of `listFills`: the LIST keeps its fixed, draggable width and
   * the DETAIL absorbs the slack, with no spacer.
   *
   * For a detail pane that is not reading text. The default's 672px measure
   * exists to stop a FORM stretching to 1200px line lengths; an embedded app
   * viewport wants every pixel it can get, and capping it would shrink the
   * thing the screen exists to show.
   */
  detailFills?: boolean;
  /**
   * Put the detail on the LEFT and the list on the right. The Kanban board
   * reads left-to-right across its columns, so a form pinned to the right edge
   * sits at the end of that sweep; on the left it is where the eye starts.
   * Panel ids do not change, so a saved layout survives the flip.
   */
  detailFirst?: boolean;
  /**
   * Collapse the list column to zero and give the detail the full width —
   * focus mode on a list screen, where leaving the list beside the content
   * defeats the point of turning focus on.
   *
   * The list stays MOUNTED. Rendering `{collapsed ? null : list}` would be
   * less code and would throw away the user's search box, scroll position and
   * page on every toggle, so focus mode would double as a reset button. The
   * panel library collapses to `collapsedSize` and keeps children, which is
   * the whole reason this is a panel prop rather than a caller's ternary.
   *
   * PASSING IT AT ALL is what makes the panel collapsible, which is why it has
   * no default. `collapsible` also means "collapse when dragged below
   * `minSize`", so setting it unconditionally would let every ported screen's
   * list be dragged out of existence — a behaviour change to eight screens
   * that nobody asked for. Screens that never pass this keep today's
   * behaviour exactly: the drag stops at `minListSize`.
   */
  listCollapsed?: boolean;
  className?: string;
}) {
  const isDesktop = useMediaQuery(DESKTOP);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: `master-detail:${id}`,
    panelIds: listFills || detailFills ? [LIST, DETAIL] : [LIST, DETAIL, SPACER],
    // Window resizes and imperative calls shouldn't overwrite a width the user
    // chose deliberately.
    onlySaveAfterUserInteractions: true,
    storage: typeof window === 'undefined' ? NO_STORAGE : window.localStorage,
  });

  // Drive the collapse imperatively rather than by swapping `defaultSize`:
  // `defaultSize` is only read on mount, so a prop change would do nothing.
  // `expand()` restores the width the user last dragged, which is why the
  // round trip through focus mode does not reset the column to the default.
  //
  // `onlySaveAfterUserInteractions` above is what stops this writing 0 to
  // localStorage — a persisted collapse would leave the list gone after a
  // reload, with no handle left to drag it back.
  const collapsible = listCollapsed !== undefined;
  const listHandle = useRef<PanelImperativeHandle | null>(null);
  useEffect(() => {
    const panel = listHandle.current;
    if (!panel || !collapsible) return;
    if (listCollapsed) panel.collapse();
    else panel.expand();
    // `isDesktop` is a dependency because the PANEL is what this effect drives,
    // and below `isDesktop` there is no panel to drive — the narrow branch is a
    // CSS grid and `listHandle.current` is null. A screen that persists its
    // collapse restores `listCollapsed: true` before the media query resolves,
    // so on that path the state never changes again: the effect ran once
    // against the grid, returned at the null ref, and without `isDesktop` here
    // nothing re-ran it when the panels mounted a commit later. The list came
    // back at its saved width with the collapsed rail beside it — both on
    // screen, the rail offering to show a list that was never hidden.
  }, [collapsible, listCollapsed, isDesktop]);

  // `isDesktop` is null until the first effect runs. Falling back to the CSS
  // grid rather than to the stacked layout matters: the grid is responsive on
  // its own, so a desktop load shows the right shape immediately instead of
  // flashing a stacked list before the panels take over.
  if (!isDesktop) {
    // `hidden`, not unmounted — same contract as the collapsed panel above.
    const listCell = (
      <div
        className={cn(
          'flex flex-col border-b border-border md:h-full md:min-h-0 md:border-b-0 md:border-r',
          listCollapsed && 'hidden',
        )}
      >
        {list}
      </div>
    );
    const detailCell = (
      <div className="relative md:h-full md:min-h-0 md:overflow-y-auto md:scrollbar-thin">
        {detail}
      </div>
    );
    return (
      <div
        className={cn('md:grid md:h-full md:overflow-hidden', className)}
        style={{
          gridTemplateColumns: listCollapsed
            ? 'minmax(0, 1fr)'
            : detailFirst
              ? `${defaultDetailSize} 1fr`
              : listFills
                ? `1fr ${defaultDetailSize}`
                : `${defaultListSize} 1fr`,
        }}
      >
        {detailFirst ? detailCell : listCell}
        {detailFirst ? listCell : detailCell}
      </div>
    );
  }

  const listPanel = (
    <ResizablePanel
      id={LIST}
      panelRef={listHandle}
      collapsible={collapsible}
      collapsedSize="0px"
      // Sizeless when it fills: the panel group hands it whatever the detail
      // does not take, and the one handle governs the detail.
      defaultSize={listFills ? undefined : defaultListSize}
      minSize={listFills ? '320px' : minListSize}
      maxSize={listFills ? undefined : maxListSize}
    >
      {/* `overflow-hidden` is load-bearing at zero width: the panel shrinks,
          its contents do not, so without it the list paints straight over the
          detail instead of disappearing. */}
      <div className="flex h-full min-h-0 flex-col overflow-hidden">{list}</div>
    </ResizablePanel>
  );

  const detailPanel = (
    <ResizablePanel
      id={DETAIL}
      // Sizeless when it fills, for the same reason the list is under
      // `listFills`: the group hands it whatever is left.
      defaultSize={detailFills ? undefined : defaultDetailSize}
      minSize={detailFills ? undefined : minDetailSize}
      // No cap while the list is collapsed. The shell widens the group as
      // focus mode hides its chrome; a capped detail cannot take that width,
      // and the group hands it to the collapsed list instead, which then
      // shows at its minimum in focus mode and collapses again as the chrome
      // comes back.
      maxSize={detailFills || listCollapsed ? undefined : maxDetailSize}
    >
      <div className="relative h-full min-h-0 overflow-y-auto scrollbar-thin">{detail}</div>
    </ResizablePanel>
  );

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      id={`master-detail:${id}`}
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      className={cn('h-full items-stretch overflow-hidden', className)}
    >
      {/* The handle is a 1px `bg-border` rule, so it replaces the border the
          panes would otherwise carry rather than sitting beside it. */}
      {detailFirst ? detailPanel : listPanel}
      {/* No divider against a collapsed list: it would sit at the screen edge
          and drag a column the user has just asked to be rid of. */}
      {listCollapsed ? null : <ResizableHandle withHandle />}
      {detailFirst ? listPanel : detailPanel}
      {/* Empty by design. It is the detail pane's outer edge, nothing more, so
          the measure stays readable on a wide display instead of the form
          stretching to fill it. `minSize=0` lets it vanish entirely when the
          window is too narrow to afford any slack. Not needed when the list
          fills — there the detail already has a fixed width. */}
      {listFills || detailFills ? null : (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel id={SPACER} minSize="0px" />
        </>
      )}
    </ResizablePanelGroup>
  );
}
