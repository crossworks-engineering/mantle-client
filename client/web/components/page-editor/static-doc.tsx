'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { generateHTML, generateJSON, type JSONContent } from '@tiptap/core';
import { assetUrl, subscribeAssetToken } from '@mantle/web-ui/asset-url';
import { formatBytes } from '@mantle/web-ui/lib/format-bytes';
import { stampDrawEmbeds } from './draw-embed-theme';
import { useStaticCanvasEmbeds } from './canvas-embed';
import { lowlight, pageExtensions } from './extensions';
import { ASSET_PATH_ATTR } from './image';
import { FolderIndexList } from './folder-index-list';
import { wireHeadingFolds } from '@mantle/share-ui/heading-fold-dom';

/**
 * A page document rendered as STATIC HTML — the same schema, without an editor.
 *
 * `PageView` and the assistant's `RichText` are both live TipTap editors that
 * nobody can type into, which is a lot of machinery for a read: a 25-turn
 * assistant thread mounted 25 ProseMirror views, their plugins, and a React
 * NodeView per callout/aside/embed inside each. This renders the identical
 * markup by calling the schema's own `renderHTML` through `generateHTML`, so
 * there is no second renderer to keep in step — the chrome comes from the CSS
 * that `@mantle/share-ui/styles/app.css` already ships for exactly this shape
 * (the public share surface renders the same `[data-callout]` / `[data-aside]`
 * / `.file-embed` / `[data-child-page]` divs), which is why the container
 * below must keep the `ProseMirror` class those rules are scoped to.
 *
 * `dangerouslySetInnerHTML` is safe here and only here: the string is not
 * pass-through HTML but ProseMirror's own serialisation of a parsed document,
 * so anything the schema does not model was dropped before it reached us, and
 * every text node and attribute is escaped by the serialiser.
 *
 * What this deliberately does NOT do is reproduce the NodeView chrome — a
 * callout renders as the share surface's tinted panel, without the lucide icon
 * the in-app NodeView draws. That is a visible difference on the replies that
 * use one, and the reason this is opt-in per surface rather than swapped in
 * everywhere.
 */

/** A lowlight/hast node — only the two shapes `highlight()` actually returns. */
type HastNode =
  | { type: 'text'; value: string }
  | {
      type: 'element';
      tagName: string;
      properties?: { className?: string[] | string };
      children?: HastNode[];
    }
  | { type: 'root'; children?: HastNode[] };

/** hast → real DOM nodes. Built with `createElement`/`createTextNode` rather
 *  than an HTML string, so the code text cannot re-enter as markup. */
function hastToDom(node: HastNode, doc: Document): globalThis.Node {
  if (node.type === 'text') return doc.createTextNode(node.value);
  const children = node.type === 'root' ? (node.children ?? []) : (node.children ?? []);
  if (node.type === 'root') {
    const frag = doc.createDocumentFragment();
    for (const child of children) frag.appendChild(hastToDom(child, doc));
    return frag;
  }
  const el = doc.createElement(node.tagName);
  const cls = node.properties?.className;
  if (cls) el.setAttribute('class', Array.isArray(cls) ? cls.join(' ') : cls);
  for (const child of children) el.appendChild(hastToDom(child, doc));
  return el;
}

/**
 * Syntax-highlight the code blocks, which `renderHTML` alone cannot do.
 *
 * `CodeBlockLowlight` highlights through a ProseMirror DECORATION, not through
 * the node's `renderHTML` — so a straight `generateHTML` pass emits bare code
 * text and a reply full of code came out flat. Measured, not assumed: the
 * before/after probe counted four `hljs` spans in the editor render and zero
 * in the static one. Highlighting here with the editor's own `lowlight`
 * instance is the same thing the server's `render-page-doc.ts` does for the
 * public surface, and keeps one language registry rather than two.
 *
 * An unknown or absent language is left exactly as it was — the same quiet
 * degradation the editor gives it.
 */
