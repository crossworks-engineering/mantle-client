/**
 * /formulas/[id] — one formula, read (`/formulas/<id>`) or edited
 * (`?edit=1`), INSIDE the Formulas screen: `../layout.tsx` renders
 * `FormulasClient`, which reads the id from the route, so the folders stay.
 * Nothing renders here. Old `?id=` links move here.
 */
export default function FormulaItemRoute() {
  return null;
}
