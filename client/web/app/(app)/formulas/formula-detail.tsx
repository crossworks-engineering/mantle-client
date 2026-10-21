'use client';

import { AccessSlot } from '@/components/share/access-slot';
import { Fragment, useMemo, useState } from 'react';
import katex from 'katex';
import { AlertTriangle, Sigma } from 'lucide-react';
import type { CoverageGap, FormulaSpec, FormulaValue } from '@mantle/content-core/formula-spec';
import type { DimensionIssue } from '@mantle/content-core/formula-dimensions';
import type { SignatureInput, TargetSignature } from '@mantle/content-core/formula-signature';
import type { TraceStep } from '@mantle/content-core/formula-eval';
import { Badge } from '@mantle/web-ui/ui/badge';
import { Input } from '@mantle/web-ui/ui/input';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@mantle/web-ui/ui/field';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { Separator } from '@mantle/web-ui/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mantle/web-ui/ui/table';
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
import { apiSend } from '@mantle/web-ui/api-fetch';
import { cn } from '@mantle/web-ui/lib/utils';
import { parseInputText } from '@mantle/content-core/formula-eval';
import { HeaderPill, ItemHeader } from '@/components/layout/item-header';
import { JsonView } from '@mantle/web-ui/ui/json-view';

export type FormulaRow = {
  id: string;
  title: string;
  spec: FormulaSpec;
  tags: string[];
  summary: string | null;
  createdAt: string;
  updatedAt: string;
};

type EvalResponse =
  | { ok: true; value: FormulaValue; trace: TraceStep[] }
  | { ok: false; error: string; trace: TraceStep[] };

/** Runs BEFORE the degraded-spec guard below (the title bar renders either
 *  way), so it must tolerate a spec that no longer validates — `sections: '5.3'`
 *  as a bare string reaches `.join` and throws. */
function citation(spec: FormulaSpec | undefined): string | null {
  const s = spec?.source;
  if (!s) return null;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const head = [s.standard, s.part ? `Part ${s.part}` : '', s.edition ? `(${s.edition})` : '']
    .filter(Boolean)
    .join(' ');
  const sections = list(s.sections);
  const tables = list(s.tables);
  const out = `${head}${sections.length ? `, §${sections.join(', §')}` : ''}${
    tables.length ? `, Tables ${tables.join(', ')}` : ''
  }`.trim();
  return out || null;
}

/** Renders the author-supplied `latex` when present, else the literal
 *  expression. Never derives one from the other: `expression` is what is
 *  computed and `latex` is only how it is drawn. */
function Equation({ latex, expression }: { latex?: string; expression: string }) {
  const html = useMemo(() => {
    if (!latex) return null;
    try {
      // `trust: false` (KaTeX's default, pinned here because the output goes
      // through dangerouslySetInnerHTML) disables \href, \url and
      // \includegraphics — a spec authored by an agent from a pasted document
      // must not be able to inject a link or fetch a remote asset.
      return katex.renderToString(latex, {
        displayMode: true,
        throwOnError: false,
        trust: false,
      });
    } catch {
      return null;
    }
  }, [latex]);
  if (html) {
    return (
      <div
        className="overflow-x-auto py-2 scrollbar-thin"
        // KaTeX output, generated from the spec's own display string.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground scrollbar-thin">
      <code>{expression}</code>
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** A finding about the spec itself, rather than about a computed value. */
function Notice({
  tone = 'muted',
  title,
  children,
}: {
  tone?: 'muted' | 'destructive';
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex gap-3 rounded-md border p-3',
        tone === 'destructive'
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-border bg-muted/50',
      )}
    >
      <AlertTriangle
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'destructive' ? 'text-destructive-ink' : 'text-muted-foreground',
        )}
      />
      <div className="min-w-0 space-y-1 text-xs">
        <p className="font-medium text-foreground">{title}</p>
        {children}
      </div>
    </div>
  );
}

/**
 * The equation was not read off the source — supplied from memory, inferred, or
 * reconstructed. docs/formulas.md promises this "renders as a warning
 * everywhere"; it is the one mark that changes whether a reader may rely on the
 * number, so it travels with the equation rather than sitting in a footnote.
 */
