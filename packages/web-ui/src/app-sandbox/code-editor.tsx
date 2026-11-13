'use client';

/**
 * Lightweight code editor for mini-app source. A transparent <textarea> over a
 * syntax-highlighted <pre> (the classic overlay technique) — so you get live
 * highlighting while typing without pulling in a heavy editor (CodeMirror /
 * Monaco). Both layers share identical text metrics so the caret tracks the
 * highlighted glyphs exactly. Theme-aware via the `.code-view` CSS scope.
 *
 * Deliberately simple: no gutter, no autocomplete, no multi-cursor. Editing +
 * Tab-to-indent + the parent's Format/Save is the whole feature. Pass
 * `readOnly` to render the same highlighted surface without the textarea.
 */
import { useDeferredValue, useMemo, type Ref } from 'react';
import { cn } from '../lib/utils';
import { highlightToReact } from './highlight';

// Shared text metrics — MUST match between the highlight layer and the textarea
// or the caret drifts from the glyphs. pre-wrap + break-words keeps long lines
// aligned without a separate horizontal-scroll sync.
const TEXT = 'm-0 whitespace-pre-wrap break-words px-3 py-3 font-mono text-xs leading-relaxed';

export function CodeEditor({
  path,
  value,
  onChange,
  readOnly = false,
  className,
  ariaLabel,
  textareaRef,
}: {
  path: string;
  value: string;
  onChange?: (next: string) => void;
  readOnly?: boolean;
  className?: string;
  /** The text field's name for a screen reader. */
  ariaLabel?: string;
  /** The text field itself, for a caller that puts text at the caret. */
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  // Highlighting a whole file (up to 256 KB) on every key press made typing
  // lag on big files (apps audit P9). The textarea shows the live text; the
  // highlight layer under it follows the deferred value, so React renders the
  // keystroke first and re-highlights when it has a moment.
  const deferred = useDeferredValue(value);
  const highlighted = useMemo(() => highlightToReact(path, deferred), [path, deferred]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Tab' || !onChange) return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: end } = el;
    const next = value.slice(0, s) + '  ' + value.slice(end);
    onChange(next);
    // Restore the caret just after the inserted two spaces (post-render).
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = s + 2;
    });
  }

  return (
    <div className={cn('code-view relative overflow-auto scrollbar-thin bg-card', className)}>
      <pre
        aria-hidden
        className={cn('hljs pointer-events-none min-h-full text-card-foreground', TEXT)}
      >
        <code>
          {highlighted}
          {'\n'}
        </code>
      </pre>
      {!readOnly && (
        <textarea
          ref={textareaRef}
          aria-label={ariaLabel}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="soft"
          className={cn(
            'absolute inset-0 resize-none overflow-hidden border-0 bg-transparent text-transparent caret-foreground outline-none',
            TEXT,
          )}
        />
      )}
    </div>
  );
}
