'use client';

import { useState } from 'react';
import {
  ChevronDown,
  Download,
  FileImage,
  FileText,
  FileType,
  FileType2,
  FileSpreadsheet,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import { useAssetUrl } from '@mantle/web-ui/hooks/use-asset-url';
import { Button } from '@mantle/web-ui/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@mantle/web-ui/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent } from '@mantle/web-ui/ui/popover';
import {
  MENU_CLOSED_MS,
  type HeaderTool,
  type HeaderToolChoice,
} from '@/components/layout/item-header';
import { exportPath } from '@/lib/print-options';
import { PrintOptionsPanel } from './print-options-panel';

type ExportItem = { format: string; label: string; Icon: LucideIcon };

// Pages/notes → Markdown, Word, PDF. Tables → Excel, Markdown table, CSV. Each
// item is a plain download link to `/api/export/<id>?format=…`; the route
// generates bytes on the fly and the resolver picks what the node kind
// supports (PDF via headless Chromium). Hrefs go through assetUrl(): an anchor
// can't carry a bearer, so a detached client targets the server origin with
// the short-lived `?at=` asset token (same-origin passes through unchanged).
//
// PDF is the one entry with options (paper, orientation, margins, a header
// and a footer line, page numbers): it opens a small panel under the button
// whose Download link carries only what differs from the brain's defaults
// (`lib/print-options.ts`), so a brain without the documents release ignores
// them and prints as before.
const ITEMS: Record<'page' | 'table' | 'draw', ExportItem[]> = {
  page: [
    { format: 'md', label: 'Markdown', Icon: FileText },
    { format: 'docx', label: 'Word', Icon: FileType },
    { format: 'pdf', label: 'PDF', Icon: FileType2 },
  ],
  table: [
    { format: 'xlsx', label: 'Excel', Icon: FileSpreadsheet },
    { format: 'md', label: 'Markdown table', Icon: Table2 },
    { format: 'csv', label: 'CSV', Icon: FileText },
  ],
  // Both serve the COMMITTED snapshot. Exporting the live working scene as
  // PNG/SVG is the canvas's own job (hamburger menu → Export image), which
  // already does it client-side.
  draw: [
    { format: 'svg', label: 'SVG', Icon: FileImage },
    { format: 'pdf', label: 'PDF', Icon: FileType2 },
  ],
};

/**
 * The same choices as an item header tool (item header contract): a Download
 * icon with its menu while it fits, a Download sub-menu in More once folded.
 */
export function useExportTool(
  nodeId: string,
  kind: 'page' | 'table' | 'draw' = 'page',
): HeaderTool {
  const toAsset = useAssetUrl();
  return {
    key: 'download',
    label: 'Download',
    icon: <Download />,
    choices: ITEMS[kind].map(({ format, label, Icon }): HeaderToolChoice =>
      format === 'pdf'
        ? {
            key: format,
            label,
            icon: <Icon />,
            panel: (close) => <PrintOptionsPanel nodeId={nodeId} onClose={close} />,
          }
        : {
            key: format,
            label,
            icon: <Icon />,
            href: toAsset(exportPath(nodeId, format)),
            download: true,
          },
    ),
  };
}

/**
 * Download a content node in a chosen format. `kind` selects the menu: `page`
 * (Markdown / Word / PDF), `table` (Excel / Markdown table / CSV) or `draw`
 * (SVG / PDF of the committed snapshot). Replaces the single-format
 * ExportButton on a detail header.
 */
export function ExportMenu({
  nodeId,
  kind = 'page',
}: {
  nodeId: string;
  kind?: 'page' | 'table' | 'draw';
}) {
  const toAsset = useAssetUrl();
  const [options, setOptions] = useState(false);
  return (
    <Popover open={options} onOpenChange={setOptions}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PopoverAnchor asChild>
            <Button size="sm" variant="ghost" title="Download">
              <Download />
              <span className="hidden sm:inline">Download</span>
              <ChevronDown className="opacity-60" />
            </Button>
          </PopoverAnchor>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {ITEMS[kind].map(({ format, label, Icon }) =>
            format === 'pdf' ? (
              // Once the menu has closed and handed focus back, else the
              // popover reads the focus move as a click outside.
              <DropdownMenuItem
                key={format}
                onSelect={() => setTimeout(() => setOptions(true), MENU_CLOSED_MS)}
              >
                <Icon />
                {label}…
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem key={format} asChild>
                <a href={toAsset(exportPath(nodeId, format))} download>
                  <Icon />
                  {label}
                </a>
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent align="end" className="w-80" aria-label="PDF options">
        <PrintOptionsPanel nodeId={nodeId} onClose={() => setOptions(false)} />
      </PopoverContent>
    </Popover>
  );
}