function UnverifiedBadge({ reason }: { reason: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="destructive" className="text-[10px]">
        Unverified
      </Badge>
      <span className="text-xs text-muted-foreground">{reason}</span>
    </span>
  );
}

// One coercer for every evaluation surface — see parseInputText's rationale.

export function FormulaDetail({
  formula,
  shares,
  coverageGaps,
  dimensionIssues,
  signature,
  specErrors,
  onEdit,
  onDeleted,
}: {
  formula: FormulaRow;
  /** The share marks for Access (`shareMarksOf`). */
  shares: unknown;
  coverageGaps: CoverageGap[];
  dimensionIssues: DimensionIssue[];
  signature: TargetSignature[];
  specErrors?: string[];
  onEdit: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const toast = useToast();
  const spec = formula.spec;
  const cite = citation(spec);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function remove() {
    setDeleting(true);
    try {
      await apiSend(`/api/formulas/${formula.id}`, 'DELETE');
      toast.success('Formula deleted');
      await onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete');
    } finally {
      setDeleting(false);
    }
  }

  const [target, setTarget] = useState(signature[0]?.id ?? '');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<EvalResponse | null>(null);
  const [running, setRunning] = useState(false);
  /** Required symbols left empty at submit. Every one at once, not the first:
   *  a six-variable equation asked for one box at a time is six round trips. */
  const [missing, setMissing] = useState<Set<string>>(new Set());

  const activeTarget = useMemo(() => signature.find((s) => s.id === target), [signature, target]);

  // Exactly what the chosen target needs — no more. This used to offer every
  // declared input plus every lookup key in the whole spec, so a two-variable
  // equation rendered a dozen boxes and gave no clue which mattered.
  const inputFields: SignatureInput[] = activeTarget?.inputs ?? [];

  /** Typing into a field clears its own mark, not the whole set — the others
   *  are still empty and still wrong. */
  function setInput(symbol: string, value: string) {
    setInputs((prev) => ({ ...prev, [symbol]: value }));
    setMissing((prev) => {
      if (!prev.has(symbol) || !value.trim()) return prev;
      const next = new Set(prev);
      next.delete(symbol);
      return next;
    });
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    // A required input with no value used to be a server round trip that came
    // back "unknown symbol" in the result panel — true, but it named the
    // symbol rather than the box, and left nothing red to go and fill.
    const blank = new Set(
      inputFields
        .filter((f) => f.required && !(inputs[f.symbol] ?? '').trim())
        .map((f) => f.symbol),
    );
    setMissing(blank);
    if (blank.size > 0) return;
    setRunning(true);
    try {
      const supplied: Record<string, FormulaValue> = {};
      for (const [k, v] of Object.entries(inputs)) {
        const parsed = parseInputText(v);
        if (parsed !== undefined) supplied[k] = parsed;
      }
      const res = await apiSend<EvalResponse>(`/api/formulas/${formula.id}/evaluate`, 'POST', {
        target,
        inputs: supplied,
      });
      setResult(res);
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : 'evaluation failed',
        trace: [],
      });
    } finally {
      setRunning(false);
    }
  }

  const header = (
    <>
      {/* The item header (contract 2026-10-21): one row; the citation behind
          Info. The shared page is a live calculator: at Public, anyone with
          the link can put their own numbers in without an account. A formula
          is not a member kind, so no member screen lists one; until one does,
          the link must be passed along directly (the panel's hint). */}
      <ItemHeader
        section="Formulas"
        visual={<Sigma className="size-4" aria-hidden />}
        title={formula.title}
        badges={spec?.unitSystem ? <HeaderPill>{spec.unitSystem}</HeaderPill> : null}
        access={
          <AccessSlot
            type="formula"
            nodeId={formula.id}
            canShare
            shares={shares}
            hint="Formulas do not show in the lists of other users yet. Send the open link directly."
          />
        }
        onDelete={() => setConfirmDelete(true)}
        deleteDisabled={deleting}
        deleteLabel="Delete formula"
        move={{ kind: 'formulas', item: { id: formula.id, title: formula.title } }}
        edit={{ onSelect: onEdit, label: 'Edit formula' }}
        info={{ rows: cite ? [{ label: 'Source', value: cite }] : [] }}
        infoLabel="About this formula"
      />
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{formula.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the formula and its brain index permanently. Anything that cited it keeps
              only the text of the citation, not the calculation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete formula
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  // A stored spec that no longer re-parses. Every section below indexes into
  // spec arrays the validator guarantees, so rendering on regardless would
  // throw and blank the pane — which is how this degraded silently: the node
  // exists, the list shows it, and selecting it produced nothing at all.
  if (specErrors && specErrors.length > 0) {
    return (
      <div>
        {header}
        <div className="space-y-4 px-6 py-5">
          <Notice tone="destructive" title="This formula no longer validates">
            <p className="text-muted-foreground">
              The stored spec fails to parse, so it cannot be rendered or evaluated. Fix it with the
              assistant, or edit the source directly.
            </p>
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              {specErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </Notice>
          <Section title="Stored spec">
            <JsonView value={spec} collapseDepth={3} maxHeight={560} />
          </Section>
        </div>
      </div>
    );
  }

  return (
    // No `h-full` and no scroller of its own: `MasterDetail` owns the pane's
    // single scrollbar. A second one here paints two bars side by side.
    <div>
      {header}

      <div className="space-y-6 px-6 py-5">
        {coverageGaps.length > 0 ? (
          <Notice
            title={`The source leaves ${coverageGaps.length} combination${
              coverageGaps.length === 1 ? '' : 's'
            } unspecified`}
          >
            <p className="text-muted-foreground">
              These keys are declared legal but have no row. Evaluating one is an error rather than
              a zero.
            </p>
            <ul className="text-muted-foreground">
              {coverageGaps.slice(0, 12).map((gap, i) => (
                <li key={i}>
                  <code>{gap.lookupId}</code>
                  {gap.skipped ? (
                    <> — {gap.skipped}</>
                  ) : (
                    <>
                      :{' '}
                      {Object.entries(gap.key)
                        .map(([k, v]) => `${k}=${String(v)}`)
                        .join(', ')}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {dimensionIssues.length > 0 ? (
          <Notice
            tone="destructive"
            title={`The arithmetic disagrees with ${dimensionIssues.length} declared unit${
              dimensionIssues.length === 1 ? '' : 's'
            }`}
          >
            <p className="text-muted-foreground">
              A term is missing, or a variable&apos;s unit is wrong. Values may still look right —
              this is the check that catches a constant labelled with the wrong dimension.
            </p>
            <ul className="space-y-1 text-muted-foreground">
              {dimensionIssues.map((issue, i) => (
                <li key={i}>
                  <code>{issue.id}</code> — {issue.detail}
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {spec.expressions.length > 0 ? (
          <Section title="Equations">
            <div className="space-y-4">
              {spec.expressions.map((e) => (
                <div key={e.id} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-xs font-medium text-foreground">{e.id}</code>
                    {e.equation ? (
                      <Badge variant="outline" className="text-[10px]">
                        Eq {e.equation}
                      </Badge>
                    ) : null}
                    {e.resultSymbol ? (
                      <span className="text-xs text-muted-foreground">
                        → {e.resultSymbol}
                        {e.unit ? ` [${e.unit}]` : ''}
                      </span>
                    ) : null}
                  </div>
                  <Equation latex={e.latex} expression={e.expression} />
                  {e.unverified ? <UnverifiedBadge reason={e.unverified} /> : null}
                  {e.note ? <p className="text-xs text-muted-foreground">{e.note}</p> : null}
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {spec.piecewise.length > 0 ? (
          <Section title="Conditional selection">
            {spec.piecewise.map((p) => (
              <div key={p.id} className="space-y-1 text-xs">
                <code className="font-medium text-foreground">{p.id}</code>
                <ul className="space-y-1 text-muted-foreground">
                  {p.cases.map((c, i) => (
                    <li key={i}>
                      {c.label ? <span className="text-foreground">{c.label}</span> : null} when{' '}
                      <code>{c.when}</code> use <code>{c.use}</code>
                    </li>
                  ))}
                  {p.otherwise ? (
                    <li>
                      otherwise use <code>{p.otherwise}</code>
                    </li>
                  ) : null}
                </ul>
              </div>
            ))}
          </Section>
        ) : null}

        {spec.variables.length > 0 ? (
          <Section title="Variables">
            <div className="overflow-x-auto scrollbar-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spec.variables.map((v) => (
                    <TableRow key={v.symbol}>
                      <TableCell className="font-mono text-xs">{v.symbol}</TableCell>
                      <TableCell className="text-xs">{v.name ?? ''}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {v.expression ?? (v.value !== undefined ? String(v.value) : '')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {v.unit ?? ''}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={v.role === 'input' ? 'default' : 'secondary'}
                          className="text-[10px]"
                        >
                          {v.role}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>
        ) : null}

        {spec.lookups.map((lookup) => (
          <Section key={lookup.id} title={lookup.name ?? lookup.id}>
            <div className="overflow-x-auto scrollbar-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    {[...lookup.keys, lookup.result].map((c) => (
                      <TableHead key={c}>{c}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lookup.rows.map((row, i) => (
                    <TableRow key={i}>
                      {[...lookup.keys, lookup.result].map((c) => (
                        <TableCell key={c} className="text-xs">
                          {row[c] === null || row[c] === undefined ? '' : String(row[c])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>
        ))}

        {spec.classifications.map((c) => (
          <Section key={c.id} title={c.id}>
            {/* A two-column grid, not a row of flex pairs with a fixed `w-6`
                label: the domain of a classification is words as often as it is
                letters ("laminar", "transitional"), and a 1.5rem box does not
                clip — the label simply overran the criteria text beside it.
                `auto` sizes the column to the widest label in THIS list, so the
                criteria still line up without a hard-coded width. */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
              {c.domain.map((value) => (
                <Fragment key={value}>
                  <dt className="font-mono font-medium text-foreground">{value}</dt>
                  <dd className="min-w-0 text-muted-foreground">{c.criteria[value]}</dd>
                </Fragment>
              ))}
            </dl>
          </Section>
        ))}

        {spec.notes && Object.keys(spec.notes).length > 0 ? (
          <Section title="Transcription notes">
            <dl className="space-y-2 text-xs">
              {Object.entries(spec.notes).map(([key, text]) => (
                <div key={key}>
                  <dt className="font-mono font-medium text-foreground">{key}</dt>
                  <dd className="text-muted-foreground">{text}</dd>
                </div>
              ))}
            </dl>
          </Section>
        ) : null}

        <Separator />

        <Section title="Evaluate">
          {/* A real `<form>`, so Enter submits from any box — this is a
              calculator and typing a number then reaching for the mouse is the
              wrong gesture. Nothing above is a form, so `SubmitButton`'s
              `type="submit"` has no outer form to hijack (landmine 7). */}
          <form onSubmit={run} noValidate>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="formula-target">Target</FieldLabel>
                <Select
                  value={target}
                  onValueChange={(t) => {
                    setTarget(t);
                    // The new target has its own inputs, so last target's
                    // missing-field marks name controls that are gone.
                    setMissing(new Set());
                  }}
                >
                  <SelectTrigger id="formula-target">
                    <SelectValue placeholder="Choose a target" />
                  </SelectTrigger>
                  <SelectContent>
                    {signature.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.id} · {t.kind}
                        {t.produces ? ` → ${t.produces}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {activeTarget && activeTarget.unverified.length > 0 ? (
                <Notice tone="destructive" title="This result depends on an unverified equation">
                  <ul className="space-y-1 text-muted-foreground">
                    {activeTarget.unverified.map((u) => (
                      <li key={u.id}>
                        <code>{u.id}</code> — {u.reason}
                      </li>
                    ))}
                  </ul>
                </Notice>
              ) : null}

              {/* Layout only — each cell is still a Field (§6a). */}
              <div className="grid gap-4 sm:grid-cols-2">
                {inputFields.map((f) => {
                  const bad = missing.has(f.symbol);
                  // `aria-describedby` takes a LIST, and a field can carry both
                  // an error and one or two descriptions at once.
                  const describedBy = [
                    bad ? `in-${f.symbol}-error` : null,
                    f.undeclared ? `in-${f.symbol}-undeclared` : null,
                    f.note ? `in-${f.symbol}-note` : null,
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const flags = {
                    'aria-invalid': bad || undefined,
                    'aria-describedby': describedBy || undefined,
                  };
                  return (
                    <Field key={f.symbol} data-invalid={bad || undefined}>
                      <FieldLabel htmlFor={`in-${f.symbol}`} className="font-mono text-xs">
                        {f.symbol}
                        {f.unit ? (
                          <span className="ml-1 font-sans text-muted-foreground">({f.unit})</span>
                        ) : null}
                        {f.required ? null : (
                          <span className="ml-1 font-sans text-muted-foreground">optional</span>
                        )}
                      </FieldLabel>
                      {/* An enum whose legal values are known becomes a picker, so a
                          case-typo is impossible rather than merely loud — symbols
                          are case-sensitive and 'a' would be an error, not an 'A'. */}
                      {f.kind === 'enum' && f.domain?.length ? (
                        <Select
                          value={inputs[f.symbol] ?? ''}
                          onValueChange={(v) => setInput(f.symbol, v)}
                        >
                          <SelectTrigger id={`in-${f.symbol}`} {...flags}>
                            <SelectValue placeholder={f.name ?? 'Choose…'} />
                          </SelectTrigger>
                          <SelectContent>
                            {f.domain.map((v) => (
                              <SelectItem key={String(v)} value={String(v)}>
                                {String(v)}
                                {f.criteria?.[String(v)] ? ` — ${f.criteria[String(v)]}` : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id={`in-${f.symbol}`}
                          value={inputs[f.symbol] ?? ''}
                          placeholder={f.default !== undefined ? String(f.default) : (f.name ?? '')}
                          onChange={(e) => setInput(f.symbol, e.target.value)}
                          {...flags}
                        />
                      )}
                      <FieldError id={`in-${f.symbol}-error`}>
                        {bad ? `${f.symbol} is required` : null}
                      </FieldError>
                      {f.undeclared ? (
                        <FieldDescription id={`in-${f.symbol}-undeclared`}>
                          Not declared as a variable in the spec.
                        </FieldDescription>
                      ) : null}
                      {f.note ? (
                        <FieldDescription id={`in-${f.symbol}-note`}>{f.note}</FieldDescription>
                      ) : null}
                    </Field>
                  );
                })}
              </div>

              {/* A plain div, not a Field: a vertical Field stretches its direct
                  children and this button would become a full-width bar (§6a). */}
              <div>
                <SubmitButton pending={running} disabled={!target}>
                  Evaluate formula
                </SubmitButton>
              </div>

              {result ? (
                <div
                  className={cn(
                    'space-y-3 rounded-md border p-3',
                    result.ok ? 'border-border bg-muted/40' : 'border-destructive/40 bg-muted/40',
                  )}
                >
                  {result.ok ? (
                    <p className="font-mono text-lg text-foreground">{String(result.value)}</p>
                  ) : (
                    // An evaluation that fails is an outcome, not a field
                    // fault, so it stays a panel — but it still has to be
                    // announced rather than only turning red.
                    <p role="alert" className="text-xs text-destructive-ink">
                      {result.error}
                    </p>
                  )}
                  {result.trace.length > 0 ? (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        Derivation ({result.trace.length} steps)
                      </summary>
                      <ol className="mt-2 space-y-1 text-muted-foreground">
                        {result.trace.map((step, i) => (
                          <li key={i} className="font-mono">
                            {step.kind === 'symbol' ? (
                              <>
                                {step.symbol} = {String(step.value)}{' '}
                                <span className="opacity-60">({step.from})</span>
                              </>
                            ) : step.kind === 'expression' ? (
                              <>
                                {step.id} → {String(step.value)}
                              </>
                            ) : step.kind === 'branch' ? (
                              <>
                                {step.id}: {step.label ?? step.chose} — {step.when}
                              </>
                            ) : (
                              <>
                                {step.id}[
                                {Object.entries(step.key)
                                  .map(([k, v]) => `${k}=${String(v)}`)
                                  .join(', ')}
                                ] → {String(step.value)}
                              </>
                            )}
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </FieldGroup>
          </form>
        </Section>
      </div>
    </div>
  );
}
