import { redirect } from 'next/navigation';

/**
 * Company sign-in moved from Settings to Admin (owner, 2026-11-09). Kept as a
 * stub because the old path is in bookmarks and in the docs.
 */
export default function CompanySignInRedirect() {
  redirect('/admin/company-sign-in');
}
