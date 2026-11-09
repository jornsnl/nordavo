"use client";

import { useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import {
  importCompanies,
  importContacts,
  importSignals,
} from "@/app/dashboard/import/call-list-actions";
import { dedupeContacts, parseCallList, type ParsedCallList, type Sheet } from "@/lib/sales/call-list-import";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

const CHUNK = 150;

type Totals = { companiesCreated: number; companiesUpdated: number; contactsCreated: number; contactsUpdated: number; contactsSkipped: number; signalsCreated: number; signalsUpdated: number };

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const tabLabels: Record<string, string> = {
  bellen: "Bellen",
  vacatures: "Vacatures",
  overig: "Overige contacten",
  verrijken: "Nog verrijken",
};

/**
 * Imports the current call list (Nordavo_bellijst_4.xlsx) in one go: the tabs
 * Bellen, Vacatures, Overige contacten and Nog verrijken. The file is read in
 * the browser; the portal only receives the rows, and merges duplicates.
 */
export function CallListImport() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCallList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ step: string; done: number; total: number } | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);

  const read = async (file: File) => {
    setError(null);
    setTotals(null);
    setParsed(null);
    setFileName(file.name);
    try {
      const { default: readExcelFile } = await import("read-excel-file/browser");
      const sheets = (await readExcelFile(file)) as unknown as Sheet[];
      const result = parseCallList(sheets);
      result.contacts = dedupeContacts(result.contacts);
      if (result.companies.length === 0) {
        setError("No companies found. Check that the file has the tabs Bellen, Vacatures, Overige contacten or Nog verrijken with a header row.");
        return;
      }
      setParsed(result);
    } catch (e) {
      setError(e instanceof Error ? `This file could not be read: ${e.message}` : "This file could not be read.");
    }
  };

  const run = async () => {
    if (!parsed) return;
    setError(null);
    const t: Totals = { companiesCreated: 0, companiesUpdated: 0, contactsCreated: 0, contactsUpdated: 0, contactsSkipped: 0, signalsCreated: 0, signalsUpdated: 0 };
    const total = parsed.companies.length + parsed.contacts.length + parsed.signals.length;
    let done = 0;

    // Lead status from the contacts: called before is In sequence, only contacts without a number is Enrich.
    const byCompany = new Map<string, typeof parsed.contacts>();
    for (const c of parsed.contacts) byCompany.set(c.companyKey, [...(byCompany.get(c.companyKey) ?? []), c]);
    const leadStatus = (key: string) => {
      const list = byCompany.get(key) ?? [];
      if (list.some((c) => c.attempts > 0 || ["in_outreach", "reached"].includes(c.status))) return "in_sequence" as const;
      if (list.length > 0 && list.every((c) => c.status === "enrich")) return "enrich" as const;
      return list.length > 0 ? ("ready" as const) : undefined;
    };

    const ids: Record<string, string> = {};
    for (const block of chunks(parsed.companies)) {
      setProgress({ step: "Companies", done, total });
      const result = await importCompanies(block.map((c) => ({ ...c, leadStatus: leadStatus(c.key) })));
      if (!result.ok) return setError(result.error), setProgress(null);
      Object.assign(ids, result.ids);
      t.companiesCreated += result.created;
      t.companiesUpdated += result.updated;
      done += block.length;
    }
    const contacts = parsed.contacts.flatMap((c) => {
      const companyId = ids[c.companyKey];
      if (!companyId) return [];
      const { companyKey: _key, tab: _tab, ...rest } = c;
      void _key;
      void _tab;
      return [{ ...rest, companyId }];
    });
    for (const block of chunks(contacts)) {
      setProgress({ step: "Contacts", done, total });
      const result = await importContacts(block);
      if (!result.ok) return setError(result.error), setProgress(null);
      t.contactsCreated += result.created;
      t.contactsUpdated += result.updated;
      t.contactsSkipped += result.skipped;
      done += block.length;
    }
    const signals = parsed.signals.flatMap((s) => {
      const companyId = ids[s.companyKey];
      if (!companyId) return [];
      const { companyKey: _key, ...rest } = s;
      void _key;
      return [{ ...rest, companyId }];
    });
    for (const block of chunks(signals)) {
      setProgress({ step: "Vacancies", done, total });
      const result = await importSignals(block);
      if (!result.ok) return setError(result.error), setProgress(null);
      t.signalsCreated += result.created;
      t.signalsUpdated += result.updated;
      done += block.length;
    }
    setProgress(null);
    setTotals(t);
  };

  return (
    <Card className="mb-6">
      <CardHeader
        title="Call list (Excel)"
        description="Brings Nordavo_bellijst_4.xlsx in at once: Bellen, Vacatures, Overige contacten and Nog verrijken. Running it again creates no duplicates; existing records are only filled in."
      />
      <CardBody className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-surface px-6 py-8 text-center text-sm text-muted hover:border-brand-200">
          <FileSpreadsheet className="size-8 text-brand-700" aria-hidden="true" />
          <span className="font-semibold text-brand-900">{fileName ?? "Choose the Excel file"}</span>
          <span>.xlsx, read in your browser</span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void read(file);
            }}
          />
        </label>

        {parsed && !totals && (
          <div className="space-y-3">
            <ul className="grid gap-2 text-sm sm:grid-cols-2">
              {parsed.tabs.map((t) => (
                <li key={t.tab} className="rounded-xl border border-border px-3 py-2">
                  <span className="font-semibold">{tabLabels[t.tab] ?? t.tab}</span>
                  {t.sheet ? (
                    <span className="block text-muted">
                      {t.rows} rows{t.skipped.length > 0 ? `, ${t.skipped.length} skipped` : ""}
                    </span>
                  ) : (
                    <span className="block text-amber-700">Tab not found</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-sm">
              Found <strong>{parsed.companies.length}</strong> companies, <strong>{parsed.contacts.length}</strong> contacts
              (of which {parsed.contacts.filter((c) => c.role !== "main").length} Extra or Reserve and{" "}
              {parsed.contacts.filter((c) => c.status === "enrich").length} without a number to enrich) and{" "}
              <strong>{parsed.signals.length}</strong> vacancies.
            </p>
            {Object.keys(parsed.unknownColumns).length > 0 && (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">Columns that are not imported</summary>
                <ul className="mt-1 space-y-1">
                  {Object.entries(parsed.unknownColumns).map(([sheet, cols]) => (
                    <li key={sheet}>
                      {sheet}: {cols.join(", ")}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <Button onClick={run} disabled={Boolean(progress)}>
              <Upload aria-hidden="true" />
              {progress ? `${progress.step}: ${progress.done} of ${progress.total}` : "Import"}
            </Button>
            {progress && (
              <div className="h-2 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                <div className="h-full bg-brand-700 transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
              </div>
            )}
          </div>
        )}

        {totals && (
          <p role="status" className="rounded-xl border border-emerald-600/20 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Done. Companies: {totals.companiesCreated} new, {totals.companiesUpdated} filled in. Contacts: {totals.contactsCreated} new,{" "}
            {totals.contactsUpdated} filled in{totals.contactsSkipped > 0 ? `, ${totals.contactsSkipped} already there` : ""}. Vacancies:{" "}
            {totals.signalsCreated} new, {totals.signalsUpdated} already there.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
