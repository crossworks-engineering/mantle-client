import { describe, expect, it } from 'vitest';
import { CSP_ENFORCED_STATIC, buildRuntimeCsp, websocketTwin } from './csp';

const directive = (policy: string, name: string) =>
  policy
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));

describe('CSP_ENFORCED_STATIC', () => {
  it('carries the three origin-independent controls', () => {
    expect(directive(CSP_ENFORCED_STATIC, 'base-uri')).toBe("base-uri 'self'");
    expect(directive(CSP_ENFORCED_STATIC, 'object-src')).toBe("object-src 'none'");
    expect(directive(CSP_ENFORCED_STATIC, 'frame-ancestors')).toBe("frame-ancestors 'self'");
  });

  it('names no origin, because it is resolved at build time', () => {
    // If a directive here ever needs the brain, it has to move to
    // buildRuntimeCsp — next.config.ts cannot see runtime env.
    expect(CSP_ENFORCED_STATIC).not.toMatch(/https?:\/\//);
  });
});

describe('buildRuntimeCsp', () => {
  const brainOrigin = 'https://brain.example';

  it('names the brain in every directive that must reach it', () => {
    const policy = buildRuntimeCsp({ brainOrigin });
    // The exfiltration control: an injected script must not be able to post
    // the bearer anywhere but here.
    expect(directive(policy, 'connect-src')).toBe(
      `connect-src 'self' ${brainOrigin} wss://brain.example`,
    );
    // No form targets the brain since the team portal's SSO post went.
    expect(directive(policy, 'form-action')).toBe("form-action 'self'");
    expect(directive(policy, 'img-src')).toContain(brainOrigin);
    expect(directive(policy, 'media-src')).toContain(brainOrigin);
    // Three surfaces frame the brain cross-origin: the mini-app sandbox
    // (`${apiBase}/frame`), the Files PDF preview, and the share preview panel.
    // 'self' alone blocks all three, and only in a split deployment.
    expect(directive(policy, 'frame-src')).toContain(brainOrigin);
  });

  it('leaves no gap when the deployment is same-origin', () => {
    const policy = buildRuntimeCsp({ brainOrigin: '' });
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'");
    expect(directive(policy, 'form-action')).toBe("form-action 'self'");
    expect(directive(policy, 'frame-src')).toBe("frame-src 'self' blob:");
    expect(policy).not.toMatch(/\s{2,}|;\s*;/);
  });

  it('tolerates a trailing slash on the origin', () => {
    const policy = buildRuntimeCsp({ brainOrigin: 'https://brain.example/' });
    expect(directive(policy, 'connect-src')).toBe(
      "connect-src 'self' https://brain.example wss://brain.example",
    );
  });

  it('lets the email pane load remote images, which a srcdoc iframe inherits', () => {
    // The email body is a srcdoc iframe and so runs under THIS policy. Without
    // `https:` every remote image in a newsletter is blocked, with no way for a
    // reader to opt back in. Deliberate: see the note in csp.ts.
    const sources = (policy: string, name: string) =>
      (directive(policy, name) ?? '').split(/\s+/).slice(1);
    expect(sources(buildRuntimeCsp({ brainOrigin }), 'img-src')).toContain('https:');
    // media-src is NOT widened with it — nothing loads remote media.
    expect(sources(buildRuntimeCsp({ brainOrigin }), 'media-src')).not.toContain('https:');
  });

  it('allows the dev server its HMR socket, and only in dev', () => {
    expect(directive(buildRuntimeCsp({ brainOrigin, dev: true }), 'connect-src')).toContain('ws:');
    expect(directive(buildRuntimeCsp({ brainOrigin }), 'connect-src')).not.toContain('ws:');
  });

  it('omits frame-ancestors, which a meta tag would silently ignore', () => {
    // This half is destined for <meta http-equiv>, where frame-ancestors has no
    // effect — it stays in the header set instead.
    expect(directive(buildRuntimeCsp({ brainOrigin }), 'frame-ancestors')).toBeUndefined();
  });
});

describe('websocketTwin', () => {
  it('names the socket twin of the brain origin, and nothing for none', () => {
    expect(websocketTwin('https://brain.example')).toBe('wss://brain.example');
    expect(websocketTwin('http://localhost:3000/')).toBe('ws://localhost:3000');
    expect(websocketTwin('')).toBe('');
    expect(websocketTwin('brain.example')).toBe('');
  });
});
