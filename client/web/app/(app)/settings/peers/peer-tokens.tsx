'use client';

/**
 * The two tokens of a link, one per direction, each with what it is, where
 * it comes from and where it goes:
 *
 *  - YOUR token for them (inbound): this brain mints it; they paste it on
 *    their side so their brain can call this one. Kept only as a hash, so it
 *    is shown once: when the peer is added, or when you make a new one
 *    (POST /api/peers/:id/rotate, which stops the old one at once).
 *  - THEIR token for you (outbound): their brain mints it when they add this
 *    brain; you paste it here (PATCH outboundToken) so this brain can call
 *    theirs. A link waiting for it turns active when it is saved.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, Copy, KeyRound, RefreshCw } from 'lucide-react';
import { apiSend, ApiError, apiUrl } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { CopyButton } from '@mantle/web-ui/ui/copy-button';
import { Field, FieldDescription, FieldLabel } from '@mantle/web-ui/ui/field';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mantle/web-ui/ui/alert-dialog';
import { useToast } from '@mantle/web-ui/ui/toast';
import { copyText } from '@mantle/web-ui/lib/secure-context-fallbacks';
import { PeerSection } from './peer-section';
import { play } from '@/lib/sounds/play';

/** A token to show once. `replaced`: it took the place of one that now fails.
 *  `at`: where it shows, next to what made it: the Pairing tokens section (a
 *  new link, a new token) or the tools column (binding the peer to Owner). The
 *  screen keeps one per peer, so it shows only under the peer it belongs to. */
export type Reveal = { token: string; replaced: boolean; at: 'tokens' | 'access' };

/** The address the other brain enters for this one: the API's origin (the
 *  brain itself in detached and desktop mode, this page's origin when the
 *  client is served by the brain). */
export function thisBrainAddress(): string {
  if (typeof window === 'undefined') return '';
  try {
    return new URL(apiUrl('/'), window.location.href).origin;
  } catch {
    return window.location.origin;
  }
}

/** This brain's own address, with a copy button: what the other side types
 *  into its Address field. */
export function ThisBrainAddress() {
  // Read after mount: the server render has no window, and the two renders
  // must agree.
  const [address, setAddress] = useState('');
  useEffect(() => setAddress(thisBrainAddress()), []);
  if (!address) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">This brain&apos;s address</span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{address}</code>
      <CopyButton value={address} ariaLabel="Copy this brain's address" />
    </div>
  );
}

/** Reveal-once box for a freshly minted token for them. It scrolls itself
 *  into view and takes focus when it appears, so a token made by a control
 *  lower down is not left out of sight. */
