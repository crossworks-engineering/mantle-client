/**
 * The Grant Access panel's body (W5b2, plan 7.1): every workspace row has
 * the same four columns under one header (name, Home radio, Writable
 * switch, Revoke). A Moderator gets the controls (plus Change here,
 * Restore, Add workspace, Grant these too, MCP access); a control the user
 * cannot use stays in its column, dimmed. A user who may not manage reads
 * the same columns with every control off. Admin and Team rows take the
 * same controls as any other row (contract 23: no bridge rows).
 */
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RadioGroup } from '@mantle/web-ui/ui/radio-group';
import {
  APP_MCP_HINT,
  APP_MCP_LABEL,
  HOME_ADD_FIRST_TEXT,
  NO_ADDABLE_TEXT,
  READ_ONLY_PANEL_TEXT,
  type GrantsView,
} from '../../lib/grants';
import { GRANT_GRID, GrantAccessView, type GrantAccessHandlers } from './grant-access-view';

const noop = () => {};
const handlers = {
  onWrite: noop,
  onRemove: noop,
  onRestore: noop,
  onHand: noop,
  onAdd: noop,
  onMove: noop,
  onGrantEmbeds: noop,
  onMcpAccess: noop,
};

function view(over: Partial<GrantsView> = {}): GrantsView {
  return {
    item: { id: 'n1', title: 'Plan', type: 'page' },
    home: { wsId: 'team', name: 'Team' },
    rows: [
      {
        wsId: 'team',
        name: 'Team',
        write: true,
        isHome: true,
        viaFolder: null,
        excluded: false,
      },
      {
        wsId: 'sales',
        name: 'Sales',
        write: false,
        isHome: false,
        viaFolder: { id: 'f1', title: 'Plans' },
        excluded: false,
      },
      {
        wsId: 'board',
        name: 'Board',
        write: false,
        isHome: false,
        viaFolder: { id: 'f1', title: 'Plans' },
        excluded: true,
      },
      {
        wsId: 'ops',
        name: 'Ops',
        write: true,
        isHome: false,
        viaFolder: null,
        excluded: false,
      },
    ],
    addable: [
      { wsId: 'x', name: 'Xylo' },
      { wsId: 'admin', name: 'Admin' },
    ],
    mayManage: true,
    mayLink: true,
    hasLink: false,
    link: null,
    serveCandidates: [],
    embedsNotGranted: [],
    ...over,
  };
}

/** The workspaces the user moderates, by default every one in view(). */
const MODERATES_ALL: ReadonlySet<string> = new Set(['team', 'sales', 'board', 'ops', 'admin']);

const render = (v: GrantsView, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(GrantAccessView, {
      view: v,
      busy: false,
      adminWsId: 'admin',
      moderated: MODERATES_ALL,
      ...handlers,
      ...extra,
    }),
  );

const count = (html: string, needle: string) => html.split(needle).length - 1;

/** The opening tag of the control with this aria-label. */
const tag = (html: string, label: string) =>
  html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';
const on = (html: string, label: string) => {
  const t = tag(html, label);
  return t !== '' && !t.includes('disabled=""');
};
const off = (html: string, label: string) => tag(html, label).includes('disabled=""');

/** The `<li>` rows of the rendered list, each as its own markup. */
const rowsOf = (html: string) =>
  html.match(/<li[^>]*data-testid="grant-row"[^>]*>.*?<\/li>/g) ?? [];

/** The panel's Home radio group, found in the element tree (the view uses
 *  no hooks, so calling it returns the tree to read its handlers from). */
