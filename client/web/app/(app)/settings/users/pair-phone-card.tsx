'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QrCode, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { serverUrl } from '@mantle/web-ui/runtime-env';
import { countdownParts } from '@mantle/client-types/lib/event-time';
import { useNow } from '@/components/use-now';

/** What `POST /api/auth/pair` answers. `url` is the exact QR payload. */
type IssuedCode = { id: string; code: string; url: string; expiresAt: string; ttlSeconds: number };
type PairStatus = { status: 'pending' | 'claimed' | 'expired'; deviceLabel: string | null };

/** How many times an untouched card renews an expired code on its own before
 *  it asks. A tab left open all day must not mint forever. */
const AUTO_RENEWALS = 3;

/**
 * "Sign in on your phone": mint a one-time pairing code and show it as a QR
 * the Jackdaw app scans (`<brain>/pair#v=1&code=…`). The code lives 90 s, is
 * single-use and signs the phone in as THIS login, so the card only shows on
 * your own row. Polls the code until the phone claims it, then says so and
 * refreshes the device list above it. Encoded here in the browser; the code
 * never goes to a third party and never carries a password or a bearer.
 */
export function PairPhoneCard({ userId }: { userId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [claimedAs, setClaimedAs] = useState<string | null>(null);
  const renewals = useRef(0);
  const now = useNow(1000);

  const issue = useCallback(
    async (auto: boolean) => {
      setPending(true);
      try {
        const res = await apiSend<IssuedCode>('/api/auth/pair', 'POST');
        // The server builds the URL from its public origin; a brain that has
        // none configured says localhost, which is no use on a phone — then
        // point at the origin this page talks to.
        const url = /^https?:\/\/localhost(?::\d+)?\//i.test(res.url)
          ? `${serverUrl('/pair')}#v=1&code=${encodeURIComponent(res.code)}`
          : res.url;
        setIssued({ ...res, url });
        setClaimedAs(null);
        if (!auto) renewals.current = 0;
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Could not make a sign-in code.');
      } finally {
        setPending(false);
      }
    },
    [toast],
  );

  // The picture, from the payload, in the browser.
  useEffect(() => {
    if (!issued) {
      setPng(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(issued.url, { errorCorrectionLevel: 'M', margin: 2, width: 240 }).then(
      (data) => {
        if (!cancelled) setPng(data);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [issued]);

  const remaining = issued && now ? countdownParts(issued.expiresAt, now) : null;
  const expired = remaining !== null && remaining.total === 0;

  // Poll while a live code waits for its phone.
  const statusQuery = useQuery({
    queryKey: ['auth', 'pair', issued?.id ?? ''],
    queryFn: () => apiFetch<PairStatus>(`/api/auth/pair/${issued!.id}`),
    enabled: issued !== null && !expired && claimedAs === null,
    refetchInterval: 2000,
  });
  useEffect(() => {
    const s = statusQuery.data;
    if (!s || !issued || claimedAs !== null) return;
    if (s.status === 'claimed') {
      setClaimedAs(s.deviceLabel ?? 'your phone');
      setIssued(null);
      toast.success(`Signed in ${s.deviceLabel ? `“${s.deviceLabel}”` : 'your phone'}.`);
      void queryClient.invalidateQueries({ queryKey: ['users', userId, 'devices'] });
    }
  }, [statusQuery.data, issued, claimedAs, toast, queryClient, userId]);

  // An expired code renews itself a few times while the tab is visible, then
  // waits to be asked.
  useEffect(() => {
    if (!expired || pending || claimedAs !== null) return;
    if (document.visibilityState !== 'visible' || renewals.current >= AUTO_RENEWALS) return;
    renewals.current += 1;
    void issue(true);
  }, [expired, pending, claimedAs, issue]);

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <QrCode className="size-4 text-muted-foreground" /> Sign in on your phone
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Open MantleOS on the phone, tap{' '}
          <span className="text-foreground">Scan a sign-in code</span>, and point it here. No server
          address, email or password to type. The code works once and expires in a minute and a
          half.
        </p>
      </div>

      {claimedAs !== null && (
        <p className="flex items-center gap-2 text-sm text-success-ink">
          <Smartphone className="size-4" /> Signed in “{claimedAs}”. It is listed under Devices.
        </p>
      )}

      {issued && png && !expired ? (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          {/* The PNG carries its own white quiet zone and black modules, so
              it scans on every theme; a data URL has nothing for next/image
              to optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={png}
            alt="Sign-in code for the MantleOS app"
            width={240}
            height={240}
            className="rounded-md"
          />
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Expires in{' '}
              <span className="tabular-nums text-foreground">
                {remaining ? `${remaining.minutes}:${pad(remaining.seconds)}` : '—'}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">Waiting for the phone…</p>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void issue(false)}
            >
              Show a new code
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {issued && expired && <p className="text-sm text-muted-foreground">That code expired.</p>}
          <Button variant="outline" size="sm" disabled={pending} onClick={() => void issue(false)}>
            {pending ? 'Making a code…' : issued || claimedAs ? 'Show a new code' : 'Show a code'}
          </Button>
        </div>
      )}
    </div>
  );
}
