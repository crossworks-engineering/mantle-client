import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { assetUrl, subscribeAssetToken } from '@mantle/web-ui/asset-url';
import { DRAW_EMBED_CLASS } from '@/components/draw/snapshot-theme';

/** Where `renderHTML` parks the UNSIGNED path, so the refresh plugin below —
 *  and `StaticDoc`, which renders the same `renderHTML` output without an
 *  editor — can re-sign it without re-deriving which shape produced it. */
export const ASSET_PATH_ATTR = 'data-asset-path';

/** The figure an embedded Present canvas renders as (canvas-embed.tsx), its
 *  picture and its caption bar. The state the stamp writes
 *  (`data-canvas-state`) picks the look: a placeholder with no picture for
 *  `none` and `hidden`, the bar's own words (`data-note`) always. */
export const CANVAS_EMBED_CLASS =
  'canvas-embed group/canvas not-prose my-5 overflow-hidden rounded-lg border border-border bg-card';
// Shown only once the brain has said the reader may see it (live, stale):
// until then the picture is not drawn, so a broken image's alt never shows.
const CANVAS_EMBED_IMG_CLASS =
  'm-0 block h-auto w-full opacity-0 group-data-[canvas-state=live]/canvas:opacity-100 group-data-[canvas-state=stale]/canvas:opacity-100 ' +
  'group-data-[canvas-state=hidden]/canvas:hidden group-data-[canvas-state=none]/canvas:hidden group-data-[canvas-state=error]/canvas:hidden';
const CANVAS_EMBED_BAR_CLASS =
  'm-0 flex items-center gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground before:content-[attr(data-note)] ' +
  'group-data-[canvas-state=live]/canvas:cursor-pointer group-data-[canvas-state=stale]/canvas:cursor-pointer group-data-[canvas-state=none]/canvas:cursor-pointer ' +
  'group-data-[canvas-state=stale]/canvas:text-warning-ink ' +
  'group-data-[canvas-state=hidden]/canvas:justify-center group-data-[canvas-state=hidden]/canvas:border-t-0 group-data-[canvas-state=hidden]/canvas:py-8 ' +
  'group-data-[canvas-state=none]/canvas:justify-center group-data-[canvas-state=none]/canvas:border-t-0 group-data-[canvas-state=none]/canvas:py-8 ' +
  'group-data-[canvas-state=error]/canvas:justify-center group-data-[canvas-state=error]/canvas:border-t-0 group-data-[canvas-state=error]/canvas:py-8';

/**
 * Re-sign the rendered `<img>` srcs when the asset token arrives or rotates.
 *
 * `renderHTML` is static: ProseMirror calls it once per node and only re-runs
 * it when the node's own attributes change, which the token is not. In a
 * detached client the first paint therefore resolves an UNSIGNED url that
 * 401s, and nothing ever went back for it — the images on an open page stayed
 * broken for the rest of the session.
 *
 * A node view would be the heavier answer, and a wrong one here: the whole
 * point of this node is that it renders as a plain `<img>` in the editor, the
 * read-only `PageView` and the assistant's RichText alike. So the plugin
 * touches the DOM the same way `useDrawEmbedTheme` does — which is also why it
 * re-stamps rather than dispatching a transaction: a transaction would push an
 * undo entry for something the owner never did.
 *
 * Same-origin this subscription never fires (there is no token to publish).
 */
function assetTokenRefreshPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('imageAssetTokenRefresh'),
    view(editorView) {
      const resign = () => {
        const imgs = editorView.dom.querySelectorAll<HTMLImageElement>(`img[${ASSET_PATH_ATTR}]`);
        for (const img of imgs) {
          const path = img.getAttribute(ASSET_PATH_ATTR);
          if (!path) continue;
          const next = assetUrl(path);
          // Compare before assigning: setting `src` to its current value is a
          // no-op in every browser that matters, but setting it to a NEW value
          // restarts the load, and an unconditional write on a rotation would
          // re-download every image on the page.
          if (img.getAttribute('src') !== next) img.setAttribute('src', next);
        }
      };
      const unsubscribe = subscribeAssetToken(resign);
      return { destroy: unsubscribe };
    },
  });
}

/**
 * Block image node. Carries `nodeId` (the backing `file` node) alongside `src`
 * (the `?raw=1` serve route), so a page references an uploaded file by id rather
 * than inlining bytes. `drawId` is the same idea for an embedded DRAWING: the
 * page renders that draw's committed snapshot, live, so editing the drawing
 * updates every page that embeds it (markdown form: `![alt](draw:<id>)`). Part of the shared schema, so the editor, the read-only
 * PageView, and the assistant's RichText all render images identically.
 *
 * Markdown `![alt](url)` parses straight into this via `img[src]`, so Saskia can
 * embed images by URL too (uploads are an editor affordance — see upload.ts).
 */
