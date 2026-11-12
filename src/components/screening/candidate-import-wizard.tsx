"use client";

import { useId, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Download, LoaderCircle, Play, RotateCcw, SearchCheck, Square, Upload } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Select } from "@/components/ui/field";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { CandidateOrigin, CandidateSource } from "@/lib/database.types";
import { candidateOrigins, candidateSources } from "@/lib/labels";
import {
  candidateFieldLabels,
  candidateImportFields,
  CandidateIndex,
  dedupeKeys,
  detectPreset,
  draftFromRow,
  guessCandidateMapping,
  IMPORT_CHUNK_SIZE,
  importPresets,
  presetById,
  type CandidateImportField,
  type CandidateImportMapping,
  type ImportPresetId,
} from "@/lib/screening/candidate-csv";
import type { CandidateImportReport } from "@/lib/screening/import";
import { checkImportDuplicatesAction, importCandidatesChunkAction, type ImportDuplicate } from "@/app/dashboard/vacancies/screening-actions";
import { candidateTemplateCsv, rowsFromSheet } from "@/lib/recruitment/import-template";

type Row = Record<string, string>;
type Parsed = { fileName: string; headers: string[]; rows: Row[] };
type Totals = { rows: number; created: number; matched: number };
type RunState = {
  status: "idle" | "running" | "stopped" | "failed" | "done";
  processed: number;
  totals: Totals;
  skipped: CandidateImportReport["skipped"];
  error: string | null;
};

const INITIAL: RunState = { status: "idle", processed: 0, totals: { rows: 0, created: 0, matched: 0 }, skipped: [], error: null };
const PREVIEW_ROWS = 10;

type DupState = { status: "idle" | "checking" | "done" | "failed"; checked: number; items: ImportDuplicate[]; error?: string };

