import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One shell for every login (phase W5c), pinned where the node test runner
 * cannot render it (the shell needs the Next router and the query client).
 * The parts are unit-tested: lib/shell-probe.test.ts (the probe),
 * components/layout/shell-screens.test.ts (the gate's screens),
 * components/layout/shell-role.test.ts (the brain's role) and
 * lib/workspaces.test.ts (the area table).
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const web = join(here, '..');
const src = (rel: string) => readFileSync(join(here, rel), 'utf8');
const shell = src('./app-shell.tsx');
const layout = src('../app/(app)/layout.tsx');

describe('one probe: GET /api/shell', () => {
  it('the shell asks /api/shell once, and no member or client shell', () => {
    expect(shell.match(/queryKey: \['shell'\]/g)).toHaveLength(1);
    expect(shell.match(/apiFetch<ShellData>\('\/api\/shell'\)/g)).toHaveLength(1);
    expect(shell).not.toMatch(/\/api\/member|\/api\/client|\/api\/team-admin/);
  });

  it('it keeps the asset token fresh, refetches on focus, and retries once', () => {
    expect(shell).toContain(
      'refetchInterval: (query) => assetTokenRefreshDelayMs(query.state.data?.assetToken),',
    );
    expect(shell).toContain('refetchOnWindowFocus: true,');
    expect(shell).toContain('retry: 1,');
  });

  it('every login reads bytes on the owner routes: no asset path map (W7e)', () => {
    expect(shell).not.toMatch(/setAssetPathMap|memberAssetPath/);
    expect(shell).toContain('setAssetToken(brand.assetToken);');
  });

  it('an offline (paused) probe counts, so the shell does not sit on Loading', () => {
    expect(shell).toContain("paused: shell.fetchStatus === 'paused',");
    expect(shell).toContain('const failure = shellProbeFailure({');
  });

  it('everything, providers and frame, renders once the shell has answered', () => {
    expect(shell).toMatch(
      /<ShellGate ready=\{data !== undefined\} failure=\{failure\} retrying=\{retrying\} onRetry=\{retry\}>\s*\{data !== undefined \? \(\s*<ToastProvider>/,
    );
    expect(shell.match(/<ShellFrame /g)).toHaveLength(1);
    expect(shell).toContain('<ShellFrame {...props} shell={data} />');
  });
});

describe('no role routing in the shell itself', () => {
  it('the layout seeds no role and sets no client tab title', () => {
    expect(layout).not.toMatch(/role|HINT_COOKIE|generateMetadata|clientTabTitle/);
    expect(layout).toContain('<AppShell');
  });

  it('the shell reads no hint, parses no refusal and reloads nobody', () => {
    expect(shell).not.toMatch(
      /setMemberHint|setClientHint|LoginRefusal|location\.(reload|replace)|ClientPortal|setSwitchLanding/,
    );
  });

  // System workspace (owner, 2026-11-19): an Admin user outside System
  // keeps the admin shell; only System matter needs the settings area.
  it('admin chrome needs an Admin seat; System matter the settings area; one answer', () => {
    expect(shell).toContain('const adminSeat = holdsAdminSeat(shellAreasOf(shell));');
    expect(shell).toContain("const manages = hasArea(shellAreasOf(shell), 'settings');");
    for (const chrome of [
      '{adminSeat ? <PendingQuestionWatcher /> : null}',
      '{adminSeat ? <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} /> : null}',
      '{zen || !adminSeat ? null : (',
      // System matter: model spend, and banners whose route or screen is settings.
      '{manages ? contextCard : null}',
      '{manages ? <UpdateBanner onNavigate={onNavigate} /> : null}',
      '{manages ? <ProviderAlertBanner onNavigate={onNavigate} /> : null}',
    ]) {
      expect(shell, chrome).toContain(chrome);
    }
    expect(shell).not.toContain('{manages ? <SearchPalette');
    expect(shell).not.toContain('{manages ? <PendingQuestionWatcher');
  });

  it('the first-run gate sends only a settings login to /onboarding', () => {
    expect(shell).toContain('const toOnboarding = goesToOnboarding(shell);');
    expect(shell).toContain("if (toOnboarding) router.replace('/onboarding');");
    expect(shell.match(/router\.replace\('\/onboarding'\)/g)).toHaveLength(1);
    expect(shell).not.toContain('if (!shell.onboarded)');
  });

  it('every page sits inside the one area check', () => {
    expect(shell).toContain('<AreaGate>{children}</AreaGate>');
  });

  it('the same nav for every login: no member nav', () => {
    expect(shell).toContain('<SidebarNav');
    expect(shell).not.toMatch(/MemberSidebarNav/);
  });
});

/** Every source file of the app, tests excluded. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe('the role plumbing of old is gone from the app', () => {
  it('no file names the retired role gate, role context or hint cookies', () => {
    // lib/contract/ holds verbatim copies of the brain's contract: its
    // comments name the retired routes (they answer 410 now).
    const offenders = sources(web)
      .filter((f) => !relative(web, f).startsWith(`lib${sep}contract${sep}`))
      .filter((f) =>
        /ShellRoleGate|useViewerRole|ViewerRoleProvider|MEMBER_HINT|CLIENT_HINT_COOKIE|\/api\/member\/shell|\/api\/client\/shell/.test(
          readFileSync(f, 'utf8'),
        ),
      )
      .map((f) => relative(web, f));
    expect(offenders).toEqual([]);
  });
});
