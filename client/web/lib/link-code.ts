/**
 * The code an invite link (/invite) carries, and how it leaves the address
 * bar. /client-signin stays in the no-referrer list below: an old client
 * sign-in link still lands there before the page-load guard
 * (lib/route-guard.ts) sends it to /login.
 *
 * Links carry it in the FRAGMENT (`#code=…`, since the client logins audit
 * fixes): a fragment never reaches a server, so it lands in no access log and
 * in no Referer header. Links issued before carry it in the query
 * (`?code=…`), and still work: the fragment is read first, then the query.
 * Either way the code is dropped from the address (and so from the history)
 * at once, before the page does anything else: an inline script in the page
 * (LINK_CODE_SCRIPT) strips it while the document is still parsing and
 * leaves it on `window[LINK_CODE_GLOBAL]`, and the page's first layout
 * effect takes it from there (takeLinkCode). The pages are also served with
 * `Referrer-Policy: no-referrer` by the host (docs/static-ui-host.md), for
 * the query links.
 */

/** The pages a link's code lands on, as path patterns (`:path*` = anything
 *  below): the host serves each with `Referrer-Policy: no-referrer`, so a
 *  query code (links issued before the fragment) never rides out in a Referer
 *  header. docs/static-ui-host.md lists them for hosts. */
export const LINK_CODE_PAGES = [
  '/client-signin',
  '/client-signin/:path*',
  '/invite',
  '/invite/:path*',
] as const;

/** Where the inline script leaves the code it took out of the address. */
export const LINK_CODE_GLOBAL = '__MANTLE_LINK_CODE__';

/** Set on <html> by the inline script while a code it found waits for the
 *  page to read it: the page's other states stay hidden meanwhile (a link
 *  never flashes "ask for a link" before its own form). */
export const LINK_CODE_ATTR = 'data-link-code';

/** The code in `href` (the fragment's first, else the query's; whitespace
 *  dropped), and the address without it (null when there was none to drop).
 *  Everything else in the address is kept. */
export function readLinkCode(href: string): { code: string; clean: string | null } {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const inHash = hash.has('code');
  const inQuery = url.searchParams.has('code');
  const code = (hash.get('code') || url.searchParams.get('code') || '').replace(/\s+/g, '');
  if (!inHash && !inQuery) return { code, clean: null };
  let tail = url.hash;
  if (inHash) {
    hash.delete('code');
    const rest = hash.toString();
    tail = rest ? `#${rest}` : '';
  }
  if (inQuery) url.searchParams.delete('code');
  return { code, clean: url.pathname + url.search + tail };
}

/**
 * The inline script both pages render first: while the document parses, it
 * takes the code out of the address (fragment first, then query), leaves it
 * on `window[LINK_CODE_GLOBAL]` and marks <html> with LINK_CODE_ATTR. Plain
 * ES5 with no dependency, so it runs before any bundle. The same rules as
 * readLinkCode, pinned against it by link-code.test.ts.
 */
export const LINK_CODE_SCRIPT = `(function(){try{
var l=window.location;
function dec(v){try{return decodeURIComponent(v.replace(/\\+/g,' '));}catch(e){return v;}}
function pick(str){var parts=str?str.split('&'):[],code=null,rest=[];
for(var i=0;i<parts.length;i++){var eq=parts[i].indexOf('=');
var k=dec(eq<0?parts[i]:parts[i].slice(0,eq));
if(k==='code'){if(code===null){code=eq<0?'':dec(parts[i].slice(eq+1));}}else if(parts[i]){rest.push(parts[i]);}}
return{code:code,rest:rest.join('&')};}
var h=pick(l.hash.replace(/^#/,'')),q=pick(l.search.replace(/^\\?/,''));
if(h.code===null&&q.code===null)return;
var code=(h.code||q.code||'').replace(/\\s+/g,'');
window.${LINK_CODE_GLOBAL}=code;
var clean=l.pathname+(q.code===null?l.search:(q.rest?'?'+q.rest:''))+(h.code===null?l.hash:(h.rest?'#'+h.rest:''));
window.history.replaceState(window.history.state,'',clean);
if(code){document.documentElement.setAttribute('${LINK_CODE_ATTR}','');}
}catch(e){}})();`;

type LinkCodeWindow = {
  location: { href: string };
  history: { state: unknown; replaceState: (data: unknown, unused: string, url: string) => void };
};

/**
 * The page's side, in its first layout effect: the code the inline script
 * took (or, if it did not run, the one still in the address, which is then
 * dropped from it), and <html>'s mark cleared. Empty string: no code.
 */
export function takeLinkCode(win: LinkCodeWindow, root?: { removeAttribute(n: string): void }) {
  const slot = win as unknown as Record<string, unknown>;
  const stashed = slot[LINK_CODE_GLOBAL];
  delete slot[LINK_CODE_GLOBAL];
  const { code, clean } = readLinkCode(win.location.href);
  if (clean !== null) win.history.replaceState(win.history.state, '', clean);
  root?.removeAttribute(LINK_CODE_ATTR);
  return typeof stashed === 'string' && stashed ? stashed : code;
}
