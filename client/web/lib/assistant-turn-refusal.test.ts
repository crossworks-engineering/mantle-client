/**
 * The assistant chat for every login (W7c): what a refused send says, and
 * which parts of the chat a login gets.
 */
import { describe, expect, it } from 'vitest';
import { TURN_REFUSAL_TEXT, chatFeatures, turnRefusalText } from './assistant-turn-refusal';

/** An en or an em dash, named by code point so this file carries neither. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

describe('a refused send, in plain words', () => {
  it('415: the chat takes text only', () => {
    const body = { error: 'attachments are not supported in this chat yet: send text' };
    expect(turnRefusalText(415, body)).toBe(TURN_REFUSAL_TEXT.textOnly);
    expect(turnRefusalText(415, null)).toMatch(/text only/);
  });

  it('429: the daily message cap, the daily usage budget, else the rate', () => {
    expect(turnRefusalText(429, { error: 'x', reason: 'daily_cap' })).toBe(
      TURN_REFUSAL_TEXT.dailyCap,
    );
    expect(turnRefusalText(429, { error: 'x', reason: 'token_budget' })).toBe(
      TURN_REFUSAL_TEXT.tokenBudget,
    );
    expect(turnRefusalText(429, { error: 'too many messages, give me a moment' })).toBe(
      TURN_REFUSAL_TEXT.tooFast,
    );
    expect(TURN_REFUSAL_TEXT.dailyCap).toMatch(/tomorrow/);
    expect(TURN_REFUSAL_TEXT.tokenBudget).toMatch(/ask an admin/);
  });

  it('409 idempotency-key-reused: send again', () => {
    const body = {
      error: 'that Idempotency-Key was already used for a different message',
      reason: 'idempotency-key-reused',
    };
    expect(turnRefusalText(409, body)).toBe(TURN_REFUSAL_TEXT.keyReused);
  });

  it('404 no-chat-agent: no assistant to chat with', () => {
    const body = { error: 'no assistant to chat with here', reason: 'no-chat-agent' };
    expect(turnRefusalText(404, body)).toBe(TURN_REFUSAL_TEXT.noAssistant);
  });

  it("anything else: the brain's own words, else the status", () => {
    expect(turnRefusalText(400, { error: 'message too long' })).toBe('message too long');
    expect(turnRefusalText(409, { error: 'busy', reason: 'other' })).toBe('busy');
    expect(turnRefusalText(404, { error: '  ' })).toBe('request failed (404)');
    expect(turnRefusalText(500, { error: 42 })).toBe('request failed (500)');
    expect(turnRefusalText(500, undefined)).toBe('request failed (500)');
  });

  it('every text is short and carries no dash', () => {
    for (const t of Object.values(TURN_REFUSAL_TEXT)) {
      expect(t).not.toMatch(DASHES);
      expect(t.length).toBeLessThan(110);
    }
  });
});

describe('the parts of the chat a login gets', () => {
  it('an Admin user with the Settings area gets everything', () => {
    expect(chatFeatures(true, ['settings'])).toEqual({
      attachments: true,
      live: true,
      runs: true,
    });
    // A brain that names no areas: an admin, who holds them all.
    expect(chatFeatures(true, undefined).runs).toBe(true);
  });

  it('an Admin user without the Settings area: no runs strips (/api/pending, /api/runs)', () => {
    expect(chatFeatures(true, ['users', 'connectors'])).toEqual({
      attachments: true,
      live: true,
      runs: false,
    });
    expect(chatFeatures(true, []).runs).toBe(false);
  });

  it('anyone else: no attachments, no pick, no live tokens, no runs strips', () => {
    expect(chatFeatures(false, ['settings']).runs).toBe(false);
    expect(chatFeatures(false, [])).toEqual({
      attachments: false,
      live: false,
      runs: false,
    });
  });
});
