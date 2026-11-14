'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import { Field, FieldError, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { FieldHint, hintId } from '@mantle/web-ui/ui/field-hint';
import { Input } from '@mantle/web-ui/ui/input';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Switch } from '@mantle/web-ui/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mantle/web-ui/ui/table';
import { useToast } from '@mantle/web-ui/ui/toast';
import { cn } from '@mantle/web-ui/lib/utils';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { TagInput } from '@/components/tag-input';
import { useWorkspaces } from '@/components/workspaces/workspace-queries';
import { fileHitsOnly, searchUrl } from '@/app/(app)/files/use-file-search';
import type { FileSearchHit } from '@/app/(app)/files/files-shared';
import { RunDialog, useRereadRouteGone } from '@/app/(app)/files/run-pipeline-dialog';
import { RUN_LIMIT, postReread, rereadRefusedText } from '@/lib/pipeline-run';
import {
  ATTACHED_NONE,
  NOTHING_WRITTEN,
  NO_RUN_YET,
  PIPELINES_PATH,
  READER_EVERYWHERE,
  cellText,
  countText,
  keepCounts,
  neverRan,
  olderText,
  optionValues,
  pipelinePath,
  readsText,
  rereadLabel,
  setBody,
  statsOf,
  takesFile,
  testStatusText,
  versionLines,
  wordOf,
  type PipelineList,
  type PipelineOption,
  type PipelineRow,
  type PipelineStats,
  type PipelineTestResult,
} from '@/lib/pipelines';

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One part of the detail: the sectioned settings card (style guide 6e). */
function Part({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card" aria-label={title}>
      <div className="border-b border-border p-4 md:p-5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}

/**
 * One pipeline: what it is, its options and workspaces (one Save, which
 * sends only what changed), and a test on one file. The form is made from
 * each option's `spec`; the screen knows no option by name.
 */
export function PipelineDetail({ row }: { row: PipelineRow }) {
  const [form, setForm] = useState(() => optionValues(row));
  const [ticks, setTicks] = useState<string[] | null>(() =>
    row.workspaces === 'all' ? null : [...row.workspaces],
  );
  return (
    <div className="space-y-6">
      <Overview row={row} />
      <SettingsPart row={row} form={form} setForm={setForm} ticks={ticks} setTicks={setTicks} />
      <TestPart row={row} form={form} />
    </div>
  );
}

function Overview({ row }: { row: PipelineRow }) {
  const writes = row.kind === 'after' ? row.tabs : row.shapes;
  const stats = statsOf(row);
  return (
    <Part title={row.name} hint={stats?.description || undefined}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Kind</dt>
        <dd>{row.kind === 'after' ? `After a reader, on ${row.after ?? '-'}` : 'Reader'}</dd>
        <dt className="text-muted-foreground">Reads</dt>
        <dd>{readsText(row.reads)}</dd>
        <dt className="text-muted-foreground">Version</dt>
        <dd className="font-mono text-xs leading-5">{row.version}</dd>
        <dt className="text-muted-foreground">{row.kind === 'after' ? 'Tabs' : 'Shapes'}</dt>
        <dd>{writes.length > 0 ? writes.join(', ') : '-'}</dd>
      </dl>
      {stats && <RunsAndVersions row={row} stats={stats} />}
    </Part>
  );
}

/** M8: the runs, the files by version, and the re-read of the older ones.
 *  "current" is the row's own version; "older" is the server's number. */
function RunsAndVersions({ row, stats }: { row: PipelineRow; stats: PipelineStats }) {
  const queryClient = useQueryClient();
  const gone = useRereadRouteGone();
  const [reread, setReread] = useState(false);
  const lines = versionLines(row.version, stats.versions);
  const older = olderText(row.older);
  const label = gone ? null : rereadLabel(row.older);
  return (
    <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
      <p>
        {neverRan(stats)
          ? NO_RUN_YET
          : `Runs: ${countText(stats.runs)}. Last run: ${
              stats.lastRunAt ? formatDateTime(stats.lastRunAt) : '-'
            }.`}
      </p>
      {lines.length > 0 && (
        <ul className="space-y-0.5 text-muted-foreground" aria-label="Files by version">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {older && <p className="text-warning-ink">{older}</p>}
      {label && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setReread(true)}>
            {label}
          </Button>
        </div>
      )}
      <RunDialog
        openKey={reread ? row.id : null}
        title="Read the older files again"
        description={`${row.name}: the files read by an older version or with other options, at most ${RUN_LIMIT} at a time.`}
        post={(body) => postReread(row.id, body, apiSend)}
        onOpenChange={(o) => !o && setReread(false)}
        onRan={() => void queryClient.invalidateQueries({ queryKey: [PIPELINES_PATH] })}
        refused={rereadRefusedText}
      />
    </div>
  );
}

type Form = Record<string, unknown>;

function SettingsPart({
  row,
  form,
  setForm,
  ticks,
  setTicks,
}: {
  row: PipelineRow;
  form: Form;
  setForm: (f: Form) => void;
  ticks: string[] | null;
  setTicks: (t: string[] | null) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const body = setBody(row, form, ticks);
  const save = useMutation({
    mutationFn: () => apiSend<PipelineRow>(pipelinePath(row.id), 'PATCH', body),
    onSuccess: (saved) => {
      setError(null);
      // The answer is the row with no counts: keep the list's.
      queryClient.setQueryData<PipelineList>([PIPELINES_PATH], (old) =>
        old
          ? {
              ...old,
              pipelines: old.pipelines.map((p) => (p.id === saved.id ? keepCounts(saved, p) : p)),
            }
          : old,
      );
      // Show what the brain kept (a word list comes back upper case, sorted).
      setForm(optionValues(saved));
      setTicks(saved.workspaces === 'all' ? null : [...saved.workspaces]);
      toast.success(`Saved ${saved.name}`);
    },
    onError: (err) => setError(errText(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (body) save.mutate();
  };
  return (
    <Part title="Options and workspaces">
      <form onSubmit={submit} noValidate>
        <FieldGroup>
          {row.options.length === 0 && (
            <p className="text-sm text-muted-foreground">This pipeline has no options.</p>
          )}
          {row.options.map((o) => (
            <OptionField
              key={o.name}
              id={`pipeline-${row.id}-${o.name}`}
              option={o}
              value={form[o.name]}
              onChange={(v) => setForm({ ...form, [o.name]: v })}
            />
          ))}
          <Workspaces row={row} ticks={ticks} setTicks={setTicks} />
          <FieldError id={`pipeline-${row.id}-error`}>{error}</FieldError>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <SubmitButton pending={save.isPending} disabled={!body}>
              Save pipeline
            </SubmitButton>
          </div>
        </FieldGroup>
      </form>
    </Part>
  );
}

/** One field, made from the option's spec. */
function OptionField({
  id,
  option,
  value,
  onChange,
}: {
  id: string;
  option: PipelineOption;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { spec } = option;
  if (spec.type === 'bool') {
    return (
      <Field orientation="horizontal">
        <Switch
          id={id}
          checked={value === true}
          onCheckedChange={(on) => onChange(on)}
          aria-describedby={hintId(id)}
        />
        <div className="space-y-1">
          <FieldLabel htmlFor={id}>{spec.label}</FieldLabel>
          <FieldHint id={id}>{spec.help ?? `Default ${spec.default ? 'on' : 'off'}.`}</FieldHint>
        </div>
      </Field>
    );
  }
  if (spec.type === 'number') {
    return (
      <Field>
        <FieldLabel htmlFor={id}>{spec.label}</FieldLabel>
        <Input
          id={id}
          type="number"
          min={spec.min}
          max={spec.max}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          aria-describedby={hintId(id)}
        />
        <FieldHint id={id}>
          {spec.help ? `${spec.help} ` : ''}From {spec.min} to {spec.max}; default {spec.default}.
        </FieldHint>
      </Field>
    );
  }
  const words = Array.isArray(value) ? (value as string[]) : [];
  return (
    <Field>
      {/* TagInput owns no single focusable id, so the label is a span. */}
      <FieldLabel asChild>
        <span>{spec.label}</span>
      </FieldLabel>
      <TagInput
        value={words}
        onChange={onChange}
        normalize={wordOf}
        max={spec.maxItems}
        maxLength={spec.maxChars}
        label={spec.label}
        placeholder="Add a word: comma or Enter"
      />
      <FieldHint id={id}>
        {spec.help ? `${spec.help} ` : ''}At most {spec.maxItems} words of {spec.maxChars}{' '}
        characters.
      </FieldHint>
    </Field>
  );
}

/** A reader is used everywhere; an `after` pipeline gets a tick for each
 *  workspace. No tick: it does nothing. */
function Workspaces({
  row,
  ticks,
  setTicks,
}: {
  row: PipelineRow;
  ticks: string[] | null;
  setTicks: (t: string[]) => void;
}) {
  const workspaces = useWorkspaces();
  if (row.workspaces === 'all' || ticks === null) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">Workspaces</p>
        <p className="text-sm text-muted-foreground">{READER_EVERYWHERE}</p>
      </div>
    );
  }
  const list = (workspaces.data ?? []).filter((w) => !w.archived || ticks.includes(w.id));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Workspaces</legend>
      {workspaces.isPending ? (
        <Spinner size={14} label="Loading workspaces" />
      ) : (
        <ul className="space-y-2">
          {list.map((w) => {
            const id = `pipeline-${row.id}-ws-${w.id}`;
            const on = ticks.includes(w.id);
            return (
              <li key={w.id} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={on}
                  onCheckedChange={(c) =>
                    setTicks(c === true ? [...ticks, w.id] : ticks.filter((x) => x !== w.id))
                  }
                />
                <label htmlFor={id} className="text-sm">
                  {w.name}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {ticks.length === 0 && <p className="text-sm text-muted-foreground">{ATTACHED_NONE}</p>}
    </fieldset>
  );
}

/** The search of the test picker, once the term stops changing. */
function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function TestPart({ row, form }: { row: PipelineRow; form: Form }) {
  const [q, setQ] = useState('');
  const [file, setFile] = useState<FileSearchHit | null>(null);
  const term = useDebounced(q.trim(), 300);
  const hits = useQuery({
    queryKey: ['pipelines', 'test-files', term],
    queryFn: () =>
      apiFetch<{ results: FileSearchHit[] }>(searchUrl(term)).then((r) => fileHitsOnly(r.results)),
    enabled: term.length >= 2,
    staleTime: 30_000,
  });
  const run = useMutation({
    mutationFn: (fileId: string) =>
      apiSend<PipelineTestResult>(`${pipelinePath(row.id)}/test`, 'POST', {
        fileId,
        ...(row.options.length > 0 ? { options: form } : {}),
      }),
  });
  const fits = (hits.data ?? []).filter((h) => takesFile(row, h.title));
  const searchId = `pipeline-${row.id}-test-file`;
  return (
    <Part
      title="Test"
      hint="Run this pipeline on one file with the options in the form, saved or not."
    >
      <div className="space-y-4">
        <Field>
          <FieldLabel htmlFor={searchId}>File</FieldLabel>
          <Input
            id={searchId}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search a ${readsText(row.reads)} file`}
            aria-describedby={hintId(searchId)}
          />
          <FieldHint id={searchId}>
            {file ? `Picked: ${file.title}` : 'Type two letters or more of its name.'}
          </FieldHint>
        </Field>
        {term.length >= 2 && (
          <ul
            className="-mx-1 max-h-48 space-y-1 overflow-y-auto px-1 scrollbar-thin"
            aria-label="Files"
          >
            {hits.isPending ? (
              <li>
                <Spinner size={14} label="Searching" />
              </li>
            ) : fits.length === 0 ? (
              <li className="text-sm text-muted-foreground">No file of this kind matches.</li>
            ) : (
              fits.map((h) => (
                <li key={h.id}>
                  <RowButton
                    className={cn(
                      'w-full rounded-md px-2 py-1.5 text-sm hover:bg-accent',
                      file?.id === h.id && 'bg-accent',
                    )}
                    aria-pressed={file?.id === h.id}
                    onClick={() => setFile(h)}
                  >
                    <span className="font-medium">{h.title}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{h.path}</span>
                  </RowButton>
                </li>
              ))
            )}
          </ul>
        )}
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!file || run.isPending}
            onClick={() => file && run.mutate(file.id)}
          >
            {run.isPending && <Spinner size={14} label="Running" />}
            Run test
          </Button>
        </div>
        {run.isError && (
          <p role="alert" className="text-sm text-destructive-ink">
            {errText(run.error)}
          </p>
        )}
        {run.data && <TestResult result={run.data} />}
      </div>
    </Part>
  );
}

/** A test's result: status, time, each tab with its first rows, the
 *  warnings, the fixed word; and that nothing was written. Exported for its
 *  render test. */
export function TestResult({ result }: { result: PipelineTestResult }) {
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-medium">{testStatusText(result)}</span>
        <span className="text-muted-foreground">
          {' '}
          in {result.ms.toLocaleString('en-US')} ms, {result.pipeline} {result.version}
        </span>
      </p>
      {result.word && (
        <p className="text-sm text-muted-foreground">
          No result: <span className="font-mono">{result.word}</span>
        </p>
      )}
      {result.warnings.length > 0 && (
        <ul className="space-y-1 text-sm text-warning-ink">
          {result.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {result.tabs.map((tab) => (
        <div key={tab.name} className="space-y-1">
          <p className="text-sm font-medium">
            {tab.name}{' '}
            <span className="font-normal text-muted-foreground">
              {tab.rows.toLocaleString('en-US')} {tab.rows === 1 ? 'row' : 'rows'}
            </span>
          </p>
          <Table aria-label={tab.name} className="text-xs">
            <TableHeader>
              <TableRow>
                {tab.columns.map((c) => (
                  <TableHead key={c}>{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tab.first.map((cells, i) => (
                <TableRow key={i}>
                  {tab.columns.map((c, j) => (
                    <TableCell key={c} className="max-w-48 truncate">
                      {cellText(cells[j])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
      <p className="text-sm text-muted-foreground">{NOTHING_WRITTEN}</p>
    </div>
  );
}
