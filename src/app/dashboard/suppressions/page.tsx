import type { Metadata } from "next";
import { Suspense } from "react";
import Form from "next/form";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { FilterSheet } from "@/components/leads/filter-sheet";
import { AddSuppressionButton } from "@/components/suppression/add-suppression-button";
import { SuppressionTable } from "@/components/suppression/suppression-table";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { isSuppressionReason, isSuppressionScope, listSuppressions, SUPPRESSION_LIST_LIMIT } from "@/lib/data/suppression";
import { suppressionReasons, suppressionScopes } from "@/lib/labels";

export const metadata: Metadata = {
  title: "Suppressions",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readFilters(params: Record<string, string | string[] | undefined>) {
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const reason = isSuppressionReason(params.reden) ? params.reden : undefined;
  const scope = isSuppressionScope(params.kanalen) ? params.kanalen : undefined;
  return { q, reason, scope };
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Suppressions"
        description="Anyone listed here is left off every call and mailing list for the chosen channels. Unsubscribes are added automatically."
        actions={<AddSuppressionButton />}
      />
      <Suspense fallback={<Skeleton className="mb-6 h-11 w-full" />}>
        <Filters searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Filters({ searchParams }: { searchParams: SearchParams }) {
  const { q, reason, scope } = readFilters(await searchParams);
  return (
    <Form action="/dashboard/suppressions" role="search" className="mb-6 flex flex-wrap items-center gap-2 sm:gap-3">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <label htmlFor="sup-q" className="sr-only">
          Search by name, company or email address
        </label>
        <Input
          id="sup-q"
          name="q"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          defaultValue={q}
          placeholder="Search by name, company or email address"
          className="pl-10"
        />
      </div>
      <FilterSheet activeCount={[reason, scope].filter(Boolean).length} resetHref="/dashboard/suppressions" title="Filter suppressions">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label htmlFor="sup-reden" className="sr-only max-md:not-sr-only max-md:text-sm max-md:font-medium max-md:text-ink">
            Reason
          </label>
          <Select id="sup-reden" name="reden" defaultValue={reason ?? ""} className="md:w-44">
            <option value="">All reasons</option>
            {suppressionReasons.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          <label htmlFor="sup-kanalen" className="sr-only max-md:not-sr-only max-md:text-sm max-md:font-medium max-md:text-ink">
            Channels
          </label>
          <Select id="sup-kanalen" name="kanalen" defaultValue={scope ?? ""} className="md:w-44">
            <option value="">All channels</option>
            {suppressionScopes.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary" className="max-md:hidden">
            Filter
          </Button>
        </div>
      </FilterSheet>
    </Form>
  );
}

async function Results({ searchParams }: { searchParams: SearchParams }) {
  const { q, reason, scope } = readFilters(await searchParams);
  const { items, total } = await listSuppressions({ q: q || undefined, reason, scope });
  return (
    <>
      <SuppressionTable items={items} filtered={Boolean(q || reason || scope)} />
      {total > SUPPRESSION_LIST_LIMIT && (
        <p className="mt-3 text-sm text-muted">
          You are searching the newest {SUPPRESSION_LIST_LIMIT} of {total} suppressions. Older suppressions still apply.
        </p>
      )}
    </>
  );
}
