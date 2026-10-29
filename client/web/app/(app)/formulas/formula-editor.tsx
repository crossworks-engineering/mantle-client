'use client';

/**
 * The formula editor: a guided form and a YAML source view over one draft.
 *
 * Two things make this different from an ordinary settings form.
 *
 * 1. THE VALIDATION RAIL IS LIVE AND COMPLETE. `parseFormulaSpec`,
 *    `checkLookupCoverage` and `checkDimensions` are pure and dependency-free
 *    precisely so they can run in the browser on every keystroke — the same
 *    functions the server will run on save, not a reimplementation that can
 *    drift. And they report EVERY problem at once: these specs are transcribed
 *    from printed standards by hand, and a reviewer wants the whole list, not
 *    the first line.
 * 2. YAML IS A FIRST-CLASS VIEW, not an export. Criteria prose and
 *    transcription notes are multi-line English, which JSON turns into
 *    unreadable escaped strings, so YAML is how these are actually authored.
 *    The form and the source round-trip through one draft object; the parser
 *    lives here in `client/web` so `@mantle/content` stays parser-free.
 *
 * The three findings are shown separately because they mean different things.
 * A parse error is a malformed spec. A coverage gap is a fact about the SOURCE
 * — an incomplete printed table — and is not the author's to fix. A dimension
 * issue means the arithmetic disagrees with a declared unit, which is usually a
 * dropped term and always worth stopping for.
 */

import { HeaderPill, ItemHeader } from '@/components/layout/item-header';
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
import YAML from 'yaml';
import { AlertTriangle, Check, Plus, Sigma, Trash2 } from 'lucide-react';
import {
  checkLookupCoverage,
  parseFormulaSpec,
  type CoverageGap,
  type FormulaSpec,
} from '@mantle/content-core/formula-spec';
import { checkDimensions, type DimensionIssue } from '@mantle/content-core/formula-dimensions';
import { Badge } from '@mantle/web-ui/ui/badge';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@mantle/web-ui/ui/field';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { Switch } from '@mantle/web-ui/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Tabs, TabsList, TabsTrigger } from '@mantle/web-ui/ui/tabs';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ApiError, apiSend } from '@mantle/web-ui/api-fetch';
import {
  arr,
  listOf,
  normalised,
  obj,
  scalar,
  text,
  toSpec,
  type Draft,
  type Row,
} from './formula-draft';
import { play } from '@/lib/sounds/play';

export type { Draft } from './formula-draft';

const ROLES = ['input', 'constant', 'derived', 'output'] as const;

// ─── small building blocks ─────────────────────────────────────────────────

/**
 * One labelled control, on the §6a `Field` family.
 *
 * The children are a RENDER PROP rather than plain nodes so the wrapper can
 * mint the id and hand it to the control: before this, every label in the
 * editor was a bare `<Label>` with no `htmlFor` and nothing nested inside it,
 * so roughly forty labels pointed at no control at all. Clicking one did
 * nothing and a screen reader announced the box unnamed. Spreading `f` is what
 * ties the two together, and carries the description's id along with it.
 */
function SpecField({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: (f: { id: string; 'aria-describedby'?: string }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children({ id, 'aria-describedby': hintId })}
      {hint ? <FieldDescription id={hintId}>{hint}</FieldDescription> : null}
    </Field>
  );
}

/** A caption over a group of controls. NOT a `<Label>`: it names a table or a
 *  set of boxes rather than one control, and a label with no control is worse
 *  than no label. */