function homeGroup(
  v: GrantsView,
  extra: Partial<GrantAccessHandlers> & { busy?: boolean; moderated?: ReadonlySet<string> } = {},
) {
  const tree = GrantAccessView({
    view: v,
    busy: false,
    adminWsId: 'admin',
    moderated: MODERATES_ALL,
    ...handlers,
    ...extra,
  });
  const walk = (n: ReactNode): ReactElement | null => {
    if (Array.isArray(n)) {
      for (const c of n) {
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    }
    if (!isValidElement(n)) return null;
    if (n.type === RadioGroup) return n;
    return walk((n.props as { children?: ReactNode }).children);
  };
  const group = walk(tree);
  if (!group) throw new Error('no Home radio group');
  return group.props as { value: string; onValueChange: (wsId: string) => void };
}

describe('GrantAccessView columns', () => {
  const html = render(view());
  const rows = rowsOf(html);

  it('one header row labels the columns Home, Writable and Revoke, in that order', () => {
    const header = html.match(/<div[^>]*data-testid="grant-columns"[^>]*>.*?<\/div>/)?.[0] ?? '';
    expect(header).toContain('aria-hidden');
    expect(header.indexOf('>Home<')).toBeGreaterThan(-1);
    expect(header.indexOf('>Home<')).toBeLessThan(header.indexOf('>Writable<'));
    expect(header.indexOf('>Writable<')).toBeLessThan(header.indexOf('>Revoke<'));
    expect(html).not.toContain('Move…');
  });

  it('the header and every row share one grid, so the columns line up', () => {
    expect(rows).toHaveLength(4);
    expect(count(html, `class="${GRANT_GRID} `)).toBe(5);
    // The header takes the rows' border and padding, unseen, so its labels
    // sit over the controls to the pixel.
    const header = html.match(/<div[^>]*data-testid="grant-columns"[^>]*>/)?.[0] ?? '';
    expect(header).toMatch(/class="[^"]*\bborder border-transparent px-2\.5\b/);
    for (const r of rows)
      expect(r).toMatch(/^<li[^>]*class="[^"]*\bborder border-border[^"]*px-2\.5\b/);
  });

  it('every row has a radio, a switch and a Revoke, in that order', () => {
    for (const r of rows) {
      expect(count(r, 'role="radio"')).toBe(1);
      expect(count(r, 'role="switch"')).toBe(1);
      expect(count(r, 'aria-label="Revoke ')).toBe(1);
      expect(r.indexOf('role="radio"')).toBeLessThan(r.indexOf('role="switch"'));
      expect(r.indexOf('role="switch"')).toBeLessThan(r.indexOf('aria-label="Revoke '));
    }
  });

  it('the home row has the radio ticked; its Revoke is there but off, with why', () => {
    const home = rows[0]!;
    expect(home).toContain('>Team<');
    expect(home).toMatch(/role="radio" aria-checked="true"/);
    expect(home).toMatch(/title="The home stays. Pick another home first."/);
    expect(off(home, 'Revoke Team')).toBe(true);
    for (const r of rows.slice(1)) expect(r).toMatch(/role="radio" aria-checked="false"/);
  });

  it('a removed row keeps all three controls, dimmed and off', () => {
    const board = rows.find((r) => r.includes('>Board<'))!;
    expect(off(board, 'Make Board the home')).toBe(true);
    expect(off(board, 'Users in Board can change it')).toBe(true);
    expect(off(board, 'Revoke Board')).toBe(true);
    expect(board).toContain('title="Removed here. Restore it first."');
  });

  it('a folder row keeps its Writable switch, off until Change here', () => {
    const sales = rows.find((r) => r.includes('>Sales<'))!;
    expect(off(sales, 'Users in Sales can change it')).toBe(true);
    expect(sales).toContain('title="Read only: set by the folder. Change here first."');
    expect(sales).toContain('Change here');
  });
});

describe('GrantAccessView reasons for a screen reader', () => {
  /** The control's opening tag, then the text its aria-describedby names. */
  const described = (html: string, label: string) => {
    const id = tag(html, label).match(/aria-describedby="([^"]+)"/)?.[1];
    if (!id) return null;
    return html.match(new RegExp(`<span id="${id}" class="sr-only">([^<]*)</span>`))?.[1] ?? '';
  };

  it('each disabled control is described by why it is off', () => {
    const html = render(view(), { moderated: new Set(['team', 'sales', 'board']) });
    expect(described(html, 'Revoke Team')).toBe('The home stays. Pick another home first.');
    expect(described(html, 'Users in Sales can change it')).toBe(
      'Read only: set by the folder. Change here first.',
    );
    expect(described(html, 'Make Board the home')).toBe('Removed here. Restore it first.');
    expect(described(html, 'Make Ops the home')).toBe(
      'Only a Moderator of Ops can make it the home.',
    );
  });

  it('a control that may be used has no reason', () => {
    const html = render(view());
    expect(described(html, 'Make Ops the home')).toBeNull();
    expect(described(html, 'Users in Ops can change it')).toBeNull();
    expect(described(html, 'Revoke Ops')).toBeNull();
  });

  it('a reader hears why every control is off', () => {
    const html = render(view({ mayManage: false }), { moderated: new Set() });
    expect(described(html, 'Revoke Ops')).toBe(
      'Only a Moderator of the home or of Ops can revoke it.',
    );
    expect(described(html, 'Revoke Team')).toBe('The home stays.');
    expect(described(html, 'Make Ops the home')).toBe('Only a Moderator of the home can move it.');
  });
});