function downloadTemplate() {
  const blob = new Blob([candidateTemplateCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nordavo-candidates-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Candidate import (2.6.1, 2.18): file (CSV or Excel), preset, mapping,
 * preview, duplicate check, import, report. With a vacancy the candidates
 * land in its pipeline as Sourced; without one (candidates list) they are
 * only added to the candidate list.
 */
export function CandidateImportWizard({ vacancyId = null }: { vacancyId?: string | null }) {
  const fileId = useId();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preset, setPreset] = useState<ImportPresetId>("sheet");
  const [mapping, setMapping] = useState<CandidateImportMapping>({});
  const [source, setSource] = useState<CandidateSource>("other");
  const [origin, setOrigin] = useState<CandidateOrigin>("applied");
  const [run, setRun] = useState<RunState>(INITIAL);
  const [dups, setDups] = useState<DupState>({ status: "idle", checked: 0, items: [] });
  const [skipNameMatches, setSkipNameMatches] = useState(true);
  const stopRef = useRef(false);

  function applyPreset(id: ImportPresetId, headers: string[]) {
    setPreset(id);
    const guess = guessCandidateMapping(headers, id);
    setMapping(guess);
    setSource(presetById(id).source);
  }

  async function onFile(file: File | undefined) {
    setParseError(null);
    setParsed(null);
    setRun(INITIAL);
    setDups({ status: "idle", checked: 0, items: [] });
    if (!file) return;
    if (/\.xlsx$/i.test(file.name)) {
      try {
        const { default: readExcelFile } = await import("read-excel-file/browser");
        // read-excel-file returns every sheet as { sheet, data }; the first sheet holds the candidates.
        const sheets = (await readExcelFile(file)) as unknown as { sheet: string; data: Parameters<typeof rowsFromSheet>[0] }[];
        const { headers, rows } = rowsFromSheet(sheets[0]?.data ?? []);
        if (headers.length === 0 || rows.length === 0) {
          setParseError("This sheet has no header row or no rows. Put the column names on the first row of the first sheet.");
          return;
        }
        setParsed({ fileName: file.name, headers, rows });
        applyPreset(detectPreset(headers), headers);
      } catch (error) {
        setParseError(`The Excel file could not be read: ${error instanceof Error ? error.message : "unknown error"}. Save it as CSV and try again.`);
      }
      return;
    }
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (result) => {
        const headers = (result.meta.fields ?? []).filter(Boolean);
        if (headers.length === 0 || result.data.length === 0) {
          setParseError("This file has no header row or no rows. Export the sheet as CSV with the column names on the first row.");
          return;
        }
        setParsed({ fileName: file.name, headers, rows: result.data });
        applyPreset(detectPreset(headers), headers);
      },
      error: (error) => setParseError(`The file could not be read: ${error.message}`),
    });
  }

  const hasName = Boolean(mapping.full_name || mapping.first_name || mapping.last_name);
  const mappedColumns = useMemo(() => [...new Set(Object.values(mapping).filter((v): v is string => Boolean(v)))], [mapping]);

  const preview = useMemo(() => {
    if (!parsed) return [];
    const index = new CandidateIndex();
    return parsed.rows.slice(0, PREVIEW_ROWS).map((row, i) => {
      const result = draftFromRow(row, mapping);
      if (!result.ok) return { row: i + 2, skip: result.reason } as const;
      const keys = dedupeKeys(result.draft);
      const dup = index.find(keys);
      index.add(String(i + 2), keys);
      return { row: i + 2, draft: result.draft, duplicateOf: dup?.id ?? null } as const;
    });
  }, [parsed, mapping]);

  /** Check all rows against existing candidates (contact details and name) before importing. */
  async function checkDuplicates() {
    if (!parsed || !hasName) return;
    let state: DupState = { status: "checking", checked: 0, items: [] };
    setDups(state);
    for (let offset = 0; offset < parsed.rows.length; offset += IMPORT_CHUNK_SIZE) {
      const drafts = parsed.rows.slice(offset, offset + IMPORT_CHUNK_SIZE).flatMap((row, i) => {
        const result = draftFromRow(row, mapping);
        return result.ok
          ? [{ row: offset + i + 2, full_name: result.draft.full_name, email: result.draft.email, phone: result.draft.phone, linkedin_url: result.draft.linkedin_url }]
          : [];
      });
      let response: Awaited<ReturnType<typeof checkImportDuplicatesAction>>;
      try {
        response = await checkImportDuplicatesAction(drafts);
      } catch {
        response = { ok: false, error: "The connection to the server was lost." };
      }
      if (!response.ok) {
        setDups({ ...state, status: "failed", error: response.error });
        return;
      }
      state = { ...state, checked: Math.min(parsed.rows.length, offset + IMPORT_CHUNK_SIZE), items: [...state.items, ...response.duplicates] };
      setDups(state);
    }
    setDups({ ...state, status: "done" });
  }

  async function start(from: number) {
    if (!parsed || !hasName) return;
    stopRef.current = false;
    let state: RunState = from === 0 ? { ...INITIAL, status: "running" } : { ...run, status: "running", error: null };
    setRun(state);
    for (let offset = from; offset < parsed.rows.length; offset += IMPORT_CHUNK_SIZE) {
      if (stopRef.current) {
        setRun({ ...state, status: "stopped" });
        return;
      }
      const rows = parsed.rows.slice(offset, offset + IMPORT_CHUNK_SIZE).map((row) => {
        const out: Row = {};
        for (const column of mappedColumns) out[column] = (row[column] ?? "").slice(0, 10000);
        return out;
      });
      let response: Awaited<ReturnType<typeof importCandidatesChunkAction>>;
      try {
        response = await importCandidatesChunkAction({ vacancyId, rows, mapping, source, origin, offset, skipNameMatches });
      } catch {
        response = { ok: false, error: "The connection to the server was lost." };
      }
      if (!response.ok) {
        state = { ...state, status: "failed", error: response.error };
        setRun(state);
        return;
      }
      const r = response.result;
      state = {
        ...state,
        processed: offset + rows.length,
        totals: { rows: state.totals.rows + r.rows, created: state.totals.created + r.created, matched: state.totals.matched + r.matched },
        skipped: [...state.skipped, ...r.skipped],
      };
      setRun(state);
    }
    setRun({ ...state, status: "done" });
  }

  const running = run.status === "running";
  const total = parsed?.rows.length ?? 0;
  const percent = total > 0 ? Math.round((run.processed / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="1. Choose a CSV or Excel file"
          description="A LinkedIn, Naukri or Manatal export, or a hiring sheet from Google Sheets or Excel (CSV or XLSX). The first row must hold the column names."
          actions={
            <Button variant="secondary" size="sm" onClick={downloadTemplate}>
              <Download aria-hidden="true" />
              Template
            </Button>
          }
        />
        <CardBody className="space-y-4">
          <label
            htmlFor={fileId}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-brand-200 bg-surface/50 px-6 py-8 text-center text-sm text-muted transition hover:border-brand-400 focus-within:outline-2 focus-within:outline-brand-500"
          >
            <Upload className="size-6 text-brand-600" aria-hidden="true" />
            <span className="font-medium text-ink">{parsed ? parsed.fileName : "Choose a CSV or Excel file"}</span>
            {parsed && (
              <span>
                {parsed.rows.length} rows, {parsed.headers.length} columns
              </span>
            )}
            <input id={fileId} type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={running} onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          <FormMessage error={parseError ?? undefined} />
        </CardBody>
      </Card>

      {parsed && (
        <Card>
          <CardHeader title="2. Source and columns" description="The kind of export is detected from the column names. Check the mapping and change it where needed." />
          <CardBody className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Kind of export" htmlFor="import-preset" hint="Changing it suggests the mapping again.">
                <Select id="import-preset" value={preset} disabled={running} onChange={(e) => applyPreset(e.target.value as ImportPresetId, parsed.headers)}>
                  {importPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Source" htmlFor="import-source" required hint="Stored on every candidate and application of this batch.">
                <Select id="import-source" value={source} disabled={running} onChange={(e) => setSource(e.target.value as CandidateSource)}>
                  {candidateSources.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Origin" htmlFor="import-origin" required hint="Headhunted: people we approached ourselves.">
                <Select id="import-origin" value={origin} disabled={running} onChange={(e) => setOrigin(e.target.value as CandidateOrigin)}>
                  {candidateOrigins.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {candidateImportFields.map((field: CandidateImportField) => (
                <Field
                  key={field}
                  label={candidateFieldLabels[field]}
                  htmlFor={`map-${field}`}
                  error={field === "full_name" && !hasName ? "Map the name, or first and last name." : undefined}
                >
                  <Select
                    id={`map-${field}`}
                    value={mapping[field] ?? ""}
                    disabled={running}
                    onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value || undefined }))}
                  >
                    <option value="">Do not import</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {parsed && hasName && (
        <section aria-labelledby="import-preview" className="space-y-3">
          <div>
            <h2 id="import-preview" className="font-display text-base font-semibold text-brand-900">
              3. Preview
            </h2>
            <p className="text-sm text-muted">
              The first {Math.min(PREVIEW_ROWS, total)} rows as they will be saved. Existing candidates (same email, phone or LinkedIn) are matched on import and only
              their empty fields are filled.
            </p>
          </div>
          <Table>
            <THead>
              <tr>
                <TH>Row</TH>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Phone</TH>
                <TH>Title</TH>
                <TH>Experience</TH>
                <TH>Skills</TH>
              </tr>
            </THead>
            <TBody>
              {preview.map((p) => (
                <TR key={p.row}>
                  <TD className="text-muted tabular-nums">{p.row}</TD>
                  {"skip" in p ? (
                    <TD colSpan={6}>
                      <Badge tone="danger">Skipped: {p.skip}</Badge>
                    </TD>
                  ) : (
                    <>
                      <TD>
                        {p.draft.full_name}
                        {p.duplicateOf && (
                          <span className="ml-2">
                            <Badge tone="warning">Same as row {p.duplicateOf}</Badge>
                          </span>
                        )}
                      </TD>
                      <TD className="break-all">{p.draft.email ?? <span className="text-muted">None</span>}</TD>
                      <TD className="whitespace-nowrap">{p.draft.phone ?? <span className="text-muted">None</span>}</TD>
                      <TD>{p.draft.current_title ?? <span className="text-muted">None</span>}</TD>
                      <TD className="tabular-nums">{p.draft.years_experience ?? <span className="text-muted">?</span>}</TD>
                      <TD className="max-w-xs truncate">{p.draft.skills.join(", ") || <span className="text-muted">None</span>}</TD>
                    </>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      )}

      {parsed && hasName && (
        <Card>
          <CardHeader
            title="4. Check for duplicates"
            description="Before saving: which rows match an existing candidate on email, phone, LinkedIn or name."
            actions={
              <Button variant="secondary" size="sm" onClick={() => void checkDuplicates()} disabled={dups.status === "checking" || running}>
                {dups.status === "checking" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <SearchCheck aria-hidden="true" />}
                {dups.status === "idle" ? "Check" : "Check again"}
              </Button>
            }
          />
          <CardBody className="space-y-3">
            {dups.status === "checking" && (
              <p className="text-sm text-muted" role="status">
                Checked {dups.checked} of {total} rows.
              </p>
            )}
            {dups.status === "failed" && <FormMessage error={dups.error} />}
            {dups.status === "done" && dups.items.length === 0 && <FormMessage success="No duplicates found. Every row becomes a new candidate." />}
            {dups.items.length > 0 && (
              <>
                <p className="text-sm text-ink">
                  {dups.items.filter((d) => d.contact).length} rows match an existing candidate on contact details: those are updated (only empty fields), not
                  created again. {dups.items.filter((d) => !d.contact).length} rows only share a name with an existing candidate.
                </p>
                <ul className="max-h-72 divide-y divide-border overflow-y-auto overscroll-contain rounded-xl border border-border text-sm">
                  {dups.items.slice(0, 500).map((d) => (
                    <li key={d.row} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="w-16 shrink-0 text-muted tabular-nums">Row {d.row}</span>
                      <span className="font-medium text-ink">{d.name}</span>
                      {d.contact ? (
                        <Badge tone="brand">Same {d.contact.on}: updates the existing candidate</Badge>
                      ) : (
                        <Badge tone="warning">Same name</Badge>
                      )}
                      {(d.contact ? [{ id: d.contact.id, full_name: "existing candidate" }] : d.sameName).slice(0, 3).map((m) => (
                        <Link key={m.id} href={`/dashboard/candidates/${m.id}`} target="_blank" className="text-xs text-brand-700 hover:underline">
                          Open {m.full_name}
                        </Link>
                      ))}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" checked={skipNameMatches} onChange={(e) => setSkipNameMatches(e.target.checked)} disabled={running} className="mt-0.5 size-4 accent-brand-700" />
              <span>
                <span className="font-medium text-ink">Skip rows that only share a name with an existing candidate</span>
                <span className="block text-xs text-muted">Untick when they are different people with the same name.</span>
              </span>
            </label>
          </CardBody>
        </Card>
      )}

      {parsed && (
        <Card>
          <CardHeader
            title="5. Import"
            description={
              vacancyId
                ? `Candidates go into this vacancy in stage Sourced. Sent in batches of ${IMPORT_CHUNK_SIZE} rows.`
                : `Candidates are added to the candidate list, without a vacancy. Sent in batches of ${IMPORT_CHUNK_SIZE} rows.`
            }
          />
          <CardBody className="space-y-4">
            {run.status !== "idle" && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>
                    {run.processed} of {total} rows processed
                  </span>
                  <span className="text-muted tabular-nums">{percent}%</span>
                </div>
                <div role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={run.processed} className="h-2 overflow-hidden rounded-full bg-brand-100">
                  <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${percent}%` }} />
                </div>
              </div>
            )}
            {run.status === "failed" && <FormMessage error={`The import stopped after ${run.processed} rows: ${run.error ?? "unknown error"}. What was imported stays.`} />}
            {run.status === "stopped" && <FormMessage error={`Stopped after ${run.processed} rows. What was imported stays.`} />}
            {run.status === "done" && <FormMessage success={`Done. All ${total} rows processed.`} />}
            {run.status !== "idle" && (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-live="polite">
                {[
                  { label: "Rows", value: run.totals.rows },
                  { label: "New candidates", value: run.totals.created },
                  { label: vacancyId ? "Existing, added" : "Existing, updated", value: run.totals.matched },
                  { label: "Skipped", value: run.skipped.length },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-border bg-surface/50 px-3 py-2">
                    <dt className="text-xs text-muted">{s.label}</dt>
                    <dd className="font-display text-lg font-semibold text-brand-900 tabular-nums">{s.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              {running ? (
                <Button variant="secondary" onClick={() => (stopRef.current = true)}>
                  <Square aria-hidden="true" />
                  Stop after this batch
                </Button>
              ) : run.status === "failed" || run.status === "stopped" ? (
                <Button onClick={() => start(run.processed)} disabled={!hasName}>
                  <RotateCcw aria-hidden="true" />
                  Continue with the remaining {total - run.processed} rows
                </Button>
              ) : run.status === "done" ? (
                <ButtonLink href={vacancyId ? `/dashboard/vacancies/${vacancyId}/pipeline` : "/dashboard/candidates"}>
                  {vacancyId ? "Open the pipeline" : "Open the candidates"}
                </ButtonLink>
              ) : (
                <Button onClick={() => start(0)} disabled={!hasName}>
                  <Play aria-hidden="true" />
                  Import {total} rows
                </Button>
              )}
              {running && (
                <p className="flex items-center gap-2 text-sm text-muted" role="status">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  Importing. Keep this tab open.
                </p>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {run.skipped.length > 0 && (
        <Card>
          <CardHeader title={`Skipped rows (${run.skipped.length})`} description="Row numbers match the file, with the header as row 1." />
          <ul className="max-h-96 divide-y divide-border overflow-y-auto overscroll-contain">
            {run.skipped.slice(0, 1000).map((s, i) => (
              <li key={`${s.row}-${i}`} className="flex gap-3 px-5 py-2 text-sm">
                <span className="w-20 shrink-0 text-muted tabular-nums">Row {s.row}</span>
                <span className="text-ink">{s.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
