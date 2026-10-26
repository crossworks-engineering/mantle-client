import { LandingHome } from '@/components/home/landing-home';

/**
 * Home: the landing page of the login's current workspace (task d78e7bde),
 * for every login. It follows the switcher: the workspace's home app, or
 * Desk with that workspace's data; "All my workspaces" is the
 * Desk over all of them. The brain health Dashboard moved to
 * /dashboard (the System menu).
 */
export default function HomePage() {
  return <LandingHome />;
}
