import { beforeEach, describe, expect, it } from 'vitest';
import { rememberOfferTicket, takeOfferTicket } from './offer-ticket';

describe('the offer ticket', () => {
  beforeEach(() => rememberOfferTicket(undefined));

  it('works once', () => {
    rememberOfferTicket('t', 1000);
    expect(takeOfferTicket(1000)).toBe('t');
    expect(takeOfferTicket(1000)).toBeUndefined();
  });

  it('is gone after its 5 minutes', () => {
    rememberOfferTicket('t', 0);
    expect(takeOfferTicket(5 * 60_000)).toBeUndefined();
  });

  it('a sign-in with no ticket leaves none from before', () => {
    rememberOfferTicket('t', 0);
    rememberOfferTicket(undefined, 0);
    expect(takeOfferTicket(0)).toBeUndefined();
  });
});
