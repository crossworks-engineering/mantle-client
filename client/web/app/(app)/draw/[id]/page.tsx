/**
 * /draw/[id] — one drawing, looked at (`/draw/<id>`) or edited (`?edit=1`),
 * INSIDE the Draw screen: `../layout.tsx` renders `DrawsClient`, which reads
 * the id from the route, so the folders stay. Nothing renders here.
 */
export default function DrawItemRoute() {
  return null;
}