function highlightCodeBlocks(root: ParentNode, doc: Document): void {
  for (const code of root.querySelectorAll('pre code')) {
    const language = [...code.classList]
      .find((c) => c.startsWith('language-'))
      ?.slice('language-'.length);
    if (!language || !lowlight.registered(language)) continue;
    try {
      const tree = lowlight.highlight(language, code.textContent ?? '') as unknown as HastNode;
      const rendered = hastToDom(tree, doc);
      code.replaceChildren(rendered);
    } catch {
      // Leave the plain text: a highlighter that throws must not cost the
      // reader the code itself.
    }
  }
}

/** Serialise once, off the schema's own `renderHTML`. Browser-only: both
 *  helpers parse through the DOM, which the SSR pass has no implementation of. */
function renderStatic(input: {
  html?: string;
  json?: JSONContent;
  transformDoc?: (doc: JSONContent) => JSONContent;
}): string {
  const parsed = input.json ?? (generateJSON(input.html ?? '', pageExtensions) as JSONContent);
  const doc = input.transformDoc ? input.transformDoc(parsed) : parsed;
  const serialised = generateHTML(doc, pageExtensions);
  // Round-trip through a detached <template>: it parses without running
  // scripts, loading images or touching the live document.
  const tpl = document.createElement('template');
  tpl.innerHTML = serialised;
  highlightCodeBlocks(tpl.content, document);
  return tpl.innerHTML;
}

/** Point every stored asset path in rendered HTML somewhere else (the member
 *  surface serves bytes from its own routes). Runs on a detached template, so
 *  the original src never loads. */
function remapAssets(rendered: string, mapAssetPath: (path: string) => string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = rendered;
  for (const img of tpl.content.querySelectorAll<HTMLImageElement>(`img[${ASSET_PATH_ATTR}]`)) {
    const path = img.getAttribute(ASSET_PATH_ATTR);
    if (!path) continue;
    const mapped = mapAssetPath(path);
    img.setAttribute(ASSET_PATH_ATTR, mapped);
    img.setAttribute('src', assetUrl(mapped));
  }
  return tpl.innerHTML;
}

/** Marks a file embed's download chip (fillFileEmbeds) with the file's id. */
export const EMBED_FILE_ATTR = 'data-embed-file';

/**
 * Give each file embed a download chip. The schema's `renderHTML` emits the
 * embed as an EMPTY `div[data-file-embed]` (the editor draws it with a
 * NodeView), so a static read showed nothing where a file was embedded. Each
 * becomes the share surface's `a.file-embed` chip: the file's name and size,
 * pointing at `fileEmbedPath(id)` (a reader's own byte route) and marked
 * with the id (EMBED_FILE_ATTR). Built with DOM calls, so the name cannot
 * re-enter as markup.
 */
function fillFileEmbeds(rendered: string, fileEmbedPath: (id: string) => string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = rendered;
  for (const el of tpl.content.querySelectorAll<HTMLElement>(
    'div[data-file-embed][data-node-id]',
  )) {
    const id = el.getAttribute('data-node-id');
    if (!id) continue;
    const name = el.getAttribute('data-filename') || 'file';
    const size = Number(el.getAttribute('data-size'));
    const a = document.createElement('a');
    a.className = 'file-embed';
    a.href = fileEmbedPath(id);
    a.setAttribute('download', name);
    a.setAttribute(EMBED_FILE_ATTR, id);
    a.textContent = size > 0 ? `${name} · ${formatBytes(size)}` : name;
    el.replaceChildren(a);
  }
  return tpl.innerHTML;
}

