/**
 * Agent UI, the DOM half: read the screen as labelled controls, find a
 * target, and tell the guard what an element is. Browser only.
 *
 * The read is a small accessibility view, not the DOM: visible controls
 * with a role and a name (buttons, links, fields, tabs, menu items, rows
 * that carry an id), cut to MAX_ENTRIES. An app's sandbox frame is one
 * opaque entry: the agent never sees or acts inside it. The agent's own
 * controls (`data-agent-host`) are left out.
 */
import {
  cutText,
  MAX_ENTRIES,
  pickByName,
  type AgentTarget,
  type ElementFacts,
  type Screen,
  type ScreenEntry,
} from './model';

const CONTROL = [
  'a[href]',
  'button',
  'input:not([type=hidden])',
  'select',
  'textarea',
  'summary',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role]',
  '[data-agent]',
  '[data-tour]',
  '[data-mark-id]',
  'iframe',
].join(',');

const ROLES_WITH_NAME = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'option',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'treeitem',
  'slider',
  'spinbutton',
  'row',
  'gridcell',
  'dialog',
  'alertdialog',
  'navigation',
  'frame',
]);

const SECRET_AUTOCOMPLETE = /\b(one-time-code|current-password|new-password|cc-number|cc-csc)\b/;

/** The id an element answers to: its `data-agent`, its tour anchor, or
 *  `row:<id>` for a list row. */
export function agentIdOf(el: Element): string | undefined {
  const h = el as HTMLElement;
  if (h.dataset?.agent) return h.dataset.agent;
  if (h.dataset?.tour) return h.dataset.tour;
  if (h.dataset?.markId) return `row:${h.dataset.markId}`;
  return undefined;
}

export function roleOf(el: Element): string {
  const explicit = el.getAttribute('role')?.split(' ')[0];
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button' || tag === 'summary') return 'button';
  if (tag === 'select') return (el as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'iframe') return 'frame';
  if (tag === 'nav') return 'navigation';
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'range') return 'slider';
    if (type === 'search') return 'searchbox';
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
    return 'textbox';
  }
  if ((el as HTMLElement).isContentEditable) return 'textbox';
  if ((el as HTMLElement).dataset?.markId) return 'row';
  return 'generic';
}

/** The accessible name, roughly as a screen reader reads it. */
export function nameOf(el: Element): string {
  // A secret's text never reaches the agent, not even as a name.
  if (el.closest?.('[data-secret]')) return '(hidden)';
  const label = el.getAttribute('aria-label');
  if (label?.trim()) return label;
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const text = by
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text) return text;
  }
  // A <label for> names a field, and a button too (a Radix switch is one).
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) {
    const text = [...labels].map((l) => l.textContent ?? '').join(' ');
    if (text.trim()) return text;
  }
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.placeholder) {
    return el.placeholder;
  }
  if (el instanceof HTMLIFrameElement) return el.title || 'app frame';
  const mark = (el as HTMLElement).dataset?.markLabel;
  if (mark) return mark;
  const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
  if (text.trim()) return text;
  return el.getAttribute('title') ?? '';
}

/** A password, a one-time code, or anything inside `data-secret` (a
 *  SecretInput, shown or not: its wrapper carries the mark, so flipping the
 *  field to plain text does not open it). Read from tag and attributes, so
 *  it holds for any element. */
export function isSecretField(el: Element): boolean {
  if (el.closest?.('[data-secret]')) return true;
  if (el.tagName?.toUpperCase() !== 'INPUT') return false;
  const type = String((el as HTMLInputElement).type ?? el.getAttribute('type') ?? '');
  const autocomplete = String(
    (el as HTMLInputElement).autocomplete ?? el.getAttribute('autocomplete') ?? '',
  );
  return type.toLowerCase() === 'password' || SECRET_AUTOCOMPLETE.test(autocomplete);
}

/** Behind an open modal (Radix marks the rest of the page `aria-hidden`, a
 *  native one makes it `inert`) or hidden: the user cannot reach it, so the
 *  agent may not either. */
export function isShut(el: Element): boolean {
  return !!el.closest?.('[aria-hidden="true"], [inert], [hidden]');
}

