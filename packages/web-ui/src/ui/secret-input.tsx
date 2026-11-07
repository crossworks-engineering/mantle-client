'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils';
import { Input, type InputProps } from './input';
import { RowButton } from './row-button';

/**
 * An `Input` for a value that should not sit on screen while it is typed: a
 * password, an app password, an API key, a client secret, a token.
 *
 * Masked by default, with an eye button inside the right edge that flips it to
 * plain text and back. Two forms had hand-rolled this identically and every
 * other secret field had gone without, so this is the one implementation: a new
 * secret field gets the toggle by using this instead of `Input`.
 *
 * - **It owns the shown/hidden state.** No caller has ever needed to read it,
 *   and a field that starts revealed is the thing this exists to prevent.
 * - **Every `Input` prop and the ref pass through to the input**, so it drops
 *   into a `Field` unchanged: `id`, `aria-invalid`, `aria-describedby`, `size`.
 *   `type` is the one prop it takes away, because it is the one it drives.
 * - **`className` styles the input; `wrapperClassName` styles the box around
 *   it.** The wrapper is `w-full` like `Input` itself. A field that is sized by
 *   its row (`w-1/3`, `flex-1`) says so on the wrapper.
 * - **`noun` names the thing in the button's label**: "Show password" by
 *   default, "Show secret", "Show key". The label is what a screen reader
 *   announces, so it should say what is about to appear.
 * - **`autoComplete` is the caller's.** The sign-in form leaves it alone so a
 *   password manager still fills it; a key or secret field passes `off`.
 *
 * The button is a `RowButton`, so it is `type="button"` and cannot submit the
 * form it sits in, and it draws the kit's focus ring. It stays in the tab order
 * on purpose: a keyboard user needs to check what they typed as much as anyone.
 */
export interface SecretInputProps extends Omit<InputProps, 'type'> {
  /** What the value is, for the toggle's label: "Show {noun}" / "Hide {noun}". */
  noun?: string;
  /** Classes for the wrapper that positions the toggle. `className` goes to the input. */
  wrapperClassName?: string;
}

export const SecretInput = React.forwardRef<HTMLInputElement, SecretInputProps>(
  ({ className, wrapperClassName, noun = 'password', disabled, ...props }, ref) => {
    const [shown, setShown] = React.useState(false);
    return (
      // data-secret: an agent driving the window never reads or types in it,
      // shown or not (client lib/agent-ui).
      <div data-secret="" className={cn('relative w-full', wrapperClassName)}>
        <Input
          ref={ref}
          type={shown ? 'text' : 'password'}
          disabled={disabled}
          className={cn('pr-9', className)}
          {...props}
        />
        <RowButton
          onClick={() => setShown((v) => !v)}
          disabled={disabled}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground"
          aria-label={shown ? `Hide ${noun}` : `Show ${noun}`}
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </RowButton>
      </div>
    );
  },
);
SecretInput.displayName = 'SecretInput';
