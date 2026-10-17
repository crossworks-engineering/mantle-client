'use client';

import { useEffect, useState } from 'react';
import { Dices } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { Slider } from '@mantle/web-ui/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@mantle/web-ui/ui/toggle-group';
import { CopyButton } from '@mantle/web-ui/ui/copy-button';
import { DriftThemeBackdrop } from '@mantle/web-ui/drift-backdrop';
import {
  DRIFT_SPEED_MAX,
  DRIFT_STYLES,
  encodeDriftSpec,
  randomDriftSpec,
  type DriftHandle,
  type DriftPaletteSource,
  type DriftSpec,
  type DriftStats,
  type DriftStyle,
  type DriftTone,
} from '@mantle/web-ui/drift';

/**
 * The Drift lab — every option of the Neat replacement, live, in the current
 * colour theme. It drives the same path a saved background will
 * (DriftThemeBackdrop: spec + live tokens → engine), so what it shows is what
 * a surface would paint.
 *
 * Nothing here saves yet: the brain's stored spec is still validated as Neat
 * v1 server-side. The encoded spec is shown so a look can be carried over by
 * hand once v2 lands.
 */

const STYLE_LABELS: Record<DriftStyle, string> = {
  mesh: 'Mesh',
  silk: 'Silk',
  aurora: 'Aurora',
  dunes: 'Dunes',
  marble: 'Marble',
};

const TONES: ReadonlyArray<{ value: DriftTone; label: string }> = [
  { value: 'darker', label: 'Darker' },
  { value: 'auto', label: 'Auto' },
  { value: 'lighter', label: 'Lighter' },
];

type NumericKey = 'speed' | 'str' | 'scale' | 'warp' | 'soft' | 'light' | 'grain' | 'angle';

const SLIDERS: ReadonlyArray<{
  key: NumericKey;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'str', label: 'Strength', min: 0, max: 1, step: 0.01 },
  { key: 'speed', label: 'Motion', min: 0, max: DRIFT_SPEED_MAX, step: 0.1 },
  { key: 'scale', label: 'Scale', min: 0.25, max: 4, step: 0.05 },
  { key: 'warp', label: 'Turbulence', min: 0, max: 1, step: 0.01 },
  { key: 'soft', label: 'Softness', min: 0, max: 1, step: 0.01 },
  { key: 'light', label: 'Depth', min: 0, max: 1, step: 0.01 },
  { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01 },
  { key: 'angle', label: 'Angle', min: -180, max: 180, step: 1 },
];

export function DriftLab() {
  // Rolled after mount: a random seed during render would differ between the
  // server and client passes.
  const [spec, setSpec] = useState<DriftSpec | null>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setSpec(randomDriftSpec()));
    return () => cancelAnimationFrame(raf);
  }, []);

  const [pointer, setPointer] = useState(false);
  const [handle, setHandle] = useState<DriftHandle | null>(null);
  const [stats, setStats] = useState<DriftStats | null>(null);
  useEffect(() => {
    if (!handle) return;
    const id = window.setInterval(() => setStats(handle.stats()), 500);
    return () => window.clearInterval(id);
  }, [handle]);

  if (!spec)
    return <div className="aspect-[21/9] w-full rounded-xl border border-border bg-muted" />;

  const set = (patch: Partial<DriftSpec>) => setSpec({ ...spec, ...patch });
  const encoded = encodeDriftSpec(spec);

  return (
    <section className="space-y-4">
      <div className="relative aspect-[21/9] w-full overflow-hidden rounded-xl border border-border bg-background">
        <DriftThemeBackdrop
          spec={spec}
          overrides={{ pointer: pointer ? 0.6 : 0 }}
          onReady={setHandle}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-64 max-w-[80%] rounded-xl border border-border bg-card/80 p-4 backdrop-blur-sm">
            <p className="text-sm font-medium text-card-foreground">Text stays readable</p>
            <p className="mt-1 text-xs text-muted-foreground">
              This panel sits on the background the way content will.
            </p>
          </div>
        </div>
        <p className="absolute bottom-2.5 left-4 text-xs text-muted-foreground">
          Plain text directly on the background
        </p>
        {stats && (
          <p className="absolute right-3 top-2.5 rounded bg-background/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {stats.animating ? `${stats.fps} fps` : 'still'} · field {stats.fieldWidth}×
            {stats.fieldHeight} · out {stats.outputWidth}×{stats.outputHeight}
            {stats.halfFloat ? ' · fp16' : ''}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="outline" size="sm" onClick={() => setSpec(randomDriftSpec(spec))}>
          <Dices />
          New seed
        </Button>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={spec.style}
          onValueChange={(v) => v && set({ style: v as DriftStyle })}
          aria-label="Shape"
        >
          {DRIFT_STYLES.map((s) => (
            <ToggleGroupItem key={s} value={s}>
              {STYLE_LABELS[s]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={spec.tone}
          onValueChange={(v) => v && set({ tone: v as DriftTone })}
          aria-label="Tone relative to the page surface"
        >
          {TONES.map((t) => (
            <ToggleGroupItem key={t.value} value={t.value}>
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={spec.pal}
          onValueChange={(v) => v && set({ pal: v as DriftPaletteSource })}
          aria-label="Colours from"
        >
          <ToggleGroupItem value="brand">Brand colours</ToggleGroupItem>
          <ToggleGroupItem value="chart">Chart colours</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={pointer ? 'on' : 'off'}
          onValueChange={(v) => v && setPointer(v === 'on')}
          aria-label="Follow the pointer"
        >
          <ToggleGroupItem value="off">Still pointer</ToggleGroupItem>
          <ToggleGroupItem value="on">Follow pointer</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {SLIDERS.map((s) => (
          <label key={s.key} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">{s.label}</span>
            <Slider
              value={[spec[s.key]]}
              min={s.min}
              max={s.max}
              step={s.step}
              onValueChange={(v) => set({ [s.key]: v[0] ?? spec[s.key] })}
              aria-label={s.label}
            />
            <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
              {spec[s.key]}
            </span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {encoded}
        </code>
        <CopyButton value={encoded} />
      </div>
    </section>
  );
}
