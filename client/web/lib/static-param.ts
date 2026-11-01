/**
 * The placeholder each dynamic segment is exported under in a static build.
 * The host serves `/notes/_/` for any `/notes/<id>`, so the route's own
 * `params` read `_`; the real values come from the address bar
 * (lib/route-params.ts). Plain module: server layouts import it.
 */
export const STATIC_PARAM = '_';
