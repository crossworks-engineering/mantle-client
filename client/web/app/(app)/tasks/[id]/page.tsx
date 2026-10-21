/**
 * /tasks/[id] — one task, read (`/tasks/<id>`) or edited (`?edit=1`), INSIDE
 * the Tasks screen: `../layout.tsx` renders `TasksClient`, which reads the id
 * from the route, so the list stays. Nothing renders here.
 */
export default function TaskItemRoute() {
  return null;
}
