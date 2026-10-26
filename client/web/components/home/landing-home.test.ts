import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The landing page with a home app (task d78e7bde, audit L2): the app runs
 * full-bleed with the landing page's data as its `host.hub`, a failed load
 * falls back to Desk, and the toggle shows Desk
 * while the app stays mounted.
 */

const sandbox = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

vi.mock('@/components/layout/page-title', () => ({ SetPageTitle: () => null }));
vi.mock('@mantle/share-ui/app-sandbox', () => ({
  AppSandbox: (props: Record<string, unknown>) => {
    sandbox.props.push(props);
    return createElement('div', { 'data-app': props.appId as string });
  },
}));

const { LandingAppView, homeAppToShow } = await import('./landing-home');

const homeApp = { appId: 'app-1', title: 'Rota board', icon: null, color: null };
const hub = {
  siteName: null,
  memberName: 'Mo',
  version: '0.0.0',
  sections: [],
  counts: { page: 0 },
  apps: [],
};

const view = (showBuiltIn: boolean) =>
  renderToStaticMarkup(
    createElement(LandingAppView, {
      homeApp,
      hub,
      builtIn: createElement('p', null, 'BUILT-IN HOME'),
      showBuiltIn,
      onShowBuiltIn: () => {},
      onNav: () => {},
      onError: () => {},
      onLoadFailure: () => {},
    }),
  );

describe('homeAppToShow', () => {
  it("shows the workspace's home app", () => {
    expect(homeAppToShow({ homeApp }, null)).toBe(homeApp);
  });

  it('falls back to Desk when that app failed to load, or there is none', () => {
    expect(homeAppToShow({ homeApp }, 'app-1')).toBeNull();
    expect(homeAppToShow({ homeApp: null }, null)).toBeNull();
    expect(homeAppToShow(undefined, null)).toBeNull();
    // Another app's failure does not hide this one.
    expect(homeAppToShow({ homeApp }, 'app-2')).toBe(homeApp);
  });
});

describe('LandingAppView', () => {
  it("runs the app with the landing page's data as its hub", () => {
    sandbox.props = [];
    const html = view(false);
    expect(html).toContain('data-app="app-1"');
    expect(html).not.toContain('BUILT-IN HOME');
    const props = sandbox.props.at(-1)!;
    expect((props.hub as { getData: () => unknown }).getData()).toBe(hub);
    expect(typeof props.onLoadFailure).toBe('function');
    // The toggle names the app and Desk; the app is pressed.
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*Rota board/);
    expect(html).toContain('>Desk<');
  });

  it('the toggle shows Desk and keeps the app mounted, hidden', () => {
    const html = view(true);
    expect(html).toContain('BUILT-IN HOME');
    expect(html).toContain('data-app="app-1"');
    expect(html).toMatch(/<div class="hidden"><div data-app="app-1"/);
  });
});
