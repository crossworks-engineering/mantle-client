'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { useColorTheme } from './color-theme-provider';
import { cn } from './lib/utils';
import {
  createDrift,
  driftOptionsFromSpec,
  encodeDriftSpec,
  readDriftThemeTokens,
  type DriftHandle,
  type DriftOptions,
  type DriftSpec,
} from '@mantle/share-ui/drift';

/**
 * Drift, filling its positioned parent. The engine and the spec codec are the
 * brain's (@mantle/share-ui/drift, the same code the /s reader paints with);
 * this file is only the React shell around them. The canvas and its WebGL context are
 * created ONCE per mount; every later change — options, spec, theme, mode —
 * is an `update()` (uniform writes), never a teardown.
 *
 * `onReady` hands out the engine handle (stats, pause/resume) for callers
 * that want it, like the lab.
 */
export function DriftBackdrop({
  options,
  className,
  onReady,
}: {
  options: Partial<DriftOptions>;
  className?: string;
  onReady?: (handle: DriftHandle | null) => void;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const handleRef = React.useRef<DriftHandle | null>(null);
  // Set once an engine was attempted, so a device without WebGL (createDrift
  // → null) is not retried — with a fresh canvas each time — on every change.
  const attemptedRef = React.useRef(false);
  const onReadyRef = React.useRef(onReady);
  React.useEffect(() => {
    onReadyRef.current = onReady;
  });
  // Keyed on content, so an equal options object in a new identity is free.
  const key = JSON.stringify(options);

  React.useEffect(() => {
    const next = JSON.parse(key) as Partial<DriftOptions>;
    if (handleRef.current) {
      handleRef.current.update(next);
      return;
    }
    const host = hostRef.current;
    if (!host || attemptedRef.current) return;
    attemptedRef.current = true;
    // A fresh canvas per engine: destroy() frees the context for good, and a
    // canvas whose context was lost can never hand out a new one — so reusing
    // the element would leave a Strict Mode remount (or any re-create) blank.
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    host.appendChild(canvas);
    handleRef.current = createDrift(canvas, next);
    onReadyRef.current?.(handleRef.current);
  }, [key]);

  React.useEffect(
    () => () => {
      const handle = handleRef.current;
      handleRef.current = null;
      attemptedRef.current = false;
      handle?.destroy();
      hostRef.current?.replaceChildren();
      onReadyRef.current?.(null);
    },
    [],
  );

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 size-full overflow-hidden', className)}
    />
  );
}

/**
 * A saved {@link DriftSpec} painted in the live theme. Colours are read off
 * the document a frame AFTER a theme/mode change commits: next-themes applies
 * the `.dark` class in a parent effect that runs after this child's, so a
 * synchronous read would see the outgoing theme.
 *
 * `overrides` lets a caller adjust engine-only knobs (resolution, fps cap,
 * pointer) without changing the stored spec. Real surfaces pass none: the
 * pointer lean is the lab's alone. The palette always holds the legibility
 * floor (muted text at AA, see driftOptionsFromSpec).
 *
 * Mount it ONCE per surface, in a persistent, non-scrolling layer (the app
 * shell does, beside its scroller): each mount compiles a shader, opens a
 * WebGL context and fades in, so it must never sit inside a page or be keyed
 * by the route.
 */
export function DriftThemeBackdrop({
  spec,
  className,
  overrides,
  onReady,
}: {
  spec: DriftSpec;
  className?: string;
  overrides?: Partial<DriftOptions>;
  onReady?: (handle: DriftHandle | null) => void;
}) {
  const { resolvedTheme } = useTheme();
  const { colorTheme } = useColorTheme();
  const specKey = encodeDriftSpec(spec);
  const [options, setOptions] = React.useState<Partial<DriftOptions> | null>(null);

  React.useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const tokens = readDriftThemeTokens();
      if (!tokens) {
        setOptions(null);
        return;
      }
      const mode = resolvedTheme === 'dark' ? 'dark' : 'light';
      const next = driftOptionsFromSpec(JSON.parse(specKey) as DriftSpec, tokens, mode);
      // A theme whose colours did not parse paints nothing, not a guess.
      setOptions(next.colors && next.colors.length > 0 ? next : null);
    });
    return () => cancelAnimationFrame(raf);
  }, [specKey, resolvedTheme, colorTheme]);

  if (!options) return null;
  return (
    <DriftBackdrop options={{ ...options, ...overrides }} className={className} onReady={onReady} />
  );
}