describe('GrantAccessView workspace tiles', () => {
  const looks = new Map([
    ['ops', { color: 'teal' as const, icon: 'lucide:rocket' }],
    ['team', { kind: 'team' as const, color: null, icon: null }],
  ]);
  const rows = rowsOf(render(view(), { looks }));
  const row = (name: string) => rows.find((r) => r.includes(`>${name}<`))!;

  it('each row starts with its workspace tile, in its colour and icon', () => {
    const ops = row('Ops');
    expect(ops).toContain('bg-app-tint-teal');
    expect(ops).toContain('lucide-rocket');
    expect(ops.indexOf('lucide-rocket')).toBeLessThan(ops.indexOf('>Ops<'));
  });

  it('an unpicked look draws the default of its kind on the neutral tile', () => {
    expect(row('Team')).toContain('lucide-users');
    expect(row('Team')).toContain('bg-muted text-muted-foreground');
  });

  it('a workspace the client does not know still gets a tile, and a removed row dims it', () => {
    expect(row('Sales')).toContain('lucide-layers');
    expect(row('Board')).toMatch(/aria-hidden="true" class="[^"]*opacity-50/);
  });

  it('every row has exactly one tile, so the names stay aligned', () => {
    for (const r of rows)
      expect(count(r, 'aria-hidden="true" class="inline-flex shrink-0')).toBe(1);
  });
});

