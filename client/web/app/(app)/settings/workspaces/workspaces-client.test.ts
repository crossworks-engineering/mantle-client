/**
 * The Workspaces list (W5a): every workspace the login is in, Admin first,
 * archived last; New workspace for any login; the first one open
 * beside the list.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@mantle/web-ui/ui/toast';
import type { Workspace } from '@/lib/workspaces';

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/workspaces',
  useSearchParams: () => new URLSearchParams(),
}));
// The resizable scaffold is not this test's subject: both panes, in order.
vi.mock('@mantle/web-ui/ui/master-detail', () => ({
  MasterDetail: ({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) =>
    createElement(
      'div',
      null,
      createElement('aside', null, list),
      createElement('main', null, detail),
    ),
}));

const { WorkspacesView } = await import('./workspaces-client');

function ws(id: string, name: string, over: Partial<Workspace> = {}): Workspace {
  return {
    id,
    name,
    description: '',
    contactNodeId: null,
    assistant: null,
    isAdmin: false,
    adminModerated: false,
    archived: false,
    userCount: 1,
    resourceCount: 0,
    me: { member: true, moderator: false },
    // Admin and Team are the built-in two (the brain always sends it).
    builtIn: over.isAdmin === true || over.adminModerated === true,
    ...over,
  };
}

const LIST = [
  ws('w-old', 'Old project', { archived: true }),
  ws('w-team', 'Team', { me: { member: true, moderator: true }, userCount: 4, resourceCount: 2 }),
  ws('w-admin', 'Admin', { isAdmin: true }),
];

function render(areas: string[] | undefined, selectedId: string | null = null): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client,
      children: createElement(
        ToastProvider,
        null,
        createElement(WorkspacesView, {
          workspaces: LIST,
          areas,
          selectedId,
          onSelect: () => {},
          newOpen: false,
          onNewOpenChange: () => {},
        }),
      ),
    }),
  );
}

const listPart = (html: string) => html.slice(html.indexOf('<aside>'), html.indexOf('</aside>'));
const detailPart = (html: string) => html.slice(html.indexOf('<main>'));

describe('WorkspacesView', () => {
  it('lists Admin first, then by name, archived last, with their pills and counts', () => {
    const list = listPart(render(['users']));
    const at = (s: string) => list.indexOf(s);
    expect(at('>Admin</span>')).toBeGreaterThan(-1);
    expect(at('>Admin</span>')).toBeLessThan(at('>Team</span>'));
    expect(at('>Team</span>')).toBeLessThan(at('>Old project</span>'));
    expect(list).toContain('>Archived<');
    expect(list).toContain('>Moderator<');
    expect(list).toContain('4 users');
  });

  it('offers New workspace to any login (the maker becomes its Moderator)', () => {
    expect(render(['users'])).toContain('New workspace');
    expect(render([])).toContain('New workspace');
  });

  it('opens the first workspace when nothing is selected', () => {
    expect(detailPart(render(['users']))).toMatch(/<h2[^>]*>.*Admin/);
  });

  it('opens the selected one from the deep link', () => {
    expect(detailPart(render(['users'], 'w-team'))).toMatch(/<h2[^>]*>.*Team/);
  });
});

describe('WorkspacesClient for a login with no areas (a Moderator)', () => {
  it('never offers the Admin parts', async () => {
    const { WorkspacesClient } = await import('./workspaces-client');
    const { workspaceKey } = await import('@/lib/workspaces');
    const team = ws('w-field', 'Field crew', {
      me: { member: true, moderator: true },
      contactNodeId: 'c1',
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['workspaces'], [team]);
    client.setQueryData(workspaceKey(team.id), {
      workspace: team,
      users: [],
      resources: [],
      hasHistory: false,
    });
    // One shell for every login (W5c): the areas are the shell's.
    client.setQueryData(['shell'], { areas: [] });
    const { connectorOptionsKey } = await import('@/components/workspaces/workspace-queries');
    // A list in the cache all the same: a Moderator is offered none of it.
    client.setQueryData(connectorOptionsKey(team.id), [
      { slug: 'crm', name: 'CRM', kind: 'api', held: false },
    ]);
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, {
        client,
        children: createElement(ToastProvider, null, createElement(WorkspacesClient)),
      }),
    );
    expect(html).toContain('Field crew');
    // Moderator controls, but no Admin parts.
    expect(html).toContain('id="workspace-name"');
    expect(html).toContain('Type at least 3 letters.');
    expect(html).not.toContain('placeholder="Search contacts"');
    expect(html).toContain('Set by an Admin user');
    expect(html).not.toContain('id="workspace-assistant-pick"');
    expect(html).not.toContain('Add a connector');
  });
});
