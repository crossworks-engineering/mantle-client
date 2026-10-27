'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Code, Expand, Presentation, RotateCcw } from 'lucide-react';
import { CanvasSandbox } from '@mantle/share-ui/canvas-sandbox';
import { apiUrl, withAuth } from '@mantle/web-ui/api-fetch';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ItemHeader, type HeaderTool } from '@/components/layout/item-header';
import { AccessSlot } from '@/components/share/access-slot';
import { useDockActions } from '@/components/assistant/assistant-dock';
import { itemAccess, readOnlyNote } from '@/lib/item-access';
import { PresentChecksPanel } from './present-checks-panel';

/** A canvas as GET /api/presents/:id answers it. */
export type PresentDetail = {
  id: string;
  title: string;
  icon: string | null;
  tags: string[];
  description: string | null;
  summary: string | null;
  meta: {
    size: { w: number; h: number } | 'fill';
    theme: 'follow' | 'fixed';
    libs: string[];
    scripts: string[];
  };
  rev: number;
  source: string;
  updatedAt: string;
  createdAt: string;
};

function sizeLabel(size: PresentDetail['meta']['size']): string {
  return size === 'fill' ? 'Fills the view' : `${size.w} × ${size.h}, scaled to fit`;
}

/**
 * One canvas, live: the standard item header (fixed slots: Maximise is the
 * fourth from the right, drawn by ItemHeader), then the canvas running in its
 * sandbox, or its source, read only. The pencil is greyed: Present v1 is
 * agent driven, a canvas changes when Presenter changes it.
 *
 * Under it, for a traced P&ID only, the image checks the brain holds for
 * its circuit (PresentChecksPanel), folded to one row.
 *
 * Kind tools: Full screen (the browser's Fullscreen API on the frame alone,
 * for presenting; a deck's arrow keys reach it there), Replay (a new frame
 * from the start, so an animation runs again) and Source (pressed while the
 * source shows).
 */
export function PresentView({
  present,
  shares,
  onDelete,
}: {
  present: PresentDetail;
  /** The share marks for Access (`shareMarksOf`). */
  shares: unknown;
  onDelete: () => void;
}) {
  const toast = useToast();
  const access = itemAccess(present);
  const note = readOnlyNote(access);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [replay, setReplay] = useState(0);
  const [showSource, setShowSource] = useState(false);
  // Full screen needs the frame: none while it loads or after it was stopped.
  const [frameUp, setFrameUp] = useState(false);
  const queryClient = useQueryClient();
  const { registerTurnListener } = useDockActions();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['presents', present.id] });

  // Presenter changes a canvas from a chat turn: when any turn settles, read
  // the canvas again, so a new save shows (its rev reloads the frame).
  useEffect(
    () =>
      registerTurnListener(
        () => void queryClient.invalidateQueries({ queryKey: ['presents', present.id] }),
      ),
    [registerTurnListener, queryClient, present.id],
  );

  const fullScreen: HeaderTool = {
    key: 'full-screen',
    label: 'Full screen',
    icon: <Expand />,
    disabled: showSource || !frameUp,
    onSelect: () => {
      const frame = frameRef.current;
      if (!frame) return;
      frame
        .requestFullscreen()
        .then(() => frame.focus())
        .catch(() => toast.error('Full screen is not available here'));
    },
  };
  const replayTool: HeaderTool = {
    key: 'replay',
    label: 'Replay from the start',
    icon: <RotateCcw />,
    disabled: showSource,
    // Replay also reads the canvas again: a save that came in since shows.
    onSelect: () => {
      setReplay((n) => n + 1);
      refresh();
    },
  };
  const sourceTool: HeaderTool = {
    key: 'source',
    label: showSource ? 'Back to the canvas' : 'Source (read only)',
    icon: <Code />,
    pressed: showSource,
    onSelect: () => setShowSource((v) => !v),
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ItemHeader
        sticky
        section="Present"
        visual={
          present.icon ? (
            <span aria-hidden>{present.icon}</span>
          ) : (
            <Presentation className="size-4 text-muted-foreground" aria-hidden />
          )
        }
        title={present.title}
        access={
          <AccessSlot type="present" nodeId={present.id} canShare={access.share} shares={shares} />
        }
        tools={[fullScreen, replayTool, sourceTool]}
        // Present v1 is agent driven: the pencil keeps its slot, greyed, so
        // Maximise stays the fourth from the right as on every kind.
        edit={{ disabled: true, label: 'Ask Presenter in chat to change this canvas' }}
        onDelete={access.manage ? onDelete : undefined}
        deleteDisabled={!access.manage}
        deleteLabel="Delete canvas"
        move={
          access.move ? { kind: 'present', item: { id: present.id, title: present.title } } : null
        }
        info={{
          description: present.description ?? present.summary ?? undefined,
          tags: present.tags,
          rows: [
            ...(note ? [{ label: 'Access', value: note }] : []),
            { label: 'Size', value: sizeLabel(present.meta.size) },
            ...(present.meta.libs.length
              ? [{ label: 'Libraries', value: present.meta.libs.join(', ') }]
              : []),
            { label: 'Version', value: String(present.rev) },
            { label: 'Updated', value: new Date(present.updatedAt).toLocaleString() },
          ],
        }}
        infoLabel="About this canvas"
      />

      {/* A floor under the canvas and the source: on a narrow screen the
          detail pane can have no height of its own (as Draw's). */}
      <div className="relative min-h-[70vh] flex-1 md:min-h-0">
        {showSource ? (
          <pre
            tabIndex={0}
            aria-label="Canvas source (read only)"
            className="absolute inset-0 m-0 overflow-auto bg-muted/20 p-6 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground scrollbar-thin"
          >
            {present.source}
          </pre>
        ) : (
          <CanvasSandbox
            // A new save (rev) or Replay starts the canvas again.
            reloadKey={`${present.rev}:${replay}`}
            presentId={present.id}
            apiBase={apiUrl(`/api/presents/${present.id}`)}
            fetcher={(input, init) => fetch(input, withAuth(init))}
            title={present.title}
            frameRef={frameRef}
            loader={<Spinner />}
            onReady={() => setFrameUp(true)}
            // Reloading (a save, Replay) or stopped: no frame to fill the
            // screen with until it is ready again.
            onDown={() => setFrameUp(false)}
          />
        )}
      </div>
      {/* A traced P&ID's image checks, outside the frame (hidden for any
          other canvas). */}
      <PresentChecksPanel presentId={present.id} rev={present.rev} />
    </div>
  );
}
