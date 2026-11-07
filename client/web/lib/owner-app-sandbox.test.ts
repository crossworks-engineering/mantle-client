import { describe, expect, it } from 'vitest';
import { readableToolRefusal } from './owner-app-sandbox';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('readableToolRefusal', () => {
  const url = 'https://brain.invalid/api/apps/a1/tool-broker';

  it('hands the relay a preview refusal in the brain’s own words', async () => {
    const res = await readableToolRefusal(
      url,
      json(403, {
        ok: false,
        reason: 'agent_draft',
        error: 'This preview was edited by an agent, so it may not run tools.',
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      ok: false,
      reason: 'team-rules',
      refused: 'agent_draft',
      error: 'This preview was edited by an agent, so it may not run tools.',
    });
  });

  it('leaves everything else as it came', async () => {
    const plain = json(403, { ok: false, error: 'not declared' });
    expect(await readableToolRefusal(url, plain)).toBe(plain);
    const rules = json(403, { ok: false, reason: 'team-rules', error: 'x' });
    expect(await readableToolRefusal(url, rules)).toBe(rules);
    const agent = json(403, { error: 'agent_refused', reason: 'listed' });
    expect(await readableToolRefusal(url, agent)).toBe(agent);
    const ok = json(200, { ok: true });
    expect(await readableToolRefusal(url, ok)).toBe(ok);
    const db = json(403, { ok: false, reason: 'agent_draft', error: 'x' });
    expect(await readableToolRefusal('https://brain.invalid/api/apps/a1/db-broker', db)).toBe(db);
  });
});
