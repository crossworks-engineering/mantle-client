import { redirect } from 'next/navigation';

/**
 * The Dashboard became Status (/status). Kept as a stub because the route
 * was in the menu, in bookmarks and in the help.
 */
export default function DashboardRedirect() {
  redirect('/status');
}
