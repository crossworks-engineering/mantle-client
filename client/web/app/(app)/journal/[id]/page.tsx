/**
 * /journal/[id] — one entry, read (`/journal/<id>`) or edited (`?edit=1`),
 * INSIDE the Journal screen: `../layout.tsx` renders `JournalClient`, which
 * reads the id from the route, so the list stays. Nothing renders here.
 */
export default function JournalItemRoute() {
  return null;
}
