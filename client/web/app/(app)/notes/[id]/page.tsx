/**
 * /notes/[id] — one note, read (`/notes/<id>`) or edited (`?edit=1`), INSIDE
 * the Notes screen: `../layout.tsx` renders `NotesClient`, which reads the id
 * from the route, so the folders stay. Nothing renders here.
 */
export default function NoteItemRoute() {
  return null;
}