export function StaticDoc({
  html,
  json,
  className,
  onClick,
  mapAssetPath,
  fileEmbedPath,
  hereFolderId,
  transformDoc,
}: {
  /** HTML to normalise through the schema (the assistant's markdown path). */
  html?: string;
  /** A stored ProseMirror document (the pages path). */
  json?: JSONContent;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Rewrite each image's stored asset path (the member surface). */
  mapAssetPath?: (path: string) => string;
  /** Draw each file embed as a download chip pointing here (fillFileEmbeds).
   *  Pass a stable function. */
  fileEmbedPath?: (id: string) => string;
  /** The folder the page sits in (folder phase 7), what a Folder index block
   *  with no folder of its own (`here`) lists; null at the top level,
   *  undefined when unknown (the block then shows its label alone). */
  hereFolderId?: string | null;
  /** A last pass over the parsed document before it renders, on values the
   *  DOM has already decoded (the assistant's link and picture rules,
   *  lib/chat-links.ts). Pass a stable function. */
  transformDoc?: (doc: JSONContent) => JSONContent;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Rendered in an effect, not in a `useMemo`, so the SSR pass and the
  // hydration pass agree on "nothing here yet" — the same contract the editors
  // this replaces had, where the content appeared once the client editor
  // mounted. Rendering during hydration instead would be a mismatch.
  const [rendered, setRendered] = useState<string | null>(null);
  // Embedded canvases: their state stamped, and a click opens the live
  // canvas over the page when a CanvasEmbedHost holds this view.
  useStaticCanvasEmbeds(ref, rendered);
  useEffect(() => {
    let out = renderStatic({ html, json, transformDoc });
    if (mapAssetPath) out = remapAssets(out, mapAssetPath);
    if (fileEmbedPath) out = fillFileEmbeds(out, fileEmbedPath);
    setRendered(out);
  }, [html, json, mapAssetPath, fileEmbedPath, transformDoc]);

  // The editor path gets this from a ProseMirror plugin (see image.ts); a
  // static container has no plugins, so it re-signs its own images when the
  // asset token arrives or rotates. Same attribute, same rule: without it a
  // detached client's pictures stay broken for the session.
  useEffect(() => {
    if (rendered === null) return;
    const resign = () => {
      const root = ref.current;
      if (!root) return;
      for (const img of root.querySelectorAll<HTMLImageElement>(`img[${ASSET_PATH_ATTR}]`)) {
        const path = img.getAttribute(ASSET_PATH_ATTR);
        if (!path) continue;
        const next = assetUrl(path);
        if (img.getAttribute('src') !== next) img.setAttribute('src', next);
      }
    };
    resign();
    const unsubscribe = subscribeAssetToken(resign);
    // Embedded drawings follow the canvas under dark mode, exactly as they do
    // in the editor — the static container has no plugins to do it for us.
    const cancelStamp = ref.current ? stampDrawEmbeds(ref.current) : () => {};
    return () => {
      unsubscribe();
      cancelStamp();
    };
  }, [rendered]);

  // Foldable headings: the arrows, the folding and the reader's remembered
  // choices (share-ui heading-fold-dom.ts, the same code the share reader
  // runs). Rewired whenever the HTML is replaced.
  useEffect(() => {
    if (rendered === null) return;
    return wireHeadingFolds(ref.current);
  }, [rendered]);

  // The Folder index blocks (folder phase 7): the schema renders each as an
  // empty `div[data-folder-index]` (the editor draws it with a NodeView), so
  // the live list is portaled into each one once the HTML is in the DOM.
  const [indexes, setIndexes] = useState<{ el: HTMLElement; folderId: string | null }[]>([]);
  useEffect(() => {
    const root = ref.current;
    if (rendered === null || !root) {
      setIndexes([]);
      return;
    }
    setIndexes(
      Array.from(root.querySelectorAll<HTMLElement>('div[data-folder-index]'), (el) => ({
        el,
        folderId: el.getAttribute('data-folder-id') || null,
      })),
    );
  }, [rendered]);

  if (rendered === null) return null;
  return (
    <>
      <div
        ref={ref}
        onClick={onClick}
        // `ProseMirror` is load-bearing, not decoration: every chrome rule in
        // share-ui's app.css is scoped under it.
        className={`ProseMirror ${className ?? ''}`}
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
      {indexes.map((ix, i) =>
        createPortal(
          <FolderIndexList folderId={ix.folderId} hereFolderId={hereFolderId} />,
          ix.el,
          `folder-index-${i}`,
        ),
      )}
    </>
  );
}
