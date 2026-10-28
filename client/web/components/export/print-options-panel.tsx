'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { useAssetUrl } from '@mantle/web-ui/hooks/use-asset-url';
import { Button } from '@mantle/web-ui/ui/button';
import { Field, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { Switch } from '@mantle/web-ui/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@mantle/web-ui/ui/toggle-group';
import {
  DEFAULT_PRINT_OPTIONS,
  MAX_MARGIN_MM,
  MAX_TEXT,
  PAPER_LABELS,
  PAPER_SIZES,
  PRINT_OPTIONS_KEY,
  SIDES,
  clampMm,
  decodePrintOptions,
  encodePrintOptions,
  exportPath,
  parsePaper,
  uniformMargins,
  type PrintOptions,
  type Side,
} from '@/lib/print-options';
import { usePersistedState } from '@/lib/use-persisted-state';

const SIDE_LABELS: Record<Side, string> = {
  top: 'Top',
  right: 'Right',
  bottom: 'Bottom',
  left: 'Left',
};

/**
 * The PDF entry's options (the Export menu, pages and drawings): paper,
 * orientation, margins (one value, or each side), a header and a footer
 * line, page numbers. Download is the same plain download anchor every
 * export is, with only the options that differ from the defaults on the
 * link (`lib/print-options.ts`), so a brain without the documents release
 * prints as it always did. The last used options are this browser's
 * (`localStorage`), with a Reset to the defaults.
 *
 * Mounted inside the header's choice popover (item-header `panel`), so it
 * never renders on the server: the stored copy lands on mount without a
 * hydration mismatch.
 */
export function PrintOptionsPanel({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const toAsset = useAssetUrl();
  const [options, setOptions] = usePersistedState<PrintOptions>(
    PRINT_OPTIONS_KEY,
    DEFAULT_PRINT_OPTIONS,
    decodePrintOptions,
    encodePrintOptions,
  );
  // Each side open while the stored sides differ; the user's own switch
  // after that.
  const [eachSide, setEachSide] = useState<boolean | null>(null);
  const sidesShown = eachSide ?? !uniformMargins(options.margins);
  // Number fields keep their own text while typed (a cleared field must stay
  // clear); the key re-seeds them from the options on Reset or a sides switch.
  const [seed, setSeed] = useState(0);
  // The stored copy lands in an effect after the first render; the fields
  // mount after it (the same commit), seeded from it rather than the
  // defaults.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const patch = useCallback(
    (p: Partial<PrintOptions>) => setOptions({ ...options, ...p }),
    [options, setOptions],
  );
  const setMargin = (side: Side | 'all', raw: string) => {
    const d = DEFAULT_PRINT_OPTIONS.margins;
    if (side === 'all') {
      const v = clampMm(raw, d.top);
      patch({ margins: { top: v, right: v, bottom: v, left: v } });
    } else {
      patch({ margins: { ...options.margins, [side]: clampMm(raw, d[side]) } });
    }
  };
  const toggleSides = () => {
    if (sidesShown) {
      const v = options.margins.top;
      patch({ margins: { top: v, right: v, bottom: v, left: v } });
    }
    setEachSide(!sidesShown);
    setSeed((n) => n + 1);
  };
  const reset = () => {
    setOptions(DEFAULT_PRINT_OPTIONS);
    setEachSide(false);
    setSeed((n) => n + 1);
  };

  const href = toAsset(exportPath(nodeId, 'pdf', options));

  if (!ready) return null;
  return (
    <FieldGroup className="gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="print-paper">Paper</FieldLabel>
          <Select
            value={options.paper}
            onValueChange={(v) => {
              const paper = parsePaper(v);
              if (paper) patch({ paper });
            }}
          >
            <SelectTrigger id="print-paper" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAPER_SIZES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PAPER_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel asChild>
            <span>Orientation</span>
          </FieldLabel>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={options.landscape ? 'landscape' : 'portrait'}
            onValueChange={(v) => v && patch({ landscape: v === 'landscape' })}
            aria-label="Orientation"
            className="w-full *:flex-1"
          >
            <ToggleGroupItem value="portrait">Portrait</ToggleGroupItem>
            <ToggleGroupItem value="landscape">Landscape</ToggleGroupItem>
          </ToggleGroup>
        </Field>
      </div>

      <Field>
        <div className="flex items-center justify-between">
          <FieldLabel htmlFor={sidesShown ? 'print-margin-top' : 'print-margin'}>
            Margins (mm)
          </FieldLabel>
          <Button
            type="button"
            variant="ghost"
            size="2xs"
            onClick={toggleSides}
            aria-expanded={sidesShown}
            aria-controls="print-margin-sides"
          >
            {sidesShown ? 'One value' : 'Each side'}
          </Button>
        </div>
        {sidesShown ? (
          <div id="print-margin-sides" className="grid grid-cols-4 gap-2">
            {SIDES.map((s) => (
              <div key={s} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{SIDE_LABELS[s]}</span>
                <MmInput
                  key={seed}
                  id={`print-margin-${s}`}
                  label={`${SIDE_LABELS[s]} margin in millimetres`}
                  value={options.margins[s]}
                  onChange={(raw) => setMargin(s, raw)}
                />
              </div>
            ))}
          </div>
        ) : (
          <MmInput
            key={seed}
            id="print-margin"
            label="Margin on every side in millimetres"
            value={options.margins.top}
            onChange={(raw) => setMargin('all', raw)}
          />
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor="print-header">Header</FieldLabel>
        <Input
          id="print-header"
          size="sm"
          maxLength={MAX_TEXT}
          placeholder="A line at the top of every page"
          value={options.header}
          onChange={(e) => patch({ header: e.target.value.slice(0, MAX_TEXT) })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="print-footer">Footer</FieldLabel>
        <Input
          id="print-footer"
          size="sm"
          maxLength={MAX_TEXT}
          placeholder="A line at the bottom of every page"
          value={options.footer}
          onChange={(e) => patch({ footer: e.target.value.slice(0, MAX_TEXT) })}
        />
      </Field>
      <Field orientation="horizontal">
        <FieldLabel htmlFor="print-page-numbers">Page numbers</FieldLabel>
        <Switch
          id="print-page-numbers"
          checked={options.pageNumbers}
          onCheckedChange={(on) => patch({ pageNumbers: on })}
        />
      </Field>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <Button type="button" variant="ghost" size="sm" onClick={reset}>
          Reset
        </Button>
        <Button asChild size="sm">
          <a href={href} download onClick={() => setTimeout(onClose, 0)}>
            <Download />
            Download
          </a>
        </Button>
      </div>
    </FieldGroup>
  );
}

/** A millimetre field: free while typed, pinned to 0..60 on the way out. */
function MmInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (raw: string) => void;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      size="sm"
      min={0}
      max={MAX_MARGIN_MM}
      step={1}
      aria-label={label}
      defaultValue={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => {
        // A cleared or out-of-range field shows what will be sent.
        e.currentTarget.value = String(clampMm(e.currentTarget.value, value));
      }}
    />
  );
}
