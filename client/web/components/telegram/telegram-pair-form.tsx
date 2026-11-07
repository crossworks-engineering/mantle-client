'use client';

/**
 * Pair Telegram (workspaces W7d): the signed-in user pairs THEIR OWN
 * Telegram chat with the code the bot sent them, in two steps. First the
 * code is looked up (POST /api/telegram/pair `{ code }`): nothing is paired,
 * and the user sees which chat, which bot and which assistant it would be.
 * Then Confirm pairs exactly that chat (`{ code, confirm: true,
 * previewToken }`, always with the preview's token). A stale preview (the
 * code expired, or names another chat now) goes back to the code, with the
 * brain's words. Shown on Settings > Telegram and on an assistant's bot
 * section, the same form both places.
 */

import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { FieldError } from '@mantle/web-ui/ui/field';
import { useToast } from '@mantle/web-ui/ui/toast';
import { apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import type { TelegramPairPreview, TelegramPairResult } from '@/lib/contract/telegram';
import {
  TELEGRAM_PAIR_PATH,
  normalisePairCode,
  pairConfirmBody,
  pairPreviewBody,
  pairRefusal,
} from '@/lib/telegram-pairing';

const CODE_ERROR_ID = 'telegram-pair-code-error';
const CONFIRM_ERROR_ID = 'telegram-pair-confirm-error';

export function TelegramPairForm({ onPaired }: { onPaired?: () => void }) {
  const toast = useToast();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ code: string; data: TelegramPairPreview } | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const refused = (e: unknown, at: 'code' | 'confirm') => {
    if (e instanceof ApiError && e.status === 401) return; // already bounced to sign in
    const r = pairRefusal(e);
    if (!r) {
      toast.error(e instanceof Error ? e.message : 'Could not pair this chat.');
      return;
    }
    if (at === 'confirm' && r.restart) {
      setPreview(null);
      setCodeError(r.message);
      return;
    }
    (at === 'code' ? setCodeError : setConfirmError)(r.message);
  };

  const lookUp = async () => {
    const code = normalisePairCode(input);
    setCodeError(null);
    setConfirmError(null);
    if (!code) {
      setCodeError('A pairing code is six letters and digits, like 3fa9c2.');
      return;
    }
    setBusy(true);
    try {
      const data = await apiSend<TelegramPairPreview>(
        TELEGRAM_PAIR_PATH,
        'POST',
        pairPreviewBody(code),
      );
      setPreview({ code, data });
    } catch (e) {
      refused(e, 'code');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setConfirmError(null);
    try {
      const r = await apiSend<TelegramPairResult>(
        TELEGRAM_PAIR_PATH,
        'POST',
        pairConfirmBody(preview.code, preview.data.previewToken),
      );
      toast.success(r.already ? 'This chat was already paired to you.' : 'Telegram chat paired.');
      setPreview(null);
      setInput('');
      onPaired?.();
    } catch (e) {
      refused(e, 'confirm');
    } finally {
      setBusy(false);
    }
  };

  if (preview) {
    const p = preview.data;
    const title = typeof p.chat.title === 'string' ? p.chat.title.trim() : '';
    return (
      <div className="space-y-3">
        <dl
          className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-sm"
          data-testid="telegram-pair-preview"
        >
          <dt className="text-muted-foreground">Chat</dt>
          <dd className="min-w-0 break-words">
            <span className="font-medium">{p.chat.label}</span>
            {title && title !== p.chat.label ? (
              <span className="text-muted-foreground"> ({title})</span>
            ) : null}
          </dd>
          <dt className="text-muted-foreground">Bot</dt>
          <dd className="min-w-0 break-words">{p.bot.name}</dd>
          <dt className="text-muted-foreground">Assistant</dt>
          <dd className="min-w-0 break-words">{p.agentName ?? 'None named'}</dd>
        </dl>
        <p className="text-sm text-muted-foreground">
          {p.already
            ? 'This chat is already paired to you.'
            : 'Is this your chat? Confirm pairs it to you.'}
        </p>
        <FieldError id={CONFIRM_ERROR_ID}>{confirmError}</FieldError>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            data-agent-risk="person"
            onClick={confirm}
            disabled={busy}
            aria-describedby={confirmError ? CONFIRM_ERROR_ID : undefined}
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Confirm
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setPreview(null);
              setConfirmError(null);
            }}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Send the bot a message on Telegram. It answers with a pairing code. Enter it here to pair
        that chat to you.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void lookUp();
            }
          }}
          placeholder="Pairing code"
          aria-label="Pairing code"
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
          className="h-9 w-40 font-mono text-sm"
          aria-invalid={codeError ? true : undefined}
          aria-describedby={codeError ? CODE_ERROR_ID : undefined}
        />
        <Button type="button" size="sm" onClick={lookUp} disabled={busy || !input.trim()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          Pair Telegram
        </Button>
      </div>
      <FieldError id={CODE_ERROR_ID}>{codeError}</FieldError>
    </div>
  );
}