function GroupCaption({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-medium text-foreground">{children}</p>;
}

function Card({
  title,
  onRemove,
  removeLabel,
  children,
}: {
  title: string;
  onRemove: () => void;
  /** Names WHAT is being removed, since the button carries no text (§8). */
  removeLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-xs font-medium text-foreground">
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:text-destructive-ink"
          onClick={onRemove}
          aria-label={removeLabel}
        >
          <Trash2 />
        </Button>
      </div>
      <FieldGroup>{children}</FieldGroup>
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Plus />
      {label}
    </Button>
  );
}

function EditorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

// ─── the editor ────────────────────────────────────────────────────────────

export function FormulaEditor({
  formulaId,
  initialSpec,
  initialTitle,
  initialTags,
  onSaved,
  onCancel,
}: {
  /** Absent when creating. */
  formulaId?: string;
  initialSpec: Draft;
  initialTitle: string;
  initialTags: string[];
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'form' | 'source'>('form');
  const [draft, setDraft] = useState<Draft>(() => normalised(initialSpec));
  const [title, setTitle] = useState(initialTitle);
  const [tagsText, setTagsText] = useState(initialTags.join(', '));
  const [yamlText, setYamlText] = useState('');
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  // Entering the source view re-serialises from the draft, so the text always
  // reflects what the form holds. Leaving it keeps whatever last parsed.
  useEffect(() => {
    if (mode === 'source') {
      setYamlText(YAML.stringify(toSpec(draft)));
      setYamlError(null);
    }
    // Only on the switch — re-serialising while typing would fight the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function switchMode(next: 'form' | 'source') {
    // Leaving the source view with YAML that never parsed would silently
    // regenerate from the last VALID draft — the broken text (and whatever
    // edits it carried) would be gone without a word. Say so instead.
    if (mode === 'source' && next === 'form' && yamlError) {
      toast.error('The YAML did not parse — the form shows the last valid state.');
    }
    setMode(next);
  }

  function onYamlChange(next: string) {
    setYamlText(next);
    try {
      const parsed = YAML.parse(next);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setDraft(normalised(parsed as Draft));
        setYamlError(null);
      } else {
        setYamlError('The document must be a mapping of spec fields.');
      }
    } catch (err) {
      setYamlError(err instanceof Error ? err.message : 'could not parse YAML');
    }
  }

  const patch = useCallback((next: Partial<Draft>) => {
    setDraft((prev) => ({ ...prev, ...next }));
  }, []);

  /** Replace one entry of one of the spec's arrays. */
  const patchAt = useCallback((key: string, index: number, next: Row) => {
    setDraft((prev) => {
      const list = Array.isArray(prev[key]) ? [...(prev[key] as Row[])] : [];
      list[index] = next;
      return { ...prev, [key]: list };
    });
  }, []);

  const addTo = useCallback((key: string, entry: Row) => {
    setDraft((prev) => ({
      ...prev,
      [key]: [...(Array.isArray(prev[key]) ? (prev[key] as Row[]) : []), entry],
    }));
  }, []);

  const removeAt = useCallback((key: string, index: number) => {
    setDraft((prev) => ({
      ...prev,
      [key]: (Array.isArray(prev[key]) ? (prev[key] as Row[]) : []).filter((_, i) => i !== index),
    }));
  }, []);

  // The rail. Runs the SAME validators the server runs on save. Deferred so a
  // keystroke never waits on the mathjs dimension pass — on an API-581-sized
  // spec that pass is the difference between typing and wading.
  const deferredDraft = useDeferredValue(draft);
  const findings = useMemo(() => {
    const parsed = parseFormulaSpec(toSpec(deferredDraft));
    if (!parsed.ok) {
      return { errors: parsed.errors, coverage: [] as CoverageGap[], dims: [] as DimensionIssue[] };
    }
    const spec: FormulaSpec = parsed.spec;
    // Dimension checking is best-effort: a unit mathjs cannot read must not
    // block saving an otherwise valid spec.
    let dims: DimensionIssue[];
    try {
      dims = checkDimensions(spec);
    } catch {
      dims = [];
    }
    return { errors: [] as string[], coverage: checkLookupCoverage(spec), dims };
  }, [deferredDraft]);

  const valid = findings.errors.length === 0 && !yamlError;

  async function save() {
    if (!valid) return;
    setSaving(true);
    setServerErrors([]);
    try {
      const spec = toSpec(draft);
      // Title always sent: '' means "reset to the spec's name" server-side
      // (updateFormula falls back when the spec changes), where undefined
      // silently kept the old one after the author cleared the field.
      const body = { spec, title: title.trim(), tags: listOf(tagsText) };
      const saved = formulaId
        ? await apiSend<{ formula: { id: string } }>(
            `/api/formulas/${formulaId}`,
            'PATCH',
            body,
          ).then((r) => r.formula)
        : await apiSend<{ id: string }>('/api/formulas', 'POST', body);
      play('success');
      toast.success(formulaId ? 'Formula updated' : 'Formula created');
      onSaved(saved.id);
    } catch (err) {
      // The server validates all-at-once too; show its list the same way the
      // rail shows the local one rather than collapsing it to a toast line.
      play('danger');
      const list = err instanceof ApiError ? err.body?.errors : undefined;
      if (Array.isArray(list)) setServerErrors(list.map(String));
      else toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const variables = arr(draft, 'variables');
  const expressions = arr(draft, 'expressions');
  const piecewise = arr(draft, 'piecewise');
  const lookups = arr(draft, 'lookups');
  const classifications = arr(draft, 'classifications');
  const source = obj(draft.source);
  const notes = obj(draft.notes);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The item header (contract 2026-10-21): the same one row as the
          formula's read view, in edit mode. Whether the spec validates is the
          pill; Save the one word button; the pressed pencil leaves editing
          (Cancel). Form / YAML is the editor's own switch, so it opens the
          content, not the header. */}
      <ItemHeader
        section="Formulas"
        visual={<Sigma className="size-4" aria-hidden />}
        title={title || (formulaId ? 'Untitled formula' : 'New formula')}
        badges={
          // `findings` is computed from the last draft that PARSED, so while
          // the YAML is broken it reports zero problems. Name the real blocker.
          <HeaderPill>
            {valid
              ? 'valid'
              : yamlError
                ? 'YAML does not parse'
                : `${findings.errors.length} to fix`}
          </HeaderPill>
        }
        textActions={
          <SubmitButton pending={saving} onClick={save} disabled={!valid} size="sm">
            <Check />
            {formulaId ? 'Save formula' : 'Create formula'}
          </SubmitButton>
        }
        edit={{
          onSelect: onCancel,
          pressed: true,
          label: formulaId ? 'Done editing: discard unsaved' : 'Cancel the new formula',
        }}
        infoLabel="About this formula"
      />

      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_320px]">
        {/* ── editing surface ─────────────────────────────────────────── */}
        <div className="min-h-0 space-y-6 overflow-y-auto scrollbar-thin px-6 py-5">
          <Tabs value={mode} onValueChange={(v) => switchMode(v as 'form' | 'source')}>
            <TabsList>
              <TabsTrigger value="form">Form</TabsTrigger>
              <TabsTrigger value="source">YAML</TabsTrigger>
            </TabsList>
          </Tabs>
          {mode === 'source' ? (
            // §6b: the parse failure was a loose red `<p>` — visible, but never
            // announced, and it left the box itself looking fine. All three
            // marks now: `data-invalid` on the Field, `aria-invalid` on the
            // Textarea, `role="alert"` (from FieldError) on the message.
            <Field data-invalid={Boolean(yamlError) || undefined}>
              <FieldLabel htmlFor="formula-yaml">Spec source</FieldLabel>
              <Textarea
                id="formula-yaml"
                value={yamlText}
                onChange={(e) => onYamlChange(e.target.value)}
                spellCheck={false}
                aria-invalid={Boolean(yamlError) || undefined}
                aria-describedby={yamlError ? 'formula-yaml-error' : 'formula-yaml-description'}
                className="min-h-[60vh] font-mono text-xs"
              />
              <FieldError id="formula-yaml-error">{yamlError}</FieldError>
              {yamlError ? null : (
                <FieldDescription id="formula-yaml-description">
                  Edits parse straight into the form. Comments are yours to keep here, but are not
                  stored with the spec.
                </FieldDescription>
              )}
            </Field>
          ) : (
            <>
              <EditorSection title="Identity">
                <div className="grid gap-4 sm:grid-cols-2">
                  <SpecField label="Spec id" hint="Durable slug, e.g. api581-release-quantity.">
                    {(f) => (
                      <Input
                        {...f}
                        value={text(draft.id)}
                        onChange={(e) => patch({ id: e.target.value })}
                        className="font-mono text-xs"
                      />
                    )}
                  </SpecField>
                  <SpecField label="Name">
                    {(f) => (
                      <Input
                        {...f}
                        value={text(draft.name)}
                        onChange={(e) => patch({ name: e.target.value })}
                      />
                    )}
                  </SpecField>
                  <SpecField label="Display title" hint="Defaults to the name.">
                    {(f) => (
                      <Input {...f} value={title} onChange={(e) => setTitle(e.target.value)} />
                    )}
                  </SpecField>
                  <SpecField label="Tags" hint="Comma separated.">
                    {(f) => (
                      <Input
                        {...f}
                        value={tagsText}
                        onChange={(e) => setTagsText(e.target.value)}
                      />
                    )}
                  </SpecField>
                  <SpecField label="Unit system" hint="e.g. SI, USC.">
                    {(f) => (
                      <Input
                        {...f}
                        value={text(draft.unitSystem)}
                        onChange={(e) => patch({ unitSystem: e.target.value })}
                      />
                    )}
                  </SpecField>
                </div>
              </EditorSection>

              <EditorSection title="Source & citation">
                <div className="grid gap-4 sm:grid-cols-2">
                  <SpecField label="Standard">
                    {(f) => (
                      <Input
                        {...f}
                        value={text(source.standard)}
                        onChange={(e) => patch({ source: { ...source, standard: e.target.value } })}
                      />
                    )}
                  </SpecField>
                  <SpecField label="Part">
                    {(f) => (
                      <Input
                        {...f}
                        value={text(source.part)}
                        onChange={(e) => patch({ source: { ...source, part: e.target.value } })}
                      />
                    )}
                  </SpecField>
                  <SpecField
                    label="Edition"
                    hint="Equation numbers move between editions — a numbered citation to an editionless standard is not a citation."
                  >
                    {(f) => (
                      <Input
                        {...f}
                        value={text(source.edition)}
                        onChange={(e) => patch({ source: { ...source, edition: e.target.value } })}
                      />
                    )}
                  </SpecField>
                  <SpecField label="Sections" hint="Comma separated.">
                    {(f) => (
                      <Input
                        {...f}
                        value={(Array.isArray(source.sections) ? source.sections : []).join(', ')}
                        onChange={(e) =>
                          patch({ source: { ...source, sections: listOf(e.target.value) } })
                        }
                      />
                    )}
                  </SpecField>
                  <SpecField label="Tables" hint="Comma separated.">
                    {(f) => (
                      <Input
                        {...f}
                        value={(Array.isArray(source.tables) ? source.tables : []).join(', ')}
                        onChange={(e) =>
                          patch({ source: { ...source, tables: listOf(e.target.value) } })
                        }
                      />
                    )}
                  </SpecField>
                </div>
              </EditorSection>

              <EditorSection title="Variables">
                <div className="space-y-3">
                  {variables.map((v, i) => (
                    <Card
                      key={i}
                      title={text(v.symbol) || `variable ${i + 1}`}
                      onRemove={() => removeAt('variables', i)}
                      removeLabel="Remove this variable"
                    >
                      <div className="grid gap-4 sm:grid-cols-3">
                        <SpecField
                          label="Symbol"
                          hint="Case-sensitive; match the printed notation."
                        >
                          {(f) => (
                            <Input
                              {...f}
                              value={text(v.symbol)}
                              onChange={(e) =>
                                patchAt('variables', i, { ...v, symbol: e.target.value })
                              }
                              className="font-mono text-xs"
                            />
                          )}
                        </SpecField>
                        <SpecField label="Name">
                          {(f) => (
                            <Input
                              {...f}
                              value={text(v.name)}
                              onChange={(e) =>
                                patchAt('variables', i, { ...v, name: e.target.value })
                              }
                            />
                          )}
                        </SpecField>
                        <SpecField label="Unit" hint="A constraint, not a label.">
                          {(f) => (
                            <Input
                              {...f}
                              value={text(v.unit)}
                              onChange={(e) =>
                                patchAt('variables', i, { ...v, unit: e.target.value })
                              }
                            />
                          )}
                        </SpecField>
                        <SpecField label="Role">
                          {(f) => (
                            <Select
                              value={text(v.role) || 'input'}
                              onValueChange={(role) => patchAt('variables', i, { ...v, role })}
                            >
                              <SelectTrigger {...f}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ROLES.map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {r}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </SpecField>
                        <SpecField
                          label="Value"
                          hint={
                            text(v.role) === 'constant'
                              ? 'Required for a constant.'
                              : 'Optional default.'
                          }
                        >
                          {(f) => (
                            <Input
                              {...f}
                              value={text(v.value)}
                              onChange={(e) =>
                                patchAt('variables', i, { ...v, value: scalar(e.target.value) })
                              }
                              className="font-mono text-xs"
                            />
                          )}
                        </SpecField>
                        <SpecField label="Expression" hint="Required for a derived variable.">
                          {(f) => (
                            <Input
                              {...f}
                              value={text(v.expression)}
                              onChange={(e) =>
                                patchAt('variables', i, { ...v, expression: e.target.value })
                              }
                              className="font-mono text-xs"
                            />
                          )}
                        </SpecField>
                      </div>
                    </Card>
                  ))}
                  <AddButton
                    label="Add variable"
                    onClick={() => addTo('variables', { symbol: '', role: 'input' })}
                  />
                </div>
              </EditorSection>

              <EditorSection title="Expressions">
                <div className="space-y-3">
                  {expressions.map((e, i) => (
                    <Card
                      key={i}
                      title={text(e.id) || `expression ${i + 1}`}
                      onRemove={() => removeAt('expressions', i)}
                      removeLabel="Remove this expression"
                    >
                      <div className="grid gap-4 sm:grid-cols-2">
                        <SpecField label="Id">
                          {(f) => (
                            <Input
                              {...f}
                              value={text(e.id)}
                              onChange={(ev) =>
                                patchAt('expressions', i, { ...e, id: ev.target.value })
                              }
                              className="font-mono text-xs"
                            />
                          )}
                        </SpecField>
                        <SpecField
                          label="Equation number"
                          hint="Part of the claim — cite what you read."
                        >
                          {(f) => (
                            <Input
                              {...f}
                              value={text(e.equation)}
                              onChange={(ev) =>
                                patchAt('expressions', i, { ...e, equation: ev.target.value })
                              }
                            />
                          )}
                        </SpecField>
                        <SpecField label="Result symbol">
                          {(f) => (
                            <Input
                              {...f}
                              value={text(e.resultSymbol)}
                              onChange={(ev) =>
                                patchAt('expressions', i, { ...e, resultSymbol: ev.target.value })
                              }
                              className="font-mono text-xs"
                            />
                          )}
                        </SpecField>
                        <SpecField label="Result unit">
                          {(f) => (
                            <Input
                              {...f}
                              value={text(e.unit)}
                              onChange={(ev) =>
                                patchAt('expressions', i, { ...e, unit: ev.target.value })
                              }
                            />
                          )}
                        </SpecField>
                      </div>
                      <SpecField label="Expression" hint="What is actually computed.">
                        {(f) => (
                          <Textarea
                            {...f}
                            value={text(e.expression)}
                            onChange={(ev) =>
                              patchAt('expressions', i, { ...e, expression: ev.target.value })
                            }
                            spellCheck={false}
                            className="font-mono text-xs"
                          />
                        )}
                      </SpecField>
                      <SpecField
                        label="LaTeX"
                        hint="Display only — never parsed, and nothing checks it agrees."
                      >
                        {(f) => (
                          <Textarea
                            {...f}
                            value={text(e.latex)}
                            onChange={(ev) =>
                              patchAt('expressions', i, { ...e, latex: ev.target.value })
                            }
                            spellCheck={false}
                            className="font-mono text-xs"
                          />
                        )}
                      </SpecField>
                      {/* A horizontal Field: label and description on the left,
                          the one control on the right. The label now names the
                          Switch instead of hanging beside it, so the text is a
                          hit target and a screen reader reads the two together. */}
                      <Field
                        orientation="horizontal"
                        className="items-start justify-between gap-3 rounded-md border border-border p-3"
                      >
                        <div className="min-w-0">
                          <FieldLabel htmlFor={`unverified-${i}`}>Unverified</FieldLabel>
                          <FieldDescription id={`unverified-${i}-hint`}>
                            Set this if you did not read the equation off the page. It renders as a
                            warning everywhere.
                          </FieldDescription>
                        </div>
                        <Switch
                          id={`unverified-${i}`}
                          aria-describedby={`unverified-${i}-hint`}
                          className="shrink-0"
                          checked={Boolean(e.unverified)}
                          onCheckedChange={(on) =>
                            patchAt('expressions', i, {
                              ...e,
                              unverified: on
                                ? text(e.unverified) || 'Supplied from memory.'
                                : undefined,
                            })
                          }
                        />
                      </Field>
                      {e.unverified ? (
                        <SpecField label="Why it is unverified">
                          {(f) => (
                            <Textarea
                              {...f}
                              value={text(e.unverified)}
                              onChange={(ev) =>
                                patchAt('expressions', i, { ...e, unverified: ev.target.value })
                              }
                            />
                          )}
                        </SpecField>
                      ) : null}
                    </Card>
                  ))}
                  <AddButton
                    label="Add expression"
                    onClick={() => addTo('expressions', { id: '', expression: '' })}
                  />
                </div>
              </EditorSection>

              <EditorSection title="Piecewise">
                <div className="space-y-3">
                  {piecewise.map((p, i) => {
                    const cases = Array.isArray(p.cases) ? (p.cases as Row[]) : [];
                    const setCases = (next: Row[]) =>
                      patchAt('piecewise', i, { ...p, cases: next });
                    return (
                      <Card
                        key={i}
                        title={text(p.id) || `branch ${i + 1}`}
                        onRemove={() => removeAt('piecewise', i)}
                        removeLabel="Remove this piecewise branch"
                      >
                        <div className="grid gap-4 sm:grid-cols-2">
                          <SpecField label="Id">
                            {(f) => (
                              <Input
                                {...f}
                                value={text(p.id)}
                                onChange={(e) =>
                                  patchAt('piecewise', i, { ...p, id: e.target.value })
                                }
                                className="font-mono text-xs"
                              />
                            )}
                          </SpecField>
                          <SpecField label="Result symbol">
                            {(f) => (
                              <Input
                                {...f}
                                value={text(p.resultSymbol)}
                                onChange={(e) =>
                                  patchAt('piecewise', i, { ...p, resultSymbol: e.target.value })
                                }
                                className="font-mono text-xs"
                              />
                            )}
                          </SpecField>
                        </div>
                        <div className="space-y-2">
                          {cases.map((c, j) => (
                            <div key={j} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                              <Input
                                value={text(c.when)}
                                placeholder="when {Re} < 2300"
                                onChange={(e) =>
                                  setCases(
                                    cases.map((x, k) =>
                                      k === j ? { ...x, when: e.target.value } : x,
                                    ),
                                  )
                                }
                                className="font-mono text-xs"
                              />
                              <Input
                                value={text(c.use)}
                                placeholder="use (expression id)"
                                onChange={(e) =>
                                  setCases(
                                    cases.map((x, k) =>
                                      k === j ? { ...x, use: e.target.value } : x,
                                    ),
                                  )
                                }
                                className="font-mono text-xs"
                              />
                              <Input
                                value={text(c.label)}
                                placeholder="label"
                                onChange={(e) =>
                                  setCases(
                                    cases.map((x, k) =>
                                      k === j ? { ...x, label: e.target.value } : x,
                                    ),
                                  )
                                }
                              />
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground hover:text-destructive-ink"
                                aria-label={`Remove case ${j + 1}`}
                                onClick={() => setCases(cases.filter((_, k) => k !== j))}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          ))}
                          <AddButton
                            label="Add case"
                            onClick={() => setCases([...cases, { when: '', use: '' }])}
                          />
                        </div>
                        <SpecField
                          label="Otherwise"
                          hint="Leave empty and an unmatched value is an error rather than a quiet zero."
                        >
                          {(f) => (
                            <Input
                              {...f}
                              value={text(p.otherwise)}
                              onChange={(e) =>
                                patchAt('piecewise', i, { ...p, otherwise: e.target.value })
                              }
                              className="font-mono text-xs"
                            />
                          )}
                        </SpecField>
                      </Card>
                    );
                  })}
                  <AddButton
                    label="Add piecewise"
                    onClick={() => addTo('piecewise', { id: '', cases: [{ when: '', use: '' }] })}
                  />
                </div>
              </EditorSection>

              <EditorSection title="Lookup tables">
                <div className="space-y-3">
                  {lookups.map((l, i) => {
                    const keys = Array.isArray(l.keys) ? (l.keys as string[]) : [];
                    const result = text(l.result);
                    const rows = Array.isArray(l.rows) ? (l.rows as Row[]) : [];
                    const columns = [...keys, result].filter(Boolean);
                    const domains = obj(l.domains);
                    const setRows = (next: Row[]) => patchAt('lookups', i, { ...l, rows: next });
                    return (
                      <Card
                        key={i}
                        title={text(l.id) || `table ${i + 1}`}
                        onRemove={() => removeAt('lookups', i)}
                        removeLabel="Remove this lookup table"
                      >
                        <div className="grid gap-4 sm:grid-cols-2">
                          <SpecField label="Id">
                            {(f) => (
                              <Input
                                {...f}
                                value={text(l.id)}
                                onChange={(e) =>
                                  patchAt('lookups', i, { ...l, id: e.target.value })
                                }
                                className="font-mono text-xs"
                              />
                            )}
                          </SpecField>
                          <SpecField label="Name">
                            {(f) => (
                              <Input
                                {...f}
                                value={text(l.name)}
                                onChange={(e) =>
                                  patchAt('lookups', i, { ...l, name: e.target.value })
                                }
                              />
                            )}
                          </SpecField>
                          <SpecField label="Keys" hint="Comma separated symbols.">
                            {(f) => (
                              <Input
                                {...f}
                                value={keys.join(', ')}
                                onChange={(e) =>
                                  patchAt('lookups', i, { ...l, keys: listOf(e.target.value) })
                                }
                                className="font-mono text-xs"
                              />
                            )}
                          </SpecField>
                          <SpecField label="Result field">
                            {(f) => (
                              <Input
                                {...f}
                                value={result}
                                onChange={(e) =>
                                  patchAt('lookups', i, { ...l, result: e.target.value })
                                }
                                className="font-mono text-xs"
                              />
                            )}
                          </SpecField>
                        </div>

                        {keys.length > 0 ? (
                          <div className="space-y-2">
                            <GroupCaption>Declared domains</GroupCaption>
                            <p className="text-[11px] text-muted-foreground">
                              The legal values per key. Declaring them is what lets coverage be
                              checked — every combination with no row gets named.
                            </p>
                            {keys.map((k) => (
                              <div key={k} className="grid gap-2 sm:grid-cols-[120px_1fr]">
                                <span className="self-center font-mono text-xs text-muted-foreground">
                                  {k}
                                </span>
                                <Input
                                  value={(Array.isArray(domains[k])
                                    ? (domains[k] as unknown[])
                                    : []
                                  )
                                    .map(String)
                                    .join(', ')}
                                  placeholder="A, B, C"
                                  onChange={(e) =>
                                    patchAt('lookups', i, {
                                      ...l,
                                      domains: {
                                        ...domains,
                                        [k]: listOf(e.target.value).map((s) => scalar(s)),
                                      },
                                    })
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {columns.length > 0 ? (
                          <div className="space-y-2">
                            <GroupCaption>Rows</GroupCaption>
                            <div className="overflow-x-auto scrollbar-thin">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr>
                                    {columns.map((c) => (
                                      <th
                                        key={c}
                                        className="px-1 pb-1 text-left font-mono font-medium text-muted-foreground"
                                      >
                                        {c}
                                      </th>
                                    ))}
                                    <th />
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((r, j) => (
                                    <tr key={j}>
                                      {columns.map((c) => (
                                        <td key={c} className="p-0.5">
                                          <Input
                                            value={text(r[c])}
                                            onChange={(e) =>
                                              setRows(
                                                rows.map((x, k) =>
                                                  k === j
                                                    ? { ...x, [c]: scalar(e.target.value) }
                                                    : x,
                                                ),
                                              )
                                            }
                                            className="h-8 font-mono text-xs"
                                          />
                                        </td>
                                      ))}
                                      <td className="p-0.5">
                                        <Button
                                          variant="ghost"
                                          size="icon-sm"
                                          className="text-muted-foreground hover:text-destructive-ink"
                                          aria-label={`Remove row ${j + 1}`}
                                          onClick={() => setRows(rows.filter((_, k) => k !== j))}
                                        >
                                          <Trash2 />
                                        </Button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <AddButton label="Add row" onClick={() => setRows([...rows, {}])} />
                          </div>
                        ) : null}
                      </Card>
                    );
                  })}
                  <AddButton
                    label="Add lookup"
                    onClick={() =>
                      addTo('lookups', { id: '', keys: [], result: '', rows: [], onMiss: 'error' })
                    }
                  />
                </div>
              </EditorSection>

              <EditorSection title="Classifications">
                <div className="space-y-3">
                  {classifications.map((c, i) => {
                    const domain = Array.isArray(c.domain) ? (c.domain as string[]) : [];
                    const criteria = obj(c.criteria);
                    return (
                      <Card
                        key={i}
                        title={text(c.id) || `classification ${i + 1}`}
                        onRemove={() => removeAt('classifications', i)}
                        removeLabel="Remove this classification"
                      >
                        <div className="grid gap-4 sm:grid-cols-2">
                          <SpecField
                            label="Id"
                            hint="Name it after the symbol it describes, e.g. detection-rating for `detection`."
                          >
                            {(f) => (
                              <Input
                                {...f}
                                value={text(c.id)}
                                onChange={(e) =>
                                  patchAt('classifications', i, { ...c, id: e.target.value })
                                }
                                className="font-mono text-xs"
                              />
                            )}
                          </SpecField>
                          <SpecField label="Ratings" hint="Comma separated.">
                            {(f) => (
                              <Input
                                {...f}
                                value={domain.join(', ')}
                                onChange={(e) =>
                                  patchAt('classifications', i, {
                                    ...c,
                                    domain: listOf(e.target.value),
                                  })
                                }
                              />
                            )}
                          </SpecField>
                        </div>
                        {domain.map((value) => (
                          <SpecField key={value} label={`Criterion for ${value}`}>
                            {(f) => (
                              <Textarea
                                {...f}
                                value={text(criteria[value])}
                                onChange={(e) =>
                                  patchAt('classifications', i, {
                                    ...c,
                                    criteria: { ...criteria, [value]: e.target.value },
                                  })
                                }
                              />
                            )}
                          </SpecField>
                        ))}
                      </Card>
                    );
                  })}
                  <AddButton
                    label="Add classification"
                    onClick={() => addTo('classifications', { id: '', domain: [], criteria: {} })}
                  />
                </div>
              </EditorSection>

              <EditorSection title="Transcription notes">
                <p className="text-[11px] text-muted-foreground">
                  Record what the source got wrong rather than silently correcting it — an undefined
                  threshold, an abridged table, a dropped division.
                </p>
                <div className="space-y-2">
                  {Object.entries(notes).map(([key, value], i) => (
                    <div key={i} className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
                      <Input
                        value={key}
                        placeholder="topic"
                        onChange={(e) => {
                          const next: Row = {};
                          for (const [k, v] of Object.entries(notes)) {
                            next[k === key ? e.target.value : k] = v;
                          }
                          patch({ notes: next });
                        }}
                        className="font-mono text-xs"
                      />
                      <Textarea
                        value={text(value)}
                        onChange={(e) => patch({ notes: { ...notes, [key]: e.target.value } })}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive-ink"
                        aria-label={`Remove the note “${key}”`}
                        onClick={() => {
                          const next = { ...notes };
                          delete next[key];
                          patch({ notes: next });
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <AddButton
                    label="Add note"
                    onClick={() =>
                      patch({ notes: { ...notes, [`note-${Object.keys(notes).length + 1}`]: '' } })
                    }
                  />
                </div>
              </EditorSection>
            </>
          )}
        </div>

        {/* ── the validation rail ─────────────────────────────────────── */}
        <aside className="min-h-0 space-y-4 overflow-y-auto scrollbar-thin border-t border-border px-5 py-5 lg:border-l lg:border-t-0">
          <div className="flex items-center gap-2">
            {valid ? (
              <Check className="size-4 text-muted-foreground" />
            ) : (
              <AlertTriangle className="size-4 text-destructive-ink" />
            )}
            <h3 className="text-sm font-semibold text-foreground">Validation</h3>
          </div>

          {serverErrors.length > 0 ? (
            // A rejected save is a whole-spec verdict, not one control's fault,
            // so it stays a panel rather than a FieldError — but it arrives
            // after a click and has to announce itself.
            <div
              role="alert"
              className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3"
            >
              <p className="text-xs font-medium text-foreground">The server rejected the spec</p>
              <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                {serverErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {findings.errors.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">
                {findings.errors.length} problem{findings.errors.length === 1 ? '' : 's'}
              </p>
              <ul className="list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
                {findings.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          ) : yamlError ? (
            // Same reason as the header line: with unparsed YAML the rail is
            // describing the last GOOD draft, and "the spec parses" beside a
            // red source box reads as though nothing is wrong.
            <p className="text-[11px] text-muted-foreground">
              The source does not parse, so these findings describe the last version that did.
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              The spec parses. Every expression is syntactically valid and every cross-reference
              resolves.
            </p>
          )}

          {findings.dims.length > 0 ? (
            <div className="space-y-1">
              <Badge variant="destructive" className="text-[10px]">
                Dimensions
              </Badge>
              <p className="text-[11px] text-muted-foreground">
                The arithmetic disagrees with a declared unit — usually a dropped term.
              </p>
              <ul className="list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
                {findings.dims.map((d, i) => (
                  <li key={i}>
                    <code>{d.id}</code> — {d.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {findings.coverage.length > 0 ? (
            <div className="space-y-1">
              <Badge variant="secondary" className="text-[10px]">
                Coverage
              </Badge>
              <p className="text-[11px] text-muted-foreground">
                {findings.coverage.length} declared key combination
                {findings.coverage.length === 1 ? '' : 's'} with no row. This is a fact about the
                source, not necessarily a mistake — do not invent a value for it.
              </p>
              <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                {findings.coverage.slice(0, 20).map((g, i) => (
                  <li key={i}>
                    <code>{g.lookupId}</code>
                    {g.skipped
                      ? ` — ${g.skipped}`
                      : `: ${Object.entries(g.key)
                          .map(([k, v]) => `${k}=${String(v)}`)
                          .join(', ')}`}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
