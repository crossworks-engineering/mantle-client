import { describe, expect, it } from 'vitest';
import { peerHost, peerState, peerStateLabel, peerStateText } from './peer-status';

describe('peerState', () => {
  it('is linked with both tokens and the link on', () => {
    expect(peerState({ enabled: true, status: 'active', hasOutboundToken: true })).toBe('linked');
  });

  it('waits for their token while pending', () => {
    expect(peerState({ enabled: true, status: 'pending', hasOutboundToken: false })).toBe(
      'waiting',
    );
    expect(peerStateLabel('waiting')).toBe('needs token');
  });

  it('is off when turned off or revoked, whatever the tokens', () => {
    expect(peerState({ enabled: false, status: 'active', hasOutboundToken: true })).toBe('off');
    expect(peerState({ enabled: true, status: 'revoked', hasOutboundToken: true })).toBe('off');
  });

  it('names the peer in the line it says', () => {
    expect(peerStateText('waiting', 'Lab')).toContain('until you paste their token');
    expect(peerStateText('linked', 'Lab', '2026-10-23T10:00:00Z')).toContain(
      'Lab has called this brain',
    );
  });

  it('claims their direction only once they have called', () => {
    // This brain cannot see whether their owner pasted your token.
    expect(peerStateText('linked', 'Lab', null)).not.toContain('Both ways work');
    expect(peerStateText('linked', 'Lab', null)).toContain('once their owner pastes your token');
    expect(peerStateText('waiting', 'Lab', null)).toContain('once their owner pastes your token');
    expect(peerStateText('waiting', 'Lab', '2026-10-23T10:00:00Z')).toContain(
      'Lab has called this brain',
    );
  });
});

describe('peerHost', () => {
  it('shows the host, or the text when it is no URL', () => {
    expect(peerHost('https://brain.example.com:8443/x')).toBe('brain.example.com:8443');
    expect(peerHost('not a url')).toBe('not a url');
  });
});
