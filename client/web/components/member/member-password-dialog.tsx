'use client';

import { useState } from 'react';
import { apiUrl, bounceToLogin, withAuth } from '@mantle/web-ui/api-fetch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { Field, FieldError, FieldLabel } from '@mantle/web-ui/ui/field';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { PasswordStrength } from '@/components/auth/password-strength';
import { usePasswordRule } from '@/lib/password-rule';
import {
  PASSWORD_CHANGED,
  passwordOutcome,
  validatePasswordForm,
  type PasswordErrors,
  type PasswordForm,
} from '@/lib/member-password';

const EMPTY: PasswordForm = { current: '', next: '', confirm: '' };
const FIELD_ID: Record<keyof PasswordForm, string> = {
  current: 'member-password-current',
  next: 'member-password-new',
  confirm: 'member-password-confirm',
};

/**
 * A member changes their own password (member logins, Phase 5). Opened from
 * the account menu; the member has no Profile screen, since that screen and
 * its routes are admin-only. The raw fetch is on purpose: a wrong current
 * password answers 401, which `apiFetch` would treat as a dead session
 * (lib/member-password.ts).
 */
export function MemberPasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const rule = usePasswordRule();
  const [form, setForm] = useState<PasswordForm>(EMPTY);
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [pending, setPending] = useState(false);

  const close = (next: boolean) => {
    if (!next) {
      setForm(EMPTY);
      setErrors({});
    }
    onOpenChange(next);
  };

  const focus = (field: keyof PasswordForm) => document.getElementById(FIELD_ID[field])?.focus();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validatePasswordForm(form, rule ?? undefined);
    setErrors(errs);
    const first = (['current', 'next', 'confirm'] as const).find((k) => errs[k]);
    if (first) {
      focus(first);
      return;
    }
    setPending(true);
    try {
      const res = await fetch(
        apiUrl('/api/auth/change-password'),
        withAuth({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ oldPassword: form.current, newPassword: form.next }),
        }),
      );
      const outcome = passwordOutcome(res.status, await res.json().catch(() => null));
      switch (outcome.kind) {
        case 'ok':
          toast.success(PASSWORD_CHANGED);
          close(false);
          break;
        case 'wrong-current':
          setErrors({ current: outcome.message });
          focus('current');
          break;
        case 'signed-out':
          bounceToLogin();
          break;
        case 'error':
          toast.error(outcome.message);
          break;
      }
    } catch {
      toast.error('Could not reach the brain. Try again.');
    } finally {
      setPending(false);
    }
  };

  const field = (key: keyof PasswordForm, label: string, autoComplete: string, meter?: boolean) => {
    const id = FIELD_ID[key];
    const error = errors[key];
    const hint = meter ? `${id}-strength` : null;
    return (
      <Field data-invalid={!!error || undefined}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <SecretInput
          id={id}
          required
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          autoComplete={autoComplete}
          aria-invalid={!!error || undefined}
          aria-describedby={
            [error ? `${id}-error` : null, hint].filter(Boolean).join(' ') || undefined
          }
        />
        {hint ? <PasswordStrength id={hint} password={form[key]} rule={rule} /> : null}
        <FieldError id={`${id}-error`}>{error}</FieldError>
      </Field>
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            You stay signed in here; your other devices are signed out. Use the new password the
            next time you sign in.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-3">
          {field('current', 'Current password', 'current-password')}
          {field('next', 'New password', 'new-password', true)}
          {field('confirm', 'New password again', 'new-password')}
          <div className="flex justify-end pt-1">
            <SubmitButton pending={pending}>Change password</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
