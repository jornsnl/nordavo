"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Copy, ExternalLink, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { sheetToTsv, type SheetRow } from "@/lib/sales/call-sheet";
import { dialHref, dialsInBrowser } from "@/lib/sales/telephony";

/**
 * The call list as a spreadsheet (feedback Julius, 896704e2): one row per
 * contact with company, contact, phone, opening line, open roles, number of
 * vacancies, days open and links. Next to the call screen; outcomes are
 * logged there. leadLinks: the team opens the lead page, callers do not.
 */
export function CallSheet({
  rows,
  dialTemplate,
  leadLinks,
  callHref,
}: {
  rows: SheetRow[];
  dialTemplate: string | null;
  leadLinks: boolean;
  /** The call screen for this list. */
  callHref: string;
}) {
  const [search, setSearch] = useState("");
  const [onlyCallable, setOnlyCallable] = useState(false);
  const [copied, setCopied] = useState(false);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!onlyCallable || r.callable) &&
        (!q || [r.company, r.contact, r.title, r.openingLine, r.roles.join(" ")].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [rows, search, onlyCallable]);
  const callableCount = rows.filter((r) => r.callable).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search the call list"
          placeholder="Search company, contact, role"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 min-w-48 flex-1 rounded-xl border border-border bg-white px-3 text-sm sm:max-w-80"
        />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={onlyCallable} onChange={(e) => setOnlyCallable(e.target.checked)} />
          Only who I can call now ({callableCount})
        </label>
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(sheetToTsv(shown));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          <Copy aria-hidden="true" />
          {copied ? "Copied" : "Copy for Excel"}
        </Button>
        <span className="text-xs text-muted tabular-nums">
          {shown.length} of {rows.length} contacts
        </span>
      </div>

      <div className="max-h-[calc(100dvh-18rem)] min-h-80 overflow-auto rounded-2xl border border-border bg-card shadow-xs">
        <table className="w-max min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface text-left text-xs font-semibold tracking-wide text-brand-900 uppercase">
            <tr>
              {["#", "Company", "Contact", "Phone", "Opening line", "Open roles", "Vacancies", "Days open", "Links", "Status"].map((h) => (
                <th key={h} scope="col" className="border-b border-border px-3 py-2 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-muted">
                  Nobody on this list matches.
                </td>
              </tr>
            )}
            {shown.map((r, i) => {
              const href = r.phone ? dialHref(r.phone, dialTemplate) : null;
              return (
                <tr key={r.contactId} className={`border-b border-border/70 align-top ${r.callable ? "" : "text-muted"}`}>
                  <td className="px-3 py-2 text-xs tabular-nums">{i + 1}</td>
                  <td className="max-w-56 px-3 py-2">
                    {leadLinks ? (
                      <Link href={`/dashboard/leads/${r.companyId}`} className="font-medium text-brand-800 hover:underline">
                        {r.company}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">{r.company}</span>
                    )}
                    {r.redFlags.length > 0 && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-danger" title={r.redFlags.join(", ")}>
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        {r.redFlags.join(", ")}
                      </span>
                    )}
                  </td>
                  <td className="max-w-48 px-3 py-2">
                    <span className="block font-medium text-ink">{r.contact}</span>
                    {r.title && <span className="block text-xs text-muted">{r.title}</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {href ? (
                      <a
                        href={href}
                        {...(dialsInBrowser(href) ? { target: "_blank", rel: "noreferrer" } : {})}
                        className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                      >
                        <Phone className="size-3.5" aria-hidden="true" />
                        {r.phone}
                      </a>
                    ) : (
                      <span className="text-xs text-muted">No number</span>
                    )}
                    {r.phoneKind === "general" && <span className="block text-xs text-muted">General number</span>}
                  </td>
                  <td className="max-w-80 px-3 py-2 text-xs whitespace-pre-line">{r.openingLine ?? ""}</td>
                  <td className="max-w-64 px-3 py-2 text-xs">{r.roles.join(", ")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.vacancyCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.daysOpen ?? ""}</td>
                  <td className="max-w-56 px-3 py-2 text-xs">
                    <ul className="space-y-0.5">
                      {r.links.map((l) => (
                        <li key={l.url}>
                          <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                            <span className="max-w-44 truncate">{l.label}</span>
                            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {r.callable ? <Badge tone="success">Can call now</Badge> : <Badge>Not now</Badge>}
                    <span className="mt-0.5 block">
                      {r.attempts === 0 ? "Not called" : `${r.attempts} ${r.attempts === 1 ? "attempt" : "attempts"}`}
                      {r.lastAttemptAt ? `, last ${formatDate(r.lastAttemptAt)}` : ""}
                    </span>
                    {r.callbackAt && <span className="block">Call back {formatDate(r.callbackAt)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Log the outcome of a call on the{" "}
        <Link href={callHref} className="font-medium text-brand-600 hover:underline">
          call screen
        </Link>
        : it holds the contact for you and applies the call rules.
      </p>
    </div>
  );
}
