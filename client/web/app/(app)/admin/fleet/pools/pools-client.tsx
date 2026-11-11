'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, SquareStack, Trash2 } from 'lucide-react';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import type { FleetOverview } from '@/lib/fleet';
import { MODEL_ID } from '@/lib/fleet-models';
import { LABEL, MAX_ROUTES, PROVIDER } from '@/lib/fleet-writes';
import { Callout, DetailPane, FleetScreen, SendBar, TargetList } from '../cc-kit';
import { ConfirmSend } from '../fleet-writes';
import { kindLine, useSettingsSend } from '../settings-send';

type PoolDef = { id: string; label: string };
type Route = { provider: string; model: string };

/** A model pool entry on the boxes picked: added at the end of the pool, or
 *  its routes (and vendor) updated, by pool and name. */
function Pools({ data, refresh }: { data: FleetOverview; refresh: () => void }) {
  // The pools this brain knows: the boxes ship the same list (a box a
  // release behind may lack a new one, and answers so).
  const pools = useQuery({
    queryKey: ['model-pools'],
    queryFn: () => apiFetch<{ pools: PoolDef[] }>('/api/model-pools'),
  });
  const list = pools.data?.pools ?? [];
  const [poolId, setPoolId] = useState('');
  const pool = list.find((p) => p.id === poolId) ?? list[0];
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState('');
  const [routes, setRoutes] = useState<Route[]>([{ provider: '', model: '' }]);
  const s = useSettingsSend(data.boxes, refresh);

  const entryName = name.trim();
  const entryVendor = vendor.trim();
  const clean = routes.map((r) => ({
    provider: r.provider.trim().toLowerCase(),
    model: r.model.trim(),
  }));
  const nameOk = LABEL.test(entryName);
  const vendorOk = entryVendor === '' || (entryVendor.length <= 80 && LABEL.test(entryVendor));
  const routesOk = clean.every((r) => PROVIDER.test(r.provider) && MODEL_ID.test(r.model));
  const valid = !!pool && nameOk && vendorOk && routesOk && s.chosen.length > 0;
  const setRoute = (i: number, patch: Partial<Route>) =>
    setRoutes(routes.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const confirm = async () => {
    if (!pool) return;
    const ok = await s.go(
      {
        kind: 'poolEntry',
        pool: pool.id,
        name: entryName,
        ...(entryVendor ? { vendor: entryVendor } : {}),
        routes: clean,
      },
      'Could not send the pool entry.',
    );
    if (ok) {
      setName('');
      setVendor('');
      setRoutes([{ provider: '', model: '' }]);
    }
  };

  return (
    <>
      <MasterDetail
        id="cc-pools"
        list={
          <TargetList
            boxes={data.boxes}
            picked={s.picked}
            setPicked={s.setPicked}
            line={kindLine('poolEntry')}
          />
        }
        detail={
          <DetailPane icon={<SquareStack />} title="Send a pool entry">
            <Callout>
              Each box adds the model at the end of the pool, or updates its routes when the name is
              there. It checks that the routes pass its own model policy and fit the pool.
            </Callout>
            {pools.isLoading ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Spinner size={20} /> Loading…
              </div>
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">This brain lists no pools.</p>
            ) : (
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  if (valid) s.setConfirming(true);
                }}
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="fleet-pool-pool">Pool</FieldLabel>
                    <Select value={pool?.id ?? ''} onValueChange={setPoolId}>
                      <SelectTrigger id="fleet-pool-pool">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {list.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="fleet-pool-name">Name</FieldLabel>
                      <Input
                        id="fleet-pool-name"
                        placeholder="Model name"
                        autoComplete="off"
                        maxLength={120}
                        value={name}
                        aria-invalid={entryName !== '' && !nameOk}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="fleet-pool-vendor">Vendor (optional)</FieldLabel>
                      <Input
                        id="fleet-pool-vendor"
                        autoComplete="off"
                        maxLength={80}
                        value={vendor}
                        aria-invalid={!vendorOk}
                        onChange={(e) => setVendor(e.target.value)}
                      />
                    </Field>
                  </div>
                  <FieldDescription>
                    The name in the pool. An entry with this name is updated.
                  </FieldDescription>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">Routes</legend>
                    {routes.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {i + 1}
                        </span>
                        <Input
                          id={`fleet-pool-provider-${i}`}
                          aria-label={`Route ${i + 1} provider`}
                          className="w-40 font-mono"
                          placeholder="provider"
                          autoComplete="off"
                          spellCheck={false}
                          maxLength={64}
                          value={r.provider}
                          onChange={(e) => setRoute(i, { provider: e.target.value })}
                        />
                        <Input
                          id={`fleet-pool-model-${i}`}
                          aria-label={`Route ${i + 1} model`}
                          className="font-mono"
                          placeholder="vendor/model-name"
                          autoComplete="off"
                          spellCheck={false}
                          maxLength={200}
                          value={r.model}
                          onChange={(e) => setRoute(i, { model: e.target.value })}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove route ${i + 1}`}
                          className="text-muted-foreground hover:text-destructive-ink"
                          disabled={routes.length === 1}
                          onClick={() => setRoutes(routes.filter((_, j) => j !== i))}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {routesOk
                          ? `1 to ${MAX_ROUTES} routes, in the order to try them.`
                          : 'Each route needs a provider id and a model id, with no space.'}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={routes.length >= MAX_ROUTES}
                        onClick={() => setRoutes([...routes, { provider: '', model: '' }])}
                      >
                        <Plus /> Add route
                      </Button>
                    </div>
                  </fieldset>
                  <SendBar count={s.chosen.length}>
                    <SubmitButton pending={false} disabled={!valid}>
                      {s.chosen.length > 0 ? `Send pool entry to ${s.count}` : 'Send pool entry'}
                    </SubmitButton>
                  </SendBar>
                </FieldGroup>
              </form>
            )}
          </DetailPane>
        }
      />
      <ConfirmSend
        open={s.confirming}
        pending={s.pending}
        title={`Set ${entryName} in ${pool?.label ?? ''} on ${s.count}?`}
        action="Send pool entry"
        onCancel={() => s.setConfirming(false)}
        onConfirm={() => void confirm()}
      >
        Each box adds the entry at the end of the pool, or updates its routes when the name is
        there. A box whose model policy refuses a route changes nothing.
      </ConfirmSend>
    </>
  );
}

export function PoolsClient() {
  return (
    <FleetScreen needs="writes">
      {(data, refresh) => <Pools data={data} refresh={refresh} />}
    </FleetScreen>
  );
}
