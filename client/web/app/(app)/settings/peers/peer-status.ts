/**
 * Where a link to another brain stands, the pure half: the pill on its list
 * card and header, and the line that says what it means. Read from the
 * peer row only (GET /api/peers): `enabled`, `status` and whether this brain
 * holds their token.
 */

export type PeerStateRow = {
  enabled: boolean;
  /** 'pending' | 'active' | 'revoked' (mantle_peers.status). */
  status: string;
  hasOutboundToken: boolean;
};

export type PeerState = 'linked' | 'waiting' | 'off';

export function peerState(p: PeerStateRow): PeerState {
  if (!p.enabled || p.status === 'revoked') return 'off';
  if (p.status === 'pending' || !p.hasOutboundToken) return 'waiting';
  return 'linked';
}

const LABEL: Record<PeerState, string> = {
  linked: 'linked',
  waiting: 'needs token',
  off: 'off',
};

/** Ink roles only, on an outline pill (StatePill's shape). */
const TONE: Record<PeerState, string> = {
  linked: 'border-success/50 text-success-ink',
  waiting: 'border-warning/50 text-warning-ink',
  off: 'border-muted-foreground/40 text-muted-foreground',
};

export function peerStateLabel(s: PeerState): string {
  return LABEL[s];
}

export function peerStateTone(s: PeerState): string {
  return TONE[s];
}

/** One line on what the state means for the two directions. */
export function peerStateText(s: PeerState, name: string): string {
  switch (s) {
    case 'linked':
      return `Both ways work: this brain can call ${name}, and ${name} can call this brain.`;
    case 'waiting':
      return `${name} can call this brain, but this brain cannot call ${name} until you paste their token.`;
    case 'off':
      return 'Turned off: neither brain can use this link until you turn it on again.';
  }
}

/** The host of a base URL for a list card, or the URL itself when it does
 *  not parse. */
export function peerHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}