describe('GrantAccessView Home radio', () => {
  it('a pick on another row asks to move it there; the radio stays on the home', () => {
    const onMove = vi.fn();
    const onWrite = vi.fn();
    const onRemove = vi.fn();
    const group = homeGroup(view(), { onMove, onWrite, onRemove });
    expect(group.value).toBe('team');
    group.onValueChange('ops');
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ wsId: 'ops', name: 'Ops' });
    expect(onWrite).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('the home itself, a removed row, a busy panel or a reader asks nothing', () => {
    const onMove = vi.fn();
    homeGroup(view(), { onMove }).onValueChange('team');
    homeGroup(view(), { onMove }).onValueChange('board');
    homeGroup(view(), { onMove, busy: true }).onValueChange('ops');
    homeGroup(view({ mayManage: false }), { onMove }).onValueChange('ops');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('a Moderator may pick any other listed row; adding comes first for the rest', () => {
    const html = render(view());
    expect(on(html, 'Make Ops the home')).toBe(true);
    expect(on(html, 'Make Sales the home')).toBe(true);
    expect(off(html, 'Make Board the home')).toBe(true);
    expect(html).toContain(HOME_ADD_FIRST_TEXT);
    expect(render(view({ addable: [] }))).not.toContain(HOME_ADD_FIRST_TEXT);
  });

  it('a row the user does not moderate cannot become the home, and says why', () => {
    // The brain moves an item only into a workspace the caller moderates.
    const moderated = new Set(['team', 'sales']);
    const rows = rowsOf(render(view(), { moderated }));
    const ops = rows.find((r) => r.includes('>Ops<'))!;
    expect(off(ops, 'Make Ops the home')).toBe(true);
    expect(ops).toContain('title="Only a Moderator of Ops can make it the home."');
    expect(
      on(
        rows.find((r) => r.includes('>Sales<'))!,
        'Make Sales the home',
      ),
    ).toBe(true);
    const onMove = vi.fn();
    homeGroup(view(), { onMove, moderated }).onValueChange('ops');
    expect(onMove).not.toHaveBeenCalled();
    homeGroup(view(), { onMove }).onValueChange('ops');
    expect(onMove).toHaveBeenCalledTimes(1);
  });
});

describe('GrantAccessView for a Moderator', () => {
  const html = render(view());

  it('lists every workspace, home first', () => {
    expect(html.indexOf('>Team<')).toBeLessThan(html.indexOf('>Ops<'));
    expect(html.indexOf('>Ops<')).toBeLessThan(html.indexOf('>Sales<'));
    expect(html).toContain('title="Team is the home: its Moderators manage it"');
  });

  it('a Writable switch per row, a Revoke that works except on the home', () => {
    expect(html).toContain('aria-label="Users in Ops can change it"');
    expect(html).toContain('title="Users in Ops can change it"');
    expect(on(html, 'Revoke Ops')).toBe(true);
    expect(html).toContain('title="Revoke Sales"');
    expect(off(html, 'Revoke Team')).toBe(true);
  });

  it('a folder row says so and offers Change here', () => {
    expect(html).toContain('Via folder Plans');
    expect(html).toContain('Change here');
  });

  it('a removed folder row says Removed here, with Restore', () => {
    expect(html).toContain('Removed here (folder Plans grants it)');
    expect(html).toContain('>Restore<');
    expect(off(html, 'Revoke Board')).toBe(true);
  });

  it('Add workspace shows, and no Move menu', () => {
    expect(html).not.toContain('Move…');
    expect(html).toContain('Add workspace');
    expect(html).not.toContain(READ_ONLY_PANEL_TEXT);
  });

  it('says so when there is nothing to add', () => {
    expect(render(view({ addable: [] }))).toContain(NO_ADDABLE_TEXT);
  });

  it('lists embeds not granted, with Grant these too', () => {
    const out = render(
      view({ embedsNotGranted: [{ nodeId: 'e1', title: 'Site photo', kind: 'file' }] }),
    );
    expect(out).toContain('One item it embeds is not shared with the same workspaces.');
    expect(out).toContain('Site photo');
    expect(out).toContain('Grant these too');
  });

  it('an app words the Write switch for its data and shows MCP access', () => {
    const out = render(view({ app: { mcpAccess: true } }), { type: 'app' });
    expect(out).toContain('aria-label="Users in Ops can change its data"');
    expect(out).toContain(APP_MCP_LABEL);
    expect(out).toContain('aria-label="MCP access"');
    expect(out).toContain(APP_MCP_HINT);
    expect(APP_MCP_HINT).toMatch(/^Read only for a workspace with Writable off\./);
  });

  it('MCP access is hidden for a login that is not an Admin user (W6b fix round: 403 admin-only)', () => {
    const out = render(view({ app: { mcpAccess: true } }), { type: 'app', mcpSwitch: false });
    expect(out).not.toContain(APP_MCP_LABEL);
    expect(out).not.toContain('aria-label="MCP access"');
    expect(out).not.toContain('>On</span>');
  });

  it('an Admin user who does not manage the app reads MCP access as On or Off', () => {
    const out = render(view({ app: { mcpAccess: true }, mayManage: false }), { type: 'app' });
    expect(out).toContain(APP_MCP_LABEL);
    expect(out).not.toContain('aria-label="MCP access"');
    expect(out).toContain('>On</span>');
  });

  it('an Admin row is like any other: its Write switch and Remove (no bridge lock)', () => {
    const v = view();
    v.rows = [
      ...v.rows,
      {
        wsId: 'admin',
        name: 'Admin',
        write: true,
        isHome: false,
        viaFolder: null,
        excluded: false,
      },
    ];
    const out = render(v);
    expect(on(out, 'Revoke Admin')).toBe(true);
    expect(out).toContain('aria-label="Users in Admin can change it"');
    expect(out).not.toMatch(/until grants become the truth/);
  });
});

describe('GrantAccessView read only', () => {
  const html = render(
    view({
      mayManage: false,
      app: { mcpAccess: false },
      embedsNotGranted: [{ nodeId: 'e1', title: 'Site photo', kind: 'file' }],
    }),
    { moderated: new Set() },
  );

  it('says who can change it and shows the rows', () => {
    expect(html).toContain(READ_ONLY_PANEL_TEXT);
    expect(html).toContain('>Sales<');
    expect(html).toContain('Read only');
    expect(html).toContain('Can change');
  });

  it('the same columns, every control there but off', () => {
    const rows = rowsOf(html);
    expect(rows).toHaveLength(4);
    expect(html).toContain('>Writable<');
    for (const name of ['Team', 'Ops', 'Sales', 'Board']) {
      const r = rows.find((x) => x.includes(`>${name}<`))!;
      expect(r.match(/<button[^>]*role="radio"[^>]*>/)![0]).toContain('disabled=""');
      expect(off(r, `Users in ${name} can change it`)).toBe(true);
      expect(off(r, `Revoke ${name}`)).toBe(true);
    }
    expect(html).not.toContain('aria-label="MCP access"');
  });

  it('no other controls', () => {
    expect(html).not.toContain('Add workspace');
    expect(html).not.toContain(HOME_ADD_FIRST_TEXT);
    expect(html).not.toContain('Change here');
    expect(html).not.toContain('>Restore<');
    expect(html).not.toContain('Move…');
    expect(html).not.toContain('Grant these too');
  });
});

describe('GrantAccessView for a Moderator of one row only (contract 10)', () => {
  const html = render(view({ mayManage: false }), { moderated: new Set(['ops']) });

  it('the Ops row gets Revoke and its Writable switch (to turn off)', () => {
    const ops = rowsOf(html).find((r) => r.includes('>Ops<'))!;
    expect(on(ops, 'Revoke Ops')).toBe(true);
    expect(on(ops, 'Users in Ops can change it')).toBe(true);
    expect(off(ops, 'Make Ops the home')).toBe(true);
  });

  it('other rows stay read only, and no manage controls show', () => {
    expect(off(html, 'Revoke Sales')).toBe(true);
    expect(html).not.toContain('Add workspace');
    expect(html).not.toContain('Change here');
    expect(html).not.toContain('Move…');
  });
});
