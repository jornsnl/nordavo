import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Table2 } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { FormNav } from "@/components/forms/form-nav";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { answerText } from "@/lib/forms/answers";
import { ctcBreakdown, formatEur, formatInr, hourlyBreakdown } from "@/lib/forms/compensation";
import { getCurrentRate, getResponses, getVacancyBasics, getVacancyForm } from "@/lib/forms/data";
import { filterAndSort, type TableQuery } from "@/lib/forms/responses";
import type { Question } from "@/lib/forms/schema";
import { applicationStages, optionFor } from "@/lib/labels";

export const metadata: Metadata = {
  title: "Responses",
};

/** Every question a column, with filtering and sorting on the answers. */
export default function Page({ params, searchParams }: PageProps<"/dashboard/vacancies/[id]/responses">) {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <Responses params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const viaLabels = { general: "General link", headhunted: "Headhunted link", personal: "Personal link" } as const;

async function Responses({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const vacancy = await getVacancyBasics(id);
  if (!vacancy) notFound();
  const vf = await getVacancyForm(vacancy.id);

  if (!vf) {
    return (
      <>
        <FormNav vacancyId={vacancy.id} active="responses" />
        <PageHeader eyebrow="Responses" title={vacancy.title} />
        <EmptyState icon={Table2} title="No form yet" description="Create the application form for this vacancy first." />
        <ButtonLink href={`/dashboard/vacancies/${vacancy.id}/form`} className="mt-4">
          Create the form
        </ButtonLink>
      </>
    );
  }

  const [{ questions, rows }, rate] = await Promise.all([getResponses(vacancy.id, vf.form.id), getCurrentRate()]);
  const columns = questions.filter((q) => q.label);

  const one = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : undefined);
  const filters: Record<string, string> = {};
  for (const q of columns) {
    const value = one(`f_${q.id}`);
    if (value) filters[q.id] = value.slice(0, 100);
  }
  const tableQuery: TableQuery = { sort: one("sort"), dir: one("dir") === "desc" ? "desc" : "asc", filters };
  const shown = filterAndSort(rows, columns, tableQuery);

  function sortHref(key: string) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) params.set(`f_${k}`, v);
    const dir = tableQuery.sort === key && tableQuery.dir === "asc" ? "desc" : "asc";
    params.set("sort", key);
    params.set("dir", dir);
    return `?${params.toString()}`;
  }

  return (
    <>
      <FormNav vacancyId={vacancy.id} active="responses" />
      <PageHeader
        eyebrow={vacancy.clientName ?? "Responses"}
        title={vacancy.title}
        description={`${rows.length} ${rows.length === 1 ? "response" : "responses"}${shown.length !== rows.length ? `, ${shown.length} shown` : ""}. Every question is a column; filter below a heading and click a heading to sort. Numbers take filters like >=5 or 3-6.`}
      />

      {rows.length === 0 ? (
        <>
          <EmptyState icon={Table2} title="No responses yet" description="Responses appear here as soon as candidates fill in the form." />
          <ButtonLink href={`/dashboard/vacancies/${vacancy.id}/form/tracking`} className="mt-4">
            Send the form
          </ButtonLink>
        </>
      ) : (
        <Card className="overflow-hidden">
          <form method="get" className="relative max-h-[75dvh] overflow-auto">
            {tableQuery.sort && <input type="hidden" name="sort" value={tableQuery.sort} />}
            {tableQuery.sort && <input type="hidden" name="dir" value={tableQuery.dir} />}
            <table className="w-max min-w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-surface text-xs font-semibold tracking-wide text-muted">
                <tr className="border-b border-border">
                  <SortHeader label="Candidate" sortKey="name" query={tableQuery} href={sortHref("name")} sticky />
                  <th scope="col" className="px-3 py-2 uppercase">Stage</th>
                  <SortHeader label="Submitted" sortKey="submitted" query={tableQuery} href={sortHref("submitted")} />
                  {columns.map((q) => (
                    <SortHeader key={q.id} label={q.label} sortKey={q.id} query={tableQuery} href={sortHref(q.id)} removed={q.removed} />
                  ))}
                </tr>
                <tr className="border-b border-border">
                  <th className="sticky left-0 z-10 bg-surface px-3 py-2">
                    <span className="flex gap-1">
                      <Button type="submit" size="sm">
                        Filter
                      </Button>
                      {Object.keys(filters).length > 0 && (
                        <ButtonLink href="?" size="sm" variant="ghost">
                          Clear
                        </ButtonLink>
                      )}
                    </span>
                  </th>
                  <th />
                  <th />
                  {columns.map((q) => (
                    <th key={q.id} className="px-3 py-2 font-normal normal-case">
                      <FilterInput question={q} value={filters[q.id] ?? ""} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((row) => {
                  const stage = optionFor(applicationStages, row.stage);
                  return (
                    <tr key={row.id} className="align-top hover:bg-brand-50/40">
                      <td className="sticky left-0 bg-card px-3 py-2.5">
                        <Link href={`/dashboard/candidates/${row.candidateId}`} className="font-medium whitespace-nowrap text-brand-900 hover:underline">
                          {row.candidateName}
                        </Link>
                        <span className="block text-xs whitespace-nowrap text-muted">{viaLabels[row.via]}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Link href={`/dashboard/vacancies/${vacancy.id}/pipeline?application=${row.id}`}>
                          <Badge tone={stage.tone}>{stage.label}</Badge>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted">{formatDate(row.submittedAt)}</td>
                      {columns.map((q) => (
                        <td key={q.id} className="max-w-72 px-3 py-2.5">
                          <Cell question={q} value={row.answers[q.id]} rate={rate?.inrPerEur ?? null} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </form>
        </Card>
      )}
    </>
  );
}

function SortHeader({
  label,
  sortKey,
  query,
  href,
  sticky,
  removed,
}: {
  label: string;
  sortKey: string;
  query: TableQuery;
  href: string;
  sticky?: boolean;
  removed?: boolean;
}) {
  const active = query.sort === sortKey;
  const Icon = !active ? ArrowUpDown : query.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <th
      scope="col"
      aria-sort={active ? (query.dir === "desc" ? "descending" : "ascending") : undefined}
      className={`max-w-72 min-w-36 px-3 py-2 align-bottom ${sticky ? "sticky left-0 z-10 bg-surface" : ""}`}
    >
      <Link href={href} className="inline-flex items-start gap-1 hover:text-brand-700">
        <span className="line-clamp-2">{label}</span>
        <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      </Link>
      {removed && <span className="block font-normal text-muted/80 normal-case">no longer in the form</span>}
    </th>
  );
}

function FilterInput({ question: q, value }: { question: Question; value: string }) {
  const name = `f_${q.id}`;
  const cls =
    "w-full min-w-28 rounded-lg border border-border bg-white px-2 py-1 text-xs text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
  if (q.type === "yes_no") {
    return (
      <select name={name} defaultValue={value} className={cls} aria-label={`Filter ${q.label}`}>
        <option value="">Any</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
        <option value="(empty)">Empty</option>
      </select>
    );
  }
  if (q.type === "single_choice" || q.type === "multiple_choice") {
    return (
      <select name={name} defaultValue={value} className={cls} aria-label={`Filter ${q.label}`}>
        <option value="">Any</option>
        {q.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value="(empty)">Empty</option>
      </select>
    );
  }
  if (q.type === "file") return null;
  const numeric = q.type === "number" || q.type === "current_ctc" || q.type === "expected_ctc" || q.type === "hourly_rate";
  return <input type="search" name={name} defaultValue={value} placeholder={numeric ? ">=, <=, a-b" : "Contains"} className={cls} aria-label={`Filter ${q.label}`} />;
}

function Cell({ question: q, value, rate }: { question: Question; value: unknown; rate: number | null }) {
  if (value === undefined || value === null || value === "") return <span className="text-muted/60">-</span>;

  if (q.type === "file" && typeof value === "object" && value && "attachment_id" in value) {
    const file = value as { attachment_id: string; file_name?: string };
    return (
      <a
        href={`/dashboard/forms/attachments/${file.attachment_id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-brand-700 hover:underline"
      >
        <FileText className="size-4" aria-hidden="true" />
        {file.file_name ?? "File"}
      </a>
    );
  }
  if ((q.type === "current_ctc" || q.type === "expected_ctc") && typeof value === "number") {
    const b = ctcBreakdown(value, rate);
    return (
      <span className="whitespace-nowrap">
        {formatInr(b.perYearInr)} <span className="text-muted">/yr</span>
        <span className="block text-xs text-muted">
          {formatInr(b.perMonthInr)}/mo{b.perMonthEur !== null ? `, ${formatEur(b.perMonthEur)}/mo` : ""}
        </span>
      </span>
    );
  }
  if (q.type === "hourly_rate" && typeof value === "number") {
    const b = hourlyBreakdown(value, rate);
    return (
      <span className="whitespace-nowrap">
        {formatInr(b.perHourInr)} <span className="text-muted">/hr</span>
        {b.perHourEur !== null && <span className="block text-xs text-muted">{formatEur(b.perHourEur)}/hr</span>}
      </span>
    );
  }
  if (q.type === "yes_no" && typeof value === "boolean") {
    const mismatch = q.expected && (q.expected === "yes") !== value;
    return <Badge tone={mismatch ? "danger" : value ? "success" : "neutral"}>{value ? "Yes" : "No"}</Badge>;
  }
  if (q.type === "url" && typeof value === "string") {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-700 hover:underline">
        {value.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}
      </a>
    );
  }
  const text = answerText(value);
  return <span className={q.type === "long_text" ? "line-clamp-4 whitespace-pre-line" : ""} title={text.length > 120 ? text : undefined}>{text}</span>;
}
