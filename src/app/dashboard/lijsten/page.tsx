import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { ExportHistory } from "@/components/lists/export-history";
import { ListCards, ListCardsSkeleton } from "@/components/lists/list-cards";
import { ListFilters } from "@/components/lists/list-filters";
import { MaxImportForm } from "@/components/lists/max-import-form";
import { PreviewTable } from "@/components/lists/preview-table";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { getListPreview } from "@/lib/data/lists";
import { isListType, listDefinitions, parseListFilter, PREVIEW_ROWS } from "@/lib/gtm/lists";

// Claude calls (matching, opening lines) run inside server actions on this page.
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "Lijsten",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function readParams(searchParams: SearchParams) {
  const params = await searchParams;
  const filter = parseListFilter(params);
  const list = isListType(params.lijst) ? params.lijst : "bellijst";
  return { filter, list };
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Lijsten"
        description="Een lijst is een opgeslagen filter, geen los bestand. Elke export checkt eerst uitsluitingen en de 30 dagen regel, en komt in de historie."
      />
      <Suspense fallback={<Skeleton className="mb-6 h-24 w-full rounded-2xl" />}>
        <Filters searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<ListCardsSkeleton />}>
        <Cards searchParams={searchParams} />
      </Suspense>

      <section id="voorbeeld" className="mb-10 scroll-mt-6 max-lg:scroll-mt-20">
        <Suspense fallback={<ListSkeleton rows={6} />}>
          <Preview searchParams={searchParams} />
        </Suspense>
      </section>

      <Card className="mb-10">
        <CardHeader
          title="Telefoonnummers van Max importeren"
          description="Upload de CSV die Max terugstuurt. Nummers komen alleen op contacten zonder nummer, met Max als bron."
        />
        <CardBody>
          <MaxImportForm />
        </CardBody>
      </Card>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold text-brand-900">Exporthistorie</h2>
        <Suspense fallback={<ListSkeleton rows={4} />}>
          <ExportHistory />
        </Suspense>
      </section>
    </>
  );
}

async function Filters({ searchParams }: { searchParams: SearchParams }) {
  const { filter, list } = await readParams(searchParams);
  return <ListFilters filter={filter} list={list} />;
}

async function Cards({ searchParams }: { searchParams: SearchParams }) {
  const { filter, list } = await readParams(searchParams);
  return <ListCards filter={filter} selected={list} />;
}

async function Preview({ searchParams }: { searchParams: SearchParams }) {
  const { filter, list } = await readParams(searchParams);
  const preview = await getListPreview(list, filter);
  return (
    <>
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="font-display text-lg font-semibold text-brand-900">Voorbeeld: {listDefinitions[list].label.toLowerCase()}</h2>
        <p className="text-sm text-muted">
          {preview.rows.length > 0
            ? `De eerste ${Math.min(PREVIEW_ROWS, preview.rows.length)} van ${preview.count}${preview.capped ? "+" : ""}, hoogste score eerst.`
            : null}
        </p>
      </div>
      <PreviewTable type={list} preview={preview} />
    </>
  );
}
