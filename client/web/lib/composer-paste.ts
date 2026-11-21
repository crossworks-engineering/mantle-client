/**
 * Paste-to-attach for the assistant composer: Ctrl/Cmd+V of a copied file (or a
 * screenshot) does what the attach button does.
 *
 * Pure decision logic, split from the component the same way `composer-keys` is,
 * because the clipboard is full of traps that only show up per-source:
 *
 *  - A file copied in Explorer arrives as `Files` alone. One copied in Finder
 *    arrives as `Files` PLUS `text/plain` holding the file NAME, so "has text"
 *    cannot mean "this is a text paste", or every Finder paste would type the
 *    filename into the box instead of attaching.
 *  - Text copied from Word/Excel/a web page arrives as text PLUS an image of
 *    itself in `Files`. That one IS a text paste: attaching a picture of the
 *    words the user meant to type would be absurd. Rich-text flavours
 *    (`text/html`, `text/rtf`) are what tell the two apart.
 *  - A browser's "Copy image" arrives as `text/html` (an `<img>` tag) PLUS
 *    the picture, with no plain text at all. That one is the picture: a
 *    rich flavour counts as text only when there is plain text to paste.
 */

/** The attach button's `accept` list, shared so the two doors agree. */
export const COMPOSER_ATTACH_ACCEPT =
  'image/*,.pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.json,.yaml,.yml';

/** The slice of a File the decision needs (so tests need no DOM `File`). */
export type PastedFileLike = { name: string; type: string };

export type PasteDecision<F extends PastedFileLike> =
  /** Not ours: let the browser paste text as usual. */
  | { kind: 'text' }
  /** Attach these files (every attachable one, in clipboard order); the caller
   *  must `preventDefault()`. */
  | { kind: 'attach'; files: F[] }
  /** A file was pasted but cannot be attached; the caller must
   *  `preventDefault()` (else Finder's filename lands in the box) and say why. */
  | { kind: 'reject'; reason: string };

/** Does `file` pass an `<input accept>` list? Mirrors the browser's own rules:
 *  `.ext` matches the name's extension, `type/*` a MIME family, else exact MIME. */
export function fileMatchesAccept(file: PastedFileLike, accept: string): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .some((token) => {
      if (token.startsWith('.')) return name.endsWith(token);
      if (token.endsWith('/*')) return type.startsWith(token.slice(0, -1));
      return type === token;
    });
}

const RICH_TEXT_FLAVOURS = ['text/html', 'text/rtf'];

/**
 * Decide what a paste into the composer means.
 *
 * @param types  `clipboardData.types`
 * @param files  `clipboardData.files` (unsupported ones are dropped; the composer
 *               decides which takes the inline slot and which are linked)
 * @param plainText  `clipboardData.getData('text/plain')`: a rich paste with
 *               none ("Copy image") is the picture, not text
 */
export function decideComposerPaste<F extends PastedFileLike>(
  types: readonly string[],
  files: readonly F[],
  accept: string = COMPOSER_ATTACH_ACCEPT,
  plainText?: string,
): PasteDecision<F> {
  if (files.length === 0) return { kind: 'text' };
  // Rich text alongside the files means the user copied CONTENT from an app,
  // and the file is just that app's picture of it. With no plain text, there
  // is nothing to paste as text: the picture is what was copied.
  const rich = types.some((t) => RICH_TEXT_FLAVOURS.includes(t.toLowerCase()));
  if (rich && (plainText === undefined || plainText.trim() !== '')) return { kind: 'text' };

  const ok = files.filter((f) => fileMatchesAccept(f, accept));
  if (ok.length > 0) return { kind: 'attach', files: ok };

  const first = files[0]!;
  const label = first.name || first.type || 'That file';
  return {
    kind: 'reject',
    reason: `${label} can't be attached here. Supported: images, PDF, Word, Excel, CSV, text, Markdown, JSON, YAML.`,
  };
}
