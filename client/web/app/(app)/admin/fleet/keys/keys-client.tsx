'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { SUPPORTED_PROVIDERS } from '@mantle/voice-client';
import { FLEET_KEYS_PATH, fleetKeyProviders, keyBoxText, type FleetOverview } from '@/lib/fleet';
import { Callout, DetailPane, FleetScreen, SendBar, TargetList, useBoxPick } from '../cc-kit';
import { refusalText } from '../fleet-section';
import { ConfirmSend } from '../fleet-writes';

const KEY_PROVIDERS = fleetKeyProviders(SUPPORTED_PROVIDERS);
const providerLabel = (service: string) =>
  KEY_PROVIDERS.find((p) => p.id === service)?.label ?? service;

/**
 * Set one provider key on one or many boxes. The key is typed once, sent once
 * and never shown: the field empties when it is sent, and the Control Center
 * keeps no key. Each box seals it in its own vault and tests it. A box whose
 * test fails keeps the key it had. Each card on the left says what that box
 * answered to the last key: never the key.
 */
function Keys({ data, refresh }: { data: FleetOverview; refresh: () => void }) {
  const toast = useToast();
  const [service, setService] = useState(KEY_PROVIDERS[0]?.id ?? '');
  const [value, setValue] = useState('');
  // Bumped by a send: the next key starts hidden again.
  const [fieldKey, setFieldKey] = useState(0);
  const { picked, setPicked, chosen, count } = useBoxPick(data.boxes);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const send = async () => {
    setPending(true);
    try {
      await apiSend(FLEET_KEYS_PATH, 'POST', {
        service,
        value,
        boxIds: chosen.map((b) => b.id),
      });
      setValue('');
      setFieldKey((k) => k + 1);
      setConfirming(false);
      toast.success(`Key sent to ${count}. Each box tests it now.`);
      refresh();
    } catch (err) {
      toast.error(refusalText(err, 'Could not send the key.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <MasterDetail
        id="cc-keys"
        list={
          <TargetList
            boxes={data.boxes}
            picked={picked}
            setPicked={setPicked}
            line={(b) => {
              const said = keyBoxText(b);
              const of = b.keyPending ?? b.keyResult;
              if (!said || !of) return null;
              return { tone: said.tone, text: `${providerLabel(of.service)} key: ${said.text}` };
            }}
          />
        }
        detail={
          <DetailPane icon={<KeyRound />} title="Set a provider key">
            <Callout>
              Each box seals the key in its own vault and tests it. A box whose test fails keeps the
              key it had. This box keeps no key.
            </Callout>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (value.trim() && chosen.length > 0) setConfirming(true);
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="fleet-key-provider">Provider</FieldLabel>
                  <Select value={service} onValueChange={setService}>
                    <SelectTrigger id="fleet-key-provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KEY_PROVIDERS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="fleet-key-value">Key</FieldLabel>
                  <SecretInput
                    id="fleet-key-value"
                    noun="key"
                    // Not `off`: a browser may fill the Admin's own password here.
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    data-bwignore
                    key={fieldKey}
                    value={value}
                    maxLength={8192}
                    onChange={(e) => setValue(e.target.value)}
                  />
                  <FieldDescription>
                    Typed once. It is never shown again, here or on a box.
                  </FieldDescription>
                </Field>
                <SendBar count={chosen.length}>
                  <SubmitButton pending={false} disabled={!value.trim() || chosen.length === 0}>
                    {chosen.length > 0 ? `Set key on ${count}` : 'Set key'}
                  </SubmitButton>
                </SendBar>
              </FieldGroup>
            </form>
          </DetailPane>
        }
      />
      <ConfirmSend
        open={confirming}
        pending={pending}
        title={`Set the ${providerLabel(service)} key on ${count}?`}
        action="Set key"
        onCancel={() => setConfirming(false)}
        onConfirm={() => void send()}
      >
        Each box replaces its {providerLabel(service)} key with this one and tests it. A box whose
        test fails keeps the key it had.
      </ConfirmSend>
    </>
  );
}

export function KeysClient() {
  return (
    <FleetScreen needs="keys">
      {(data, refresh) => <Keys data={data} refresh={refresh} />}
    </FleetScreen>
  );
}
