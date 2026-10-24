import type { Metadata } from "next";
import { Suspense } from "react";
import Form from "next/form";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddSuppressionButton } from "@/components/suppression/add-suppression-button";
import { SuppressionTable } from "@/components/suppression/suppression-table";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { isSuppressionReason, isSuppressionScope, listSuppressions, SUPPRESSION_LIST_LIMIT } from "@/lib/data/suppression";
import { suppressionReasons, suppressionScopes } from "@/lib/labels";

export const metadata: Metadata = {
  title: "Uitsluitingen",
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
        eyebrow="Beheer"
        title="Uitsluitingen"
        description="Wie hier staat, komt op geen enkele bel of maillijst voor de gekozen kanalen. Afmeldingen komen er automatisch bij."
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
    <Form action="/dashboard/uitsluitingen" role="search" className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <label htmlFor="sup-q" className="sr-only">
          Zoek op naam, bedrijf of mailadres
        </label>
        <Input id="sup-q" name="q" type="search" defaultValue={q} placeholder="Zoek op naam, bedrijf of mailadres" className="pl-10" />
      </div>
      <label htmlFor="sup-reden" className="sr-only">
        Reden
      </label>
      <Select id="sup-reden" name="reden" defaultValue={reason ?? ""} className="sm:w-44">
        <option value="">Alle redenen</option>
        {suppressionReasons.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Select>
      <label htmlFor="sup-kanalen" className="sr-only">
        Kanalen
      </label>
      <Select id="sup-kanalen" name="kanalen" defaultValue={scope ?? ""} className="sm:w-44">
        <option value="">Alle kanalen</option>
        {suppressionScopes.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary">
        Filteren
      </Button>
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
          Je zoekt in de nieuwste {SUPPRESSION_LIST_LIMIT} van {total} uitsluitingen. Oudere uitsluitingen blijven gewoon gelden.
        </p>
      )}
    </>
  );
}