export function TokenReveal({
  token,
  replaced,
  peerName,
  onDone,
}: {
  token: string;
  replaced: boolean;
  peerName: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    box.current?.focus({ preventScroll: true });
  }, [token]);
  const copy = async () => {
    await copyText(token);
    setCopied(true);
    toast.success('Token copied');
  };
  return (
    // A region, not a live region: a screen reader must not read the token aloud.
    <div
      ref={box}
      role="region"
      aria-label={`New token for ${peerName}`}
      tabIndex={-1}
      className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="text-sm font-medium">Copy it now: it is shown only this once</p>
      <p className="text-xs text-muted-foreground">
        Send it to {peerName}&apos;s owner by a private channel. This brain keeps only a hash, so if
        it is lost you make a new one.
      </p>
      {replaced ? (
        <p className="text-xs font-medium text-warning-ink">
          The old token no longer works. {peerName} needs this new one.
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs">
          {token}
        </code>
        <Button type="button" size="sm" variant="outline" onClick={copy} aria-label="Copy token">
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <Button type="button" size="sm" onClick={onDone}>
        I&apos;ve copied it
      </Button>
    </div>
  );
}

export function PeerTokens({
  peer,
  reveal,
  onClearReveal,
  onRevealNew,
  onSaved,
}: {
  peer: { id: string; displayName: string; status: string; hasOutboundToken: boolean };
  reveal: Reveal | null;
  onClearReveal: () => void;
  onRevealNew: (token: string) => void;
  /** Their token is saved: a waiting link becomes active. */
  onSaved: () => void;
}) {
  const toast = useToast();
  const name = peer.displayName;
  const [theirs, setTheirs] = useState('');
  const [saving, setSaving] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);

  const rotate = async () => {
    setRotateOpen(false);
    try {
      const { inboundToken } = await apiSend<{ inboundToken: string }>(
        `/api/peers/${peer.id}/rotate`,
        'POST',
      );
      onRevealNew(inboundToken);
      toast.success('New token for them made');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not make a new token');
    }
  };

  const saveTheirs = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = theirs.trim();
    if (!token) return;
    setSaving(true);
    try {
      await apiSend(`/api/peers/${peer.id}`, 'PATCH', { outboundToken: token });
      setTheirs('');
      onSaved();
      play('success');
      toast.success(
        peer.hasOutboundToken ? 'Their token replaced' : `Linked: this brain can now call ${name}`,
      );
    } catch (err) {
      play('danger');
      toast.error(err instanceof ApiError ? err.message : 'Could not save their token');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PeerSection
      id={`peer-tokens-${peer.id}`}
      icon={KeyRound}
      title="Pairing tokens"
      description="A link has two tokens, one for each direction. Each brain makes the token the other one uses to call it, so you swap them once."
    >
      <div className="grid gap-4 @xl:grid-cols-2">
        {/* Ours: they call us with it. */}
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="inline-flex items-center gap-1.5 text-sm font-medium">
            <ArrowDownLeft className="size-4 text-muted-foreground" aria-hidden />
            Your token for {name}
          </p>
          <p className="text-xs text-muted-foreground">
            Made by this brain. {name} uses it to call this brain. Their owner pastes it on their
            brain: Settings, Peers, open this brain, <em>Their token</em>.
          </p>
          <p className="text-xs text-muted-foreground">
            It was shown once, when you added {name}. Lost it? Make a new one: the old one stops
            working at once.
          </p>
          <div className="mt-auto pt-1">
            <Button type="button" size="sm" variant="outline" onClick={() => setRotateOpen(true)}>
              <RefreshCw /> New token for {name}
            </Button>
          </div>
        </div>

        {/* Theirs: we call them with it. */}
        <form
          onSubmit={saveTheirs}
          noValidate
          className="flex flex-col gap-2 rounded-md border border-border p-3"
        >
          <p className="inline-flex items-center gap-1.5 text-sm font-medium">
            <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden />
            Their token for you
            {peer.hasOutboundToken ? (
              <span className="ml-auto text-xs font-normal text-success-ink">saved</span>
            ) : (
              <span className="ml-auto text-xs font-normal text-warning-ink">missing</span>
            )}
          </p>
          <Field>
            <FieldLabel htmlFor={`peer-theirs-${peer.id}`} className="sr-only">
              Their token
            </FieldLabel>
            <SecretInput
              id={`peer-theirs-${peer.id}`}
              noun="token"
              autoComplete="off"
              value={theirs}
              onChange={(e) => setTheirs(e.target.value)}
              placeholder={peer.hasOutboundToken ? 'Paste a new one to replace it' : 'mtlpeer_…'}
              aria-describedby={`peer-theirs-hint-${peer.id}`}
            />
            <FieldDescription id={`peer-theirs-hint-${peer.id}`}>
              Made by {name}: their owner adds this brain on their Peers screen (with this
              brain&apos;s address) and gets a token shown once. Paste it here; it is sealed, and
              this brain can then call {name}.
            </FieldDescription>
          </Field>
          <div className="mt-auto flex justify-end">
            <SubmitButton size="sm" pending={saving} disabled={!theirs.trim()}>
              Save their token
            </SubmitButton>
          </div>
        </form>
      </div>

      {reveal ? (
        <div className="mt-4">
          <TokenReveal
            token={reveal.token}
            replaced={reveal.replaced}
            peerName={name}
            onDone={onClearReveal}
          />
        </div>
      ) : null}

      <AlertDialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make a new token for {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The token {name} has now stops working at once. Until their owner pastes the new one,{' '}
              {name} cannot call this brain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={rotate}>Make new token</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PeerSection>
  );
}
