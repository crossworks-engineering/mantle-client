/**
 * The ticket a password sign-in answers while company sign-in is on
 * (`oidcTicket`, 5 minutes, good only to start a link): what makes "Link now"
 * one click, with no password typed again. In this page's memory, never kept:
 * a page load loses it, and the link then asks for the password.
 */

const TICKET_LIFE_MS = 5 * 60_000;

let held: { ticket: string; until: number } | null = null;

export function rememberOfferTicket(ticket: unknown, now = Date.now()): void {
  held = typeof ticket === 'string' && ticket ? { ticket, until: now + TICKET_LIFE_MS } : null;
}

/** The ticket, once. */
export function takeOfferTicket(now = Date.now()): string | undefined {
  const t = held && held.until > now ? held.ticket : undefined;
  held = null;
  return t;
}
