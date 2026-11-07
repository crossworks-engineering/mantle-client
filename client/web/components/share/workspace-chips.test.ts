/**
 * The workspace chips (W5b2; replace AudienceBadge): names, at most three
 * then +N, nothing from a brain before W5b, and the hub tag kept.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceChips } from './workspace-chips';

const chips = (item: unknown, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(WorkspaceChips, { item, ...extra }));

describe('WorkspaceChips', () => {
  it('shows each workspace name', () => {
    const html = chips({
      workspaces: [
        { id: 't', name: 'Team' },
        { id: 'a', name: 'Admin' },
      ],
    });
    expect(html).toContain('>Admin<');
    expect(html).toContain('>Team<');
    expect(html).toContain('title="Shared with: Admin, Team"');
  });

  it('three, then +N', () => {
    const ws = ['A', 'B', 'C', 'D', 'E'].map((n) => ({ id: n, name: n }));
    const html = chips({ workspaces: ws });
    expect(html).toContain('+2');
    expect(html).not.toContain('>D<');
  });

  it('nothing for a row with no workspaces (a brain before W5b)', () => {
    expect(chips({ audience: 'team' })).toBe('');
  });

  it('keeps the hub tag on an app', () => {
    expect(chips({}, { hub: true })).toContain('hub');
  });

  it('the public pill for a live open link (8.1)', () => {
    expect(chips({ hasLink: true })).toContain('>public<');
    expect(chips({ hasLink: false })).toBe('');
  });

  it("each pill in its workspace's colour; none picked, the neutral pill (task 5edc9149)", () => {
    const html = chips({
      workspaces: [
        { id: 't', name: 'Team', color: 'teal', kind: 'team' },
        { id: 'a', name: 'Admin', color: null, kind: 'admin' },
      ],
    });
    // The tint's fill with the page's text: the tint ink reads under 4.5:1.
    expect(html).toMatch(/bg-app-tint-teal text-foreground[^>]*>Team</);
    expect(html).toMatch(/bg-secondary[^>]*>Admin</);
  });

  it("icons: each workspace's icon in its colour, no names, said for a screen reader (task ca907a89)", () => {
    const html = chips(
      {
        workspaces: [
          { id: 't', name: 'Team', color: 'teal', icon: 'lucide:rocket', kind: 'team' },
          { id: 'a', name: 'Admin', kind: 'admin' },
        ],
        hasLink: true,
      },
      { variant: 'icons' },
    );
    expect(html).not.toContain('>Team<');
    expect(html).toContain('bg-app-tint-teal');
    expect(html).toContain('<span class="sr-only">Shared with: Admin, Team</span>');
    expect(html).toContain('Open link');
    expect(html).not.toContain('>public<');
  });

  it('icons: four, then +N', () => {
    const ws = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => ({ id: n, name: n }));
    expect(chips({ workspaces: ws }, { variant: 'icons' })).toContain('+2');
  });

  it('compact chips for a tree row', () => {
    expect(chips({ workspaces: [{ id: 't', name: 'Team' }] }, { compact: true })).toContain(
      'text-[10px]',
    );
  });
});
