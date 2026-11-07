import { writeFileSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';

import { expect, test } from '../lib/fixtures';
import { ARTIFACTS_DIR } from '../lib/env';

/**
 * `ui_look` on a mini app (agent UI; the brain's docs/agent-ui.md, "Look"),
 * the case that matters most: "does this app look right?". On the web the
 * page redraw cannot read inside the app's sandboxed frame, so the window
 * asks the frame to draw itself (the brain's frame document loads
 * /share-runtime/frame-look.js) and paints that into the frame's box.
 *
 * A real brain: a real app with a form, a table and a chart, its real frame
 * document, CSP and runtime. The agent's call is played through the dev
 * build's `__mantleAgentCalls`; its answer is caught on its way to the brain
 * (no turn of the brain asked for it). The setting is answered on, so the
 * brain keeps none of this.
 *
 * "Before" is the same look with the frame's drawer unreachable: the frame
 * cannot answer, and its box is blank. Both pictures land in .artifacts/.
 */

const TURN = 'turn-e2e-look-apps';
let n = 0;
const callId = () => `0b0b0b0b-0b0b-40b0-80b0-${String(++n).padStart(12, '0')}`;

const APP = `import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const START = [
  { item: 'Steel beams', qty: 12, cost: 4800 },
  { item: 'Pipe fittings', qty: 40, cost: 1200 },
  { item: 'Valves', qty: 8, cost: 3600 },
  { item: 'Gaskets', qty: 120, cost: 600 },
];

export default function App() {
  const [rows, setRows] = useState(START);
  const [item, setItem] = useState('Flanges');
  const [cost, setCost] = useState('900');
  const chartRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    chart.setOption({
      animation: false,
      grid: { left: 56, right: 16, top: 16, bottom: 32 },
      xAxis: { type: 'category', data: rows.map((r) => r.item) },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: rows.map((r) => r.cost), itemStyle: { color: '#3b82f6' } }],
    });
    return () => chart.dispose();
  }, [rows]);
  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader><CardTitle>Add a cost line</CardTitle></CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="item">Item</Label>
            <Input id="item" value={item} onChange={(e) => setItem(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cost">Cost</Label>
            <Input id="cost" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <Button onClick={() => setRows([...rows, { item, qty: 1, cost: Number(cost) || 0 }])}>Add</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Cost lines</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th>Item</th><th>Qty</th><th className="text-right">Cost</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item} className="border-t border-border">
                  <td className="py-1">{r.item}</td><td>{r.qty}</td><td className="text-right">{r.cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Cost by item</CardTitle></CardHeader>
        <CardContent><div ref={chartRef} style={{ height: 220 }} /></CardContent>
      </Card>
    </div>
  );
}
`;

type LookAnswer = {
  ok: boolean;
  error?: string;
  width: number;
  height: number;
  blankFrames: number;
  image: { mimeType: string; base64: string };
};

async function withApp(ownerApi: APIRequestContext, run: (id: string) => Promise<void>) {
  const created = await ownerApi.post('/api/apps', { data: { name: `E2E look ${Date.now()}` } });
  expect(created.status(), 'could not create the app').toBeLessThan(300);
  const { app } = (await created.json()) as { app: { id: string } };
  try {
    const draft = await ownerApi.put(`/api/apps/${app.id}/draft`, {
      data: { entry: 'App.tsx', files: { 'App.tsx': APP } },
    });
    expect(draft.status(), 'could not save the draft').toBeLessThan(300);
    const published = await ownerApi.post(`/api/apps/${app.id}/publish`);
    expect(published.status(), await published.text()).toBeLessThan(300);
    await run(app.id);
  } finally {
    await ownerApi.delete(`/api/apps/${app.id}`);
  }
}

/** Open the app, its frame painted (the chart drawn), and this window
 *  allowed for the agent. */
async function openApp(page: Page, id: string) {
  await page.goto(`/apps/${id}`);
  const frame = page.frameLocator('iframe[sandbox="allow-scripts"]');
  await expect(frame.getByText('Cost by item')).toBeVisible({ timeout: 60_000 });
  await expect(frame.locator('canvas').first()).toBeVisible();
  await page.waitForFunction(() => '__mantleAgentCalls' in window);
  await page.evaluate(async (turn) => {
    const calls = (
      window as unknown as {
        __mantleAgentCalls: {
          loadAgentUiSetting: (f: boolean) => Promise<boolean>;
          claimTurn: (t: string) => void;
        };
      }
    ).__mantleAgentCalls;
    await calls.loadAgentUiSetting(true);
    calls.claimTurn(turn);
  }, TURN);
}

/** One `look` of the work area, its answer. The first call of a page asks
 *  for the page's consent: allowed here. */
async function look(page: Page, answers: Map<string, LookAnswer>): Promise<LookAnswer> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = callId();
    await page.evaluate(
      ([turn, data]) => {
        void (
          window as unknown as {
            __mantleAgentCalls: {
              handleUiCall: (t: string, d: unknown, a: string) => Promise<void>;
            };
          }
        ).__mantleAgentCalls.handleUiCall(turn, data, 'Saskia');
      },
      [TURN, { callId: id, action: 'look', args: { scope: 'work' } }] as const,
    );
    await expect.poll(() => answers.get(id), { timeout: 30_000 }).toBeTruthy();
    const got = answers.get(id)!;
    if (got.ok || got.error !== 'needs_consent') return got;
    await page.getByRole('button', { name: 'Allow for this session' }).click();
  }
  throw new Error('the look was not allowed');
}

