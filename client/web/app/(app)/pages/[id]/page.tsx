/**
 * /pages/[id] — one page, read (`/pages/<id>`) or edited (`?edit=1`), INSIDE
 * the Pages screen: `../layout.tsx` renders `PagesClient`, which reads the id
 * from the route and puts the page or its editor in the detail pane, so the
 * folders stay. Nothing renders here. Every `/pages/<id>` link (search,
 * mentions, last opened, a copied address) opens the page to read.
 */
export default function PageEditorRoute() {
  return null;
}