function visible(el: Element): boolean {
  const h = el as HTMLElement;
  if (isShut(h)) return false;
  const r = h.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
  const style = getComputedStyle(h);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

function stateOf(el: Element): string[] | undefined {
  const out: string[] = [];
  const attr = (name: string) => el.getAttribute(name);
  if (attr('aria-checked') === 'true' || (el as HTMLInputElement).checked) out.push('checked');
  if (attr('aria-selected') === 'true') out.push('selected');
  if (attr('aria-pressed') === 'true') out.push('pressed');
  if (attr('aria-expanded') === 'true') out.push('expanded');
  if (attr('aria-current') && attr('aria-current') !== 'false') out.push('current');
  if (attr('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled) out.push('disabled');
  return out.length ? out : undefined;
}

function valueOf(el: Element): string | undefined {
  if (isSecretField(el)) return '[hidden]';
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return undefined;
    return cutText(el.value);
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
    return cutText(el.value);
  return undefined;
}

/** The controls on screen, in reading order, with a fresh ref each. */
export function readScreen(root: Document = document): {
  screen: Screen;
  refs: Map<string, Element>;
} {
  const refs = new Map<string, Element>();
  const entries: ScreenEntry[] = [];
  let truncated = false;
  const seen = new Set<Element>();
  for (const el of root.querySelectorAll(CONTROL)) {
    if (seen.has(el)) continue;
    if (el.closest('[data-agent-host]')) continue;
    // Inside a frame: the frame is the entry, never what it holds.
    const role = roleOf(el);
    if (role === 'generic' && !agentIdOf(el)) continue;
    if (!ROLES_WITH_NAME.has(role) && !agentIdOf(el)) continue;
    if (!visible(el)) continue;
    const name = cutText(nameOf(el));
    if (!name && !agentIdOf(el)) continue;
    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    seen.add(el);
    const ref = `r${entries.length + 1}`;
    refs.set(ref, el);
    const id = agentIdOf(el);
    const state = stateOf(el);
    const value = role === 'frame' ? undefined : valueOf(el);
    entries.push({
      ref,
      ...(id ? { id } : {}),
      role,
      name,
      ...(state ? { state } : {}),
      ...(value !== undefined ? { value } : {}),
    });
  }
  return {
    screen: { route: location.pathname, title: document.title, entries, truncated },
    refs,
  };
}

export type Found = { el: Element } | { error: 'not_found' | 'ambiguous' | 'stale_ref' };

/** The one element a target names. */
export function findTarget(target: AgentTarget, refs: Map<string, Element>): Found {
  if ('ref' in target) {
    const el = refs.get(target.ref);
    if (!el) return { error: 'stale_ref' };
    // A ref from before a modal opened names a control behind it now.
    return el.isConnected && !isShut(el) ? { el } : { error: 'stale_ref' };
  }
  if ('id' in target) {
    const id = target.id;
    const sel = id.startsWith('row:')
      ? `[data-mark-id="${CSS.escape(id.slice(4))}"]`
      : `[data-agent="${CSS.escape(id)}"], [data-tour="${CSS.escape(id)}"]`;
    const hits = [...document.querySelectorAll(sel)].filter(
      (el) => !el.closest('[data-agent-host]') && visible(el),
    );
    if (hits.length === 0) return { error: 'not_found' };
    return hits.length === 1 ? { el: hits[0]! } : { error: 'ambiguous' };
  }
  return findByName([target.role.toLowerCase()], target.name);
}

/** The one control of any of `roles` called `name` (lib/agent-ui/model
 *  `pickByName`): an exact name in any of them wins over a name that only
 *  starts with it, so an option "Week" is not lost to a menu item
 *  "Weekly"; between roles, the earlier one. */
export function findByName(roles: readonly string[], name: string): Found {
  const { screen, refs } = readScreen();
  const hit = pickByName(screen.entries, roles, name);
  return 'error' in hit ? hit : { el: refs.get(hit.ref)! };
}

/** What the guard needs to know about an element. */
export function factsOf(el: Element): ElementFacts {
  const risk = (el as HTMLElement).closest?.('[data-agent-risk]')?.getAttribute('data-agent-risk');
  return {
    inHost: !!el.closest('[data-agent-host]'),
    risk: risk ?? null,
    // Anything in a confirm (a button, a link, a field to type a name
    // into): the user's to answer.
    inAlertDialog: !!el.closest('[role="alertdialog"]'),
    secret: isSecretField(el),
  };
}

/** The middle of an element, in viewport pixels. */
export function centerOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}
