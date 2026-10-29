'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Label } from '@mantle/web-ui/ui/label';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { useToast } from '@mantle/web-ui/ui/toast';
import { cn } from '@mantle/web-ui/lib/utils';
import { PERSON_DESCRIPTION_MAX } from '@/lib/messenger/dto';
import { useViewerLogin } from '@/components/workspaces/use-shell-workspaces';

/**
 * Who I am to the team, on my person card ("Developer", "Project manager",
 * "Jason's wife"). It saves itself (PUT /api/profile/description), apart
 * from the profile form's Save: the card is the team's to read, so every
 * login and agent that may see me reads it, which is how an agent asked to
 * message "the developer" finds who that is. Empty clears it.
 *
 * The save names the login it was written as (`loginId`, from the shell):
 * the brain refuses it for any other (403 `login-mismatch`), so a tab left
 * on one login never writes another's card. The brain keeps one line of
 * visible text (newlines become spaces); the field shows what it kept.
 *
 * Sits inside the profile <form>, so its button is type="button" and Enter
 * in the box makes a new line, never a profile save.
 */
export function ProfileDescriptionControl({ initial }: { initial: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const loginId = useViewerLogin()?.loginId;
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Code points, as the brain counts: an emoji is one.
  const length = Array.from(value.trim()).length;
  const over = length > PERSON_DESCRIPTION_MAX;
  const changed = value.trim() !== saved.trim();

  const save = async () => {
    if (pending || over || !changed || !loginId) return;
    setPending(true);
    setError(null);
    try {
      const res = await apiSend<{ description: string | null }>('/api/profile/description', 'PUT', {
        description: value.trim() || null,
        loginId,
      });
      const next = res.description ?? '';
      setValue(next);
      setSaved(next);
      toast.success(next ? 'Description saved' : 'Description cleared');
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'This brain does not keep a description yet. It comes with its next update.'
          : err instanceof ApiError && err.status === 403
            ? 'This tab is signed in as someone else now. Reload to edit your own description.'
            : err instanceof Error
              ? err.message
              : String(err),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="space-y-2">
      <Label htmlFor="person-description">Description</Label>
      <Textarea
        id="person-description"
        value={value}
        rows={2}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. Developer, Project manager, Jason's wife"
        aria-describedby="person-description-help"
        aria-invalid={over || undefined}
      />
      <div className="flex items-start justify-between gap-3">
        <p id="person-description-help" className="text-xs text-muted-foreground">
          Who you are to the team: a job title, a role or a relationship. It shows on your card next
          to your name and status, and everyone on this brain can read it, agents included, so they
          know whom to message.
        </p>
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            over ? 'text-destructive-ink' : 'text-muted-foreground',
          )}
        >
          {length}/{PERSON_DESCRIPTION_MAX}
        </span>
      </div>
      {error ? <p className="text-xs text-destructive-ink">{error}</p> : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || over || !changed || !loginId}
        onClick={() => void save()}
      >
        {pending ? 'Saving…' : 'Save description'}
      </Button>
    </section>
  );
}
