import Link from "next/link";
import { Mail, Phone, Smartphone } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ListExportType } from "@/lib/database.types";
import { getListCounts } from "@/lib/data/lists";
import { listDefinitions, type ListFilter } from "@/lib/gtm/lists";
import { hasGoogleSheets } from "@/lib/integrations/google-sheets";
import { hasInstantly } from "@/lib/integrations/instantly";
import { signalTypes } from "@/lib/labels";
import { CallListExportForm, MailPushForm, MaxExportForm } from "./export-forms";
import { filterQuery } from "./filter-fields";

const icons = { bellijst: Phone, mailcampagne: Mail, max_verrijking: Smartphone };

export async function ListCards({ filter, selected }: { filter: ListFilter; selected: ListExportType }) {
  const counts = await getListCounts(filter);
  const sheetsEnabled = hasGoogleSheets();
  const instantlyEnabled = hasInstantly();

  return (
    <div className="mb-8 grid gap-4 lg:grid-cols-3">
      {(Object.keys(listDefinitions) as ListExportType[]).map((type) => {
        const def = listDefinitions[type];
        const Icon = icons[type];
        const { count, capped } = counts[type];
        const active = type === selected;
        return (
          <Card key={type} className={active ? "ring-2 ring-brand-500" : ""}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Icon className="size-4 text-brand-600" aria-hidden="true" />
                  {def.label}
                </span>
              }
              description={def.description}
            />
            <CardBody className="space-y-4">
              <div className="flex items-end justify-between gap-3">
                <p>
                  <span className="font-display text-3xl font-bold text-brand-900 tabular-nums">
                    {count}
                    {capped ? "+" : ""}
                  </span>
                  <span className="ml-1.5 text-sm text-muted">{count === 1 ? "contact" : "contacten"}</span>
                </p>
                <Link
                  href={`/dashboard/lijsten?${filterQuery(filter, { lijst: type })}#voorbeeld`}
                  aria-current={active ? "true" : undefined}
                  className="text-sm font-semibold text-brand-600 hover:text-brand-800 max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:active:text-brand-800"
                >
                  {active ? "Voorbeeld hieronder" : "Bekijk voorbeeld"}
                </Link>
              </div>
              {type === "bellijst" && <CallListExportForm filter={filter} sheetsEnabled={sheetsEnabled} disabled={count === 0} />}
              {type === "mailcampagne" && (
                <MailPushForm
                  filter={filter}
                  instantlyEnabled={instantlyEnabled}
                  disabled={count === 0}
                  signalOptions={signalTypes.map((s) => ({ value: s.value, label: s.label }))}
                />
              )}
              {type === "max_verrijking" && <MaxExportForm filter={filter} disabled={count === 0} />}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

export function ListCardsSkeleton() {
  return (
    <div className="mb-8 grid gap-4 lg:grid-cols-3" aria-busy="true" aria-label="Laden">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-64 w-full rounded-2xl" />
      ))}
    </div>
  );
}