/** How many colours the picture holds inside the app frame's box (a grid of
 *  samples, 5 bits a channel): a blank box has one or two. */
async function frameColours(page: Page, a: LookAnswer): Promise<number> {
  return page.evaluate(
    async ({ base64, width }) => {
      const main = document.querySelector('main[data-tour="main"]')!.getBoundingClientRect();
      const frame = document
        .querySelector('iframe[sandbox="allow-scripts"]')!
        .getBoundingClientRect();
      const k = width / main.width;
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const top = Math.max(frame.top, main.top);
      const bottom = Math.min(frame.bottom, main.bottom);
      const seen = new Set<number>();
      for (let i = 1; i < 40; i++) {
        for (let j = 1; j < 40; j++) {
          const x = (frame.left - main.left + (frame.width * i) / 40) * k;
          const y = (top - main.top + ((bottom - top) * j) / 40) * k;
          const [r, gr, b] = g.getImageData(x, y, 1, 1).data;
          seen.add(((r! >> 3) << 10) | ((gr! >> 3) << 5) | (b! >> 3));
        }
      }
      return seen.size;
    },
    { base64: a.image.base64, width: a.width },
  );
}

test.describe('ui_look on a mini app', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: the app's own content is in the picture, not a blank box`, async ({
      ownerApi,
      ownerPage,
    }) => {
      test.setTimeout(180_000);
      const answers = new Map<string, LookAnswer>();
      // The window's answer, caught on its way to the brain.
      await ownerPage.route('**/api/assistant/turn/*/ui/*', async (route) => {
        const id = route.request().url().split('/').pop()!;
        const body = route.request().postDataJSON() as { result: LookAnswer };
        answers.set(id, body.result);
        await route.fulfill({ json: { ok: true } });
      });
      await ownerPage.route('**/api/profile/agent-ui', (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ json: { enabled: true } })
          : route.continue(),
      );
      await ownerPage.emulateMedia({ colorScheme: scheme });
      await ownerPage.setViewportSize({ width: 1440, height: 900 });

      await withApp(ownerApi, async (id) => {
        // Before: the frame's drawer cannot be reached, so the frame cannot
        // answer and its box stays blank.
        await ownerPage.route('**/share-runtime/frame-look.js', (route) => route.abort());
        await openApp(ownerPage, id);
        const before = await look(ownerPage, answers);
        expect(before).toMatchObject({ ok: true, blankFrames: 1 });
        const beforeColours = await frameColours(ownerPage, before);
        writeFileSync(
          `${ARTIFACTS_DIR}look-app-${scheme}-before.png`,
          Buffer.from(before.image.base64, 'base64'),
        );

        // After: a fresh page, the drawer reachable.
        await ownerPage.unroute('**/share-runtime/frame-look.js');
        await openApp(ownerPage, id);
        const after = await look(ownerPage, answers);
        expect(after).toMatchObject({ ok: true, blankFrames: 0 });
        expect(after.image.mimeType).toBe('image/png');
        expect(Math.max(after.width, after.height)).toBeLessThanOrEqual(1568);
        const afterColours = await frameColours(ownerPage, after);
        writeFileSync(
          `${ARTIFACTS_DIR}look-app-${scheme}-after.png`,
          Buffer.from(after.image.base64, 'base64'),
        );

        expect(beforeColours, 'the blank box').toBeLessThanOrEqual(3);
        expect(afterColours, "the app's own form, table and chart").toBeGreaterThanOrEqual(8);
      });
    });
  }
});
