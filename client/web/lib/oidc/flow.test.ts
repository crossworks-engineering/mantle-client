import { describe, expect, it } from 'vitest';
import type { OidcStatusDTO } from '@mantle/client-types';
import {
  changePasswordOffered,
  decideArrival,
  flowStoppedMessage,
  readFlowEnd,
  signInStoppedPath,
  type PendingFlow,
} from './flow';

const BRAIN = 'https://brain.example';
const flow = (over: Partial<PendingFlow> = {}): PendingFlow => ({
  purpose: 'signin',
  verifier: 'v'.repeat(43),
  brain: BRAIN,
  startedAt: 1,
  ...over,
});
const end = (over: Partial<NonNullable<ReturnType<typeof readFlowEnd>>> = {}) => ({
  result: 'code',
  purpose: 'signin',
  iss: BRAIN,
  ...over,
});

describe('readFlowEnd', () => {
  it('reads what the brain sends, with the code already taken apart', () => {
    expect(
      readFlowEnd(`#oidc=code&purpose=link&iss=${encodeURIComponent('https://b.example')}`),
    ).toEqual({ result: 'code', purpose: 'link', iss: 'https://b.example' });
  });
  it('reads nothing from an address with no flow in it', () => {
    expect(readFlowEnd('')).toBeNull();
    expect(readFlowEnd('#')).toBeNull();
    expect(readFlowEnd('#other=1')).toBeNull();
  });
});

describe('decideArrival', () => {
  it('spends a code for the flow that waits for it', () => {
    expect(decideArrival(end(), 'c', flow(), BRAIN)).toMatchObject({ kind: 'spend', code: 'c' });
    expect(
      decideArrival(end({ purpose: 'link' }), 'c', flow({ purpose: 'link' }), BRAIN),
    ).toMatchObject({ kind: 'spend' });
  });

  it('hands a fresh code to the screen, with its verifier, and spends nothing', () => {
    const f = flow({ purpose: 'fresh' });
    expect(decideArrival(end({ purpose: 'fresh' }), 'c', f, BRAIN)).toEqual({
      kind: 'fresh',
      flow: f,
      proof: { code: 'c', verifier: f.verifier },
    });
  });

  it('never spends a code from another brain, whatever waits', () => {
    expect(decideArrival(end({ iss: 'https://evil.example' }), 'c', flow(), BRAIN).kind).toBe(
      'other-brain',
    );
    expect(decideArrival(end({ iss: null }), 'c', flow(), BRAIN).kind).toBe('other-brain');
    expect(decideArrival(end({ iss: 'not a url' }), 'c', flow(), BRAIN).kind).toBe('other-brain');
  });

  it('allows one slash at the end of what the brain names, as an origin', () => {
    expect(decideArrival(end({ iss: `${BRAIN}/` }), 'c', flow(), BRAIN).kind).toBe('spend');
  });

  it('never spends a code nothing here is waiting for (a link another page sent)', () => {
    expect(decideArrival(end(), 'c', null, BRAIN).kind).toBe('no-flow');
    expect(decideArrival(end(), 'c', flow({ brain: 'https://other.example' }), BRAIN).kind).toBe(
      'no-flow',
    );
  });

  it('never spends a code for another purpose than the one that waits', () => {
    expect(
      decideArrival(end({ purpose: 'signin' }), 'c', flow({ purpose: 'link' }), BRAIN).kind,
    ).toBe('no-flow');
    expect(decideArrival(end({ purpose: 'fresh' }), 'c', flow(), BRAIN).kind).toBe('no-flow');
    expect(decideArrival(end({ purpose: null }), 'c', flow(), BRAIN).kind).toBe('no-flow');
  });

  it('a stopped flow says why; an empty code is no code', () => {
    expect(decideArrival(end({ result: 'cancelled' }), '', flow(), BRAIN)).toMatchObject({
      kind: 'stopped',
      result: 'cancelled',
    });
    expect(decideArrival(end(), '', flow(), BRAIN).kind).toBe('no-flow');
  });

  it('nothing in the address is nothing', () => {
    expect(decideArrival(null, '', flow(), BRAIN).kind).toBe('nothing');
  });
});

describe('signInStoppedPath', () => {
  it('keeps where the person was going, and only a path in the app', () => {
    expect(signInStoppedPath(flow({ next: '/notes?x=1' }), 'expired')).toBe(
      `/login?oidc=expired&next=${encodeURIComponent('/notes?x=1')}`,
    );
    expect(signInStoppedPath(flow({ next: 'https://evil.example' }), 'failed')).toBe(
      '/login?oidc=failed',
    );
    expect(signInStoppedPath(flow({ add: true }), 'failed')).toBe('/login?oidc=failed&add=1');
  });
});

describe('flowStoppedMessage', () => {
  it('says each reason in its own words, and never echoes what came in', () => {
    const words = ['expired', 'cancelled', 'unavailable', 'not-linked', 'not-allowed', 'taken'];
    const said = words.map(flowStoppedMessage);
    expect(new Set(said).size).toBe(words.length);
    expect(flowStoppedMessage('<script>')).toBe('Company sign-in did not finish. Try again.');
  });
});

describe('changePasswordOffered', () => {
  const on: OidcStatusDTO = {
    mode: 'optional',
    label: 'Company',
    linked: true,
    owner: false,
    outside: false,
    offer: false,
    linkRequired: false,
    canUnlink: true,
    passwordConfirms: true,
  };
  it('off, and where the password is a way in: yes', () => {
    expect(changePasswordOffered({ mode: 'off' }, false)).toBe(true);
    expect(changePasswordOffered(on, false)).toBe(true);
  });
  it('required mode with a linked login, or no password at all: no', () => {
    expect(changePasswordOffered({ ...on, mode: 'required', passwordConfirms: false }, false)).toBe(
      false,
    );
    expect(changePasswordOffered({ ...on, passwordConfirms: false }, false)).toBe(false);
  });
  it('never from a company sign-in session, and not while the answer is unknown', () => {
    expect(changePasswordOffered(on, true)).toBe(false);
    expect(changePasswordOffered({ mode: 'off' }, true)).toBe(false);
    expect(changePasswordOffered(undefined, false)).toBe(false);
  });
});