export const PageImage = Node.create<{
  /** Rewrite the asset path an image loads from. Every app login reads the
   *  owner byte routes (/api/files, /api/draws) since W7e, so nothing here
   *  maps them; this is for a reader with byte routes of its own. Null = as
   *  stored. */
  mapAssetPath: ((path: string) => string) | null;
}>({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      nodeId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-node-id'),
        renderHTML: (attrs) => (attrs.nodeId ? { 'data-node-id': attrs.nodeId } : {}),
      },
      // Registered so TipTap round-trips it: an unknown attribute is dropped
      // on load, which would silently turn an embedded drawing into a blank
      // image the next time the page was saved.
      drawId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-draw-id'),
        renderHTML: (attrs) => (attrs.drawId ? { 'data-draw-id': attrs.drawId } : {}),
      },
      // An embedded Present canvas (markdown `![Title](present:<id>)`): the
      // page shows its snapshot and opens the live canvas (canvas-embed.tsx).
      presentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-present-id'),
        renderHTML: (attrs) => (attrs.presentId ? { 'data-present-id': attrs.presentId } : {}),
      },
    };
  },

  parseHTML() {
    // A canvas embed renders as a figure around its snapshot; read it back
    // whole, before the plain img rule sees the picture inside it.
    return [
      {
        tag: 'figure[data-present-id]',
        priority: 60,
        getAttrs: (el) => ({
          presentId: el.getAttribute('data-present-id'),
          alt: el.querySelector('img')?.getAttribute('alt') ?? null,
          src: null,
        }),
      },
      { tag: 'img[src]' },
    ];
  },

  addOptions() {
    return { mapAssetPath: null };
  },

  addProseMirrorPlugins() {
    return [assetTokenRefreshPlugin()];
  },

  renderHTML({ HTMLAttributes }) {
    // Route the asset src through assetUrl() so a detached/Electron client loads
    // it from the remote origin with the `?at=` token (a browser <img> can't send
    // a bearer header). Same-origin: assetUrl returns the path unchanged → no-op.
    // nodeId-backed images build the canonical serve path (matches renderPageDoc);
    // a bare relative `/api/...` src (markdown paste) is rewritten as-is; external
    // (http/https/data) srcs are left untouched. Only the rendered DOM is affected
    // — saves serialize via getJSON, so the stored doc keeps the raw attrs.
    const nodeId = HTMLAttributes['data-node-id'];
    const drawId = HTMLAttributes['data-draw-id'];
    const presentId = HTMLAttributes['data-present-id'];
    // A drawing first, the one order every renderer keeps (a node never
    // carries both; one written by hand that does is a drawing).
    const isDraw = typeof drawId === 'string' && drawId !== '';
    if (!isDraw && typeof presentId === 'string' && presentId) {
      // An embedded canvas: its snapshot (the poster route, in the reader's
      // scope) in a figure with a caption bar. Static, as every image: the
      // canvas-embed stamp marks its state (live, stale, none, hidden) and
      // the page's click opens the live canvas (canvas-embed.tsx).
      let posterPath = `/api/presents/${encodeURIComponent(presentId)}/poster`;
      const mapPath = this.options.mapAssetPath;
      if (mapPath) posterPath = mapPath(posterPath);
      const alt = typeof HTMLAttributes.alt === 'string' ? HTMLAttributes.alt : '';
      return [
        'figure',
        {
          class: CANVAS_EMBED_CLASS,
          'data-present-id': presentId,
          'data-no-lightbox': '',
          'data-canvas-state': 'loading',
        },
        [
          'img',
          {
            src: assetUrl(posterPath),
            alt,
            loading: 'lazy',
            draggable: 'false',
            class: CANVAS_EMBED_IMG_CLASS,
            [ASSET_PATH_ATTR]: posterPath,
          },
        ],
        ['figcaption', { class: CANVAS_EMBED_BAR_CLASS, 'data-canvas-open': '' }],
      ];
    }
    const rawSrc = typeof HTMLAttributes.src === 'string' ? HTMLAttributes.src : null;
    let src = rawSrc;
    let extraClass: string | null = null;
    // The unsigned path, kept so the token-refresh plugin can re-sign this
    // image without re-running the branching below. Stays null for external
    // (http/data) srcs, which carry no token and must not be touched.
    let assetPath: string | null = null;
    if (typeof drawId === 'string' && drawId) {
      // Always an <img>, never inline markup: the snapshot is validated but
      // image context is what actually makes it inert.
      assetPath = `/api/draws/${encodeURIComponent(drawId)}/svg?raw=1`;
      src = assetUrl(assetPath);
      // A snapshot is always captured light (docs/draw.md §5b), so under the
      // dark theme an embed follows the canvas the way the previews do. This
      // render is static and knows neither the theme nor the drawing, so the
      // class only ARMS the rule — `useDrawEmbedTheme` stamps the matching
      // data attribute once it has checked the snapshot for pasted images.
      extraClass = DRAW_EMBED_CLASS;
    } else if (typeof nodeId === 'string' && nodeId) {
      assetPath = `/api/files/files/${nodeId}?raw=1`;
      src = assetUrl(assetPath);
    } else if (rawSrc && rawSrc.startsWith('/')) {
      assetPath = rawSrc;
      src = assetUrl(assetPath);
    }
    const map = this.options.mapAssetPath;
    if (map && assetPath) {
      assetPath = map(assetPath);
      src = assetUrl(assetPath);
    }
    return [
      'img',
      mergeAttributes(
        HTMLAttributes,
        { src, loading: 'lazy' },
        extraClass ? { class: extraClass } : {},
        assetPath ? { [ASSET_PATH_ATTR]: assetPath } : {},
      ),
    ];
  },
});
