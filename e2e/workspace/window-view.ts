import type { Page } from '@playwright/test';
import { LOGINS } from './mock-workspace-api';

/**
 * Start the Chats window on the assistant's thread, not its list (the first
 * open shows the list, Bubble Chat phase 5): what the window saves once a
 * login has opened an agent there (components/assistant/window-view.ts).
 */
export async function agentView(page: Page, role: keyof typeof LOGINS = 'admin') {
  await page.addInitScript(
    (key) => localStorage.setItem(key, 'agent'),
    `mantle_window_view:${LOGINS[role].loginId}`,
  );
}
