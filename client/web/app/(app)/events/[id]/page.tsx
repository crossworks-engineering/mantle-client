/**
 * /events/[id] — one event, read (`/events/<id>`) or edited (`?edit=1`),
 * INSIDE the Events screen: `../layout.tsx` renders `EventsClient`, which
 * reads the id from the route, so the folders stay. Nothing renders here.
 */
export default function EventItemRoute() {
  return null;
}
