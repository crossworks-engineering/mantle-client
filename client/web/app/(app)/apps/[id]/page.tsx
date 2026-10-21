import { RoleSwitch } from '@/components/layout/shell-role';
import { MemberAppRun } from '@/components/member/member-app-run';

/**
 * /apps/[id] — for the owner, one app run (`/apps/<id>`) or edited
 * (`?edit=1`) INSIDE the Apps screen: `../layout.tsx` renders `AppsClient`,
 * which reads the id from the route, so the folders stay. A member only runs
 * the published build here; the editor never mounts for one.
 */
export default async function AppItemRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RoleSwitch member={<MemberAppRun id={id} />}>{null}</RoleSwitch>;
}
