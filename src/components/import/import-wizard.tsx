"use client";

import { useId, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { FileSpreadsheet, LoaderCircle, Play, RotateCcw, Square, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { LeadImportMapping, LeadImportResult } from "@/lib/gtm/import";
import {
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedin,
  normalizePhone,
  phoneTypeFor,
  splitName,
} from "@/lib/gtm/normalize";
import { guessMappingAction, importChunkAction } from "@/app/dashboard/import/actions";

const CHUNK_SIZE = 500;
const PREVIEW_ROWS = 10;

type Row = Record<string, string>;
type MappingKey = keyof LeadImportMapping;

const FIELDS: { key: MappingKey; label: string; hint?: string; group: "bedrijf" | "contact" | "historie" }[] = [
  { key: "domain", label: "Domain or website", hint: "Required. Rows without a domain are skipped.", group: "bedrijf" },
  { key: "company_name", label: "Company name", group: "bedrijf" },
  { key: "legal_form", label: "Legal form", group: "bedrijf" },
  { key: "employees", label: "Employees", group: "bedrijf" },
  { key: "sector", label: "Sector", group: "bedrijf" },
  { key: "city", label: "City", group: "bedrijf" },
  { key: "company_linkedin", label: "LinkedIn company", group: "bedrijf" },
  { key: "full_name", label: "Full name", hint: "Or use first name and last name.", group: "contact" },
  { key: "first_name", label: "First name", group: "contact" },
  { key: "last_name", label: "Last name", group: "contact" },
  { key: "title", label: "Job title", group: "contact" },
  { key: "person_linkedin", label: "LinkedIn person", group: "contact" },
  { key: "email", label: "Email address", group: "contact" },
  { key: "phone", label: "Phone", group: "contact" },
  { key: "last_contacted_at", label: "Last contacted on", hint: "Becomes an activity and counts towards the 30 day rule.", group: "historie" },
  { key: "contact_channel", label: "Channel", hint: "Call or mail. Empty means call.", group: "historie" },
  { key: "contact_outcome", label: "Outcome", hint: "Added as a note on the activity.", group: "historie" },
];

const GROUPS = [
  { id: "bedrijf", title: "Company" },
  { id: "contact", title: "Contact" },
  { id: "historie", title: "Contacted before" },
] as const;

type Totals = Omit<LeadImportResult, "skipped">;

const EMPTY_TOTALS: Totals = {
  rows: 0,
  companiesCreated: 0,
  companiesUpdated: 0,
  contactsCreated: 0,
  contactsUpdated: 0,
  activitiesCreated: 0,
};

type Parsed = { fileName: string; headers: string[]; rows: Row[] };

type RunState = {
  status: "idle" | "running" | "stopped" | "failed" | "done";
  /** Rows sent and processed so far; the next chunk starts here. */
  processed: number;
  totals: Totals;
  skipped: { row: number; reason: string }[];
  error: string | null;
};

const INITIAL_RUN: RunState = { status: "idle", processed: 0, totals: EMPTY_TOTALS, skipped: [], error: null };

function defaultSource(fileName: string) {
  return `Sheet: ${fileName.replace(/\.(csv|tsv|txt)$/i, "")}`;
}

export function ImportWizard() {
  const fileId = useId();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [mapping, setMapping] = useState<Partial<LeadImportMapping>>({});
  const [source, setSource] = useState("");
  const [run, setRun] = useState<RunState>(INITIAL_RUN);
  const stopRef = useRef(false);

  function onFile(file: File | undefined) {
    setParseError(null);
    setParsed(null);
    setRun(INITIAL_RUN);
    if (!file) return;
    setParsing(true);
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: async (result) => {
        const headers = (result.meta.fields ?? []).filter(Boolean);
        if (headers.length === 0 || result.data.length === 0) {
          setParsing(false);
          setParseError("This file has no header row or no rows. Export the Sheet as CSV with column names on the first row.");
          return;
        }
        let guess: Partial<LeadImportMapping> = {};
        try {
          guess = await guessMappingAction(headers);
        } catch {
          // No suggestion: the user maps the columns by hand.
        }
        setParsing(false);
        const clean: Partial<LeadImportMapping> = {};
        for (const [key, value] of Object.entries(guess) as [MappingKey, string | undefined][]) {
          if (value && headers.includes(value)) clean[key] = value;
        }
        setParsed({ fileName: file.name, headers, rows: result.data });
        setMapping(clean);
        setSource(defaultSource(file.name));
      },
      error: (error) => {
        setParsing(false);
        setParseError(`The file could not be read: ${error.message}`);
      },
    });
  }

  const preview = useMemo(() => {
    if (!parsed) return [];
    const cell = (row: Row, key: MappingKey) => {
      const column = mapping[key];
      return column ? (row[column] ?? "").trim() : "";
    };
    return parsed.rows.slice(0, PREVIEW_ROWS).map((row) => {
      const fromFull = splitName(cell(row, "full_name"));
      const first = cell(row, "first_name") || fromFull.first || "";
      const last = cell(row, "last_name") || fromFull.last || "";
      const phone = normalizePhone(cell(row, "phone"));
      return {
        domain: normalizeDomain(cell(row, "domain")),
        company: cell(row, "company_name"),
        contact: [first, last].filter(Boolean).join(" "),
        title: cell(row, "title"),
        email: normalizeEmail(cell(row, "email")),
        phone,
        phoneType: phoneTypeFor(phone),
        linkedin: normalizeLinkedin(cell(row, "person_linkedin")),
        lastContacted: cell(row, "last_contacted_at"),
      };
    });
  }, [parsed, mapping]);

  const mappedColumns = useMemo(
    () => Array.from(new Set(Object.values(mapping).filter((v): v is string => Boolean(v)))),
    [mapping],
  );

  async function start(from: number) {
    if (!parsed || !mapping.domain) return;
    const fullMapping = mapping as LeadImportMapping;
    stopRef.current = false;
    let state: RunState = from === 0 ? { ...INITIAL_RUN, status: "running" } : { ...run, status: "running", error: null };
    setRun(state);

    for (let offset = from; offset < parsed.rows.length; offset += CHUNK_SIZE) {
      if (stopRef.current) {
        state = { ...state, status: "stopped" };
        setRun(state);
        return;
      }
      // Only send the mapped columns: smaller requests, no unrelated data on the server.
      const rows = parsed.rows.slice(offset, offset + CHUNK_SIZE).map((row) => {
        const out: Row = {};
        for (const column of mappedColumns) out[column] = (row[column] ?? "").slice(0, 5000);
        return out;
      });

      let response: Awaited<ReturnType<typeof importChunkAction>>;
      try {
        response = await importChunkAction({ rows, mapping: fullMapping, source: source.trim(), offset });
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
        totals: {
          rows: state.totals.rows + r.rows,
          companiesCreated: state.totals.companiesCreated + r.companiesCreated,
          companiesUpdated: state.totals.companiesUpdated + r.companiesUpdated,
          contactsCreated: state.totals.contactsCreated + r.contactsCreated,
          contactsUpdated: state.totals.contactsUpdated + r.contactsUpdated,
          activitiesCreated: state.totals.activitiesCreated + r.activitiesCreated,
        },
        skipped: [...state.skipped, ...r.skipped],
      };
      setRun(state);
    }
    setRun({ ...state, status: "done" });
  }

  const running = run.status === "running";
  const total = parsed?.rows.length ?? 0;
  const percent = total > 0 ? Math.round((run.processed / total) * 100) : 0;
  const canStart = Boolean(parsed && mapping.domain && source.trim()) && !running;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="1. Choose a CSV"
          description="Export the Google Sheet via File, Download, CSV. The first row must contain the column names."
        />
        <CardBody className="space-y-4">
          <label
            htmlFor={fileId}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-brand-200 bg-surface/50 px-6 py-8 text-center text-sm text-muted transition hover:border-brand-400 focus-within:outline-2 focus-within:outline-brand-500 active:bg-brand-50"
          >
            <Upload className="size-6 text-brand-600" aria-hidden="true" />
            <span className="font-medium text-ink">{parsed ? parsed.fileName : "Choose a CSV file"}</span>
            {parsed && (
              <span>
                {parsed.rows.length} rows, {parsed.headers.length} columns
              </span>
            )}
            <input
              id={fileId}
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              className="sr-only"
              disabled={running}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          {parsing && (
            <p className="flex items-center gap-2 text-sm text-muted" role="status">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Read file
            </p>
          )}
          <FormMessage error={parseError ?? undefined} />
          {parsed && (
            <div>
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Columns in this file</h3>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {parsed.headers.map((h) => (
                  <li key={h}>
                    <Badge tone={mappedColumns.includes(h) ? "brand" : "neutral"}>{h}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>

      {parsed && (
        <Card>
          <CardHeader
            title="2. Map the columns"
            description="Prefilled from the column names. Check it and fill in where needed."
          />
          <CardBody className="space-y-6">
            <Field
              label="Source"
              htmlFor="import-source"
              required
              hint="Stored on every company and contact, so you know which list it came from."
            >
              <Input
                id="import-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                disabled={running}
                maxLength={200}
                enterKeyHint="done"
              />
            </Field>
            {GROUPS.map((group) => (
              <fieldset key={group.id} className="space-y-3">
                <legend className="font-display text-sm font-semibold text-brand-900">{group.title}</legend>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {FIELDS.filter((f) => f.group === group.id).map((f) => (
                    <Field
                      key={f.key}
                      label={f.label}
                      htmlFor={`map-${f.key}`}
                      hint={f.hint}
                      required={f.key === "domain"}
                      error={f.key === "domain" && !mapping.domain ? "Choose the column with the domain." : undefined}
                    >
                      <Select
                        id={`map-${f.key}`}
                        value={mapping[f.key] ?? ""}
                        disabled={running}
                        aria-invalid={f.key === "domain" && !mapping.domain ? true : undefined}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined }))
                        }
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
              </fieldset>
            ))}
          </CardBody>
        </Card>
      )}

      {parsed && mapping.domain && (
        <section aria-labelledby="preview-title" className="space-y-3">
          <div>
            <h2 id="preview-title" className="font-display text-base font-semibold text-brand-900">
              3. Preview
            </h2>
            <p className="text-sm text-muted">
              The first {Math.min(PREVIEW_ROWS, parsed.rows.length)} rows as they will be saved: domain, email,
              phone and LinkedIn normalized.
            </p>
          </div>
          <MobileList label="Import preview" className="md:hidden">
            {preview.map((p, i) => (
              <MobileListItem
                key={i}
                title={p.domain ?? <Badge tone="danger">No domain, will be skipped</Badge>}
                subtitle={[p.company, p.contact, p.title].filter(Boolean).join(", ") || "No company or contact"}
                meta={
                  [p.email, p.phone ? `${p.phone}${p.phoneType ? ` (${p.phoneType})` : ""}` : null].filter(Boolean).join(", ") ||
                  "No email or phone"
                }
              >
                {(p.linkedin || p.lastContacted) && (
                  <p className="text-xs break-all text-muted">
                    {[p.linkedin, p.lastContacted ? `last contacted ${p.lastContacted}` : null].filter(Boolean).join(", ")}
                  </p>
                )}
              </MobileListItem>
            ))}
          </MobileList>
          <Table className="hidden md:block">
            <THead>
              <tr>
                <TH>Domain</TH>
                <TH>Company</TH>
                <TH>Contact</TH>
                <TH>Email</TH>
                <TH>Phone</TH>
                <TH>LinkedIn</TH>
                <TH>Last contacted</TH>
              </tr>
            </THead>
            <TBody>
              {preview.map((p, i) => (
                <TR key={i}>
                  <TD>{p.domain ?? <Badge tone="danger">No domain, will be skipped</Badge>}</TD>
                  <TD>{p.company || <span className="text-muted">Empty</span>}</TD>
                  <TD>
                    {p.contact || <span className="text-muted">No contact</span>}
                    {p.title && <p className="text-xs text-muted">{p.title}</p>}
                  </TD>
                  <TD className="break-all">{p.email ?? <span className="text-muted">None</span>}</TD>
                  <TD className="whitespace-nowrap">
                    {p.phone ? (
                      <>
                        {p.phone}
                        {p.phoneType && <span className="ml-1 text-xs text-muted">({p.phoneType})</span>}
                      </>
                    ) : (
                      <span className="text-muted">None</span>
                    )}
                  </TD>
                  <TD className="break-all">{p.linkedin ?? <span className="text-muted">None</span>}</TD>
                  <TD>{p.lastContacted || <span className="text-muted">Never</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      )}

      {parsed && (
        <Card>
          <CardHeader
            title="4. Import"
            description={`Duplicate companies and contacts are filled in, not created again. Processed in batches of ${CHUNK_SIZE} rows.`}
          />
          <CardBody className="space-y-4">
            {run.status !== "idle" && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-ink">
                    {run.processed} of {total} rows processed
                  </span>
                  <span className="text-muted tabular-nums">{percent}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Import progress"
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={run.processed}
                  className="h-2 overflow-hidden rounded-full bg-brand-100"
                >
                  <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${percent}%` }} />
                </div>
              </div>
            )}

            {run.status === "failed" && (
              <FormMessage
                error={`The import stopped after ${run.processed} processed rows: ${run.error ?? "unknown error"}. What was already processed stays.`}
              />
            )}
            {run.status === "stopped" && (
              <FormMessage error={`Stopped after ${run.processed} rows. What was already processed stays.`} />
            )}
            {run.status === "done" && <FormMessage success={`Done. All ${total} rows have been processed.`} />}

            {run.status !== "idle" && (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-live="polite">
                {[
                  { label: "Rows", value: run.totals.rows },
                  { label: "New companies", value: run.totals.companiesCreated },
                  { label: "Companies updated", value: run.totals.companiesUpdated },
                  { label: "New contacts", value: run.totals.contactsCreated },
                  { label: "Contacts updated", value: run.totals.contactsUpdated },
                  { label: "Activities", value: run.totals.activitiesCreated },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-border bg-surface/50 px-3 py-2">
                    <dt className="text-xs text-muted">{s.label}</dt>
                    <dd className="font-display text-lg font-semibold text-brand-900 tabular-nums">{s.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {running ? (
                <Button variant="secondary" onClick={() => (stopRef.current = true)}>
                  <Square aria-hidden="true" />
                  Stop after this batch
                </Button>
              ) : run.status === "failed" || run.status === "stopped" ? (
                <>
                  <Button onClick={() => start(run.processed)} disabled={!canStart}>
                    <RotateCcw aria-hidden="true" />
                    Continue with the remaining {total - run.processed} rows
                  </Button>
                  <Button variant="secondary" onClick={() => start(0)} disabled={!canStart}>
                    Start over
                  </Button>
                </>
              ) : run.status === "done" ? (
                <ButtonLink href="/dashboard/leads">Go to leads</ButtonLink>
              ) : (
                <Button onClick={() => start(0)} disabled={!canStart}>
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
          <CardHeader
            title={`Skipped rows (${run.skipped.length})`}
            description="These rows were not imported. The row number matches the Sheet, with the header row as row 1. Fix them and import again; duplicates are filled in."
          />
          <ul className="max-h-96 divide-y divide-border overflow-y-auto overscroll-contain">
            {run.skipped.slice(0, 1000).map((s, i) => (
              <li key={`${s.row}-${i}`} className="flex gap-3 px-5 py-2 text-sm">
                <span className="w-20 shrink-0 text-muted tabular-nums max-sm:w-16">Row {s.row}</span>
                <span className="text-ink">{s.reason}</span>
              </li>
            ))}
          </ul>
          {run.skipped.length > 1000 && (
            <CardBody className="border-t border-border text-sm text-muted">
              <FileSpreadsheet className="mr-1 inline size-4" aria-hidden="true" />
              Only the first 1000 are shown.
            </CardBody>
          )}
        </Card>
      )}
    </div>
  );
}
