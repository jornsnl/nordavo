import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import { optionFor, placementStatuses, vacancyStatuses } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { clientRateTotals, vacancyBudgetText } from "@/lib/sales/client-rates";

/**
 * Client rates in Sales (feedback round 3): what we charge this company,
 * taken from Recruitment. The budget per month of its vacancies and the
 * monthly rate of its placements, with the running total per month.
 * Read with the user's rights: without Recruitment access the lists stay empty.
 */
export async function ClientRatesCard({ companyId, clientId }: { companyId: string; clientId: string | null }) {
  const supabase = await createClient();
  const vacancyFilter = clientId ? `company_id.eq.${companyId},client_id.eq.${clientId}` : `company_id.eq.${companyId}`;
  const [vacancies, placements] = await Promise.all([
    supabase
      .from("vacancies")
      .select("id, title, status, monthly_budget, budget_min, budget_max, hours")
      .or(vacancyFilter)
      .order("opened_at", { ascending: false })
      .limit(50),
    clientId
      ? supabase
          .from("placements")
          .select("id, status, monthly_rate, hours_per_week, start_date, candidate:candidates(full_name), vacancy:vacancies(title)")
          .eq("client_id", clientId)
          .order("start_date", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const vacancyRows = vacancies.data ?? [];
  const placementRows = placements.data ?? [];
  const totals = clientRateTotals(placementRows, vacancyRows);

  return (
    <Card>
      <CardHeader title="Client rates" description="What we charge this company, from Recruitment. Amounts in EUR per month." />
      <CardBody className="space-y-5">
        {vacancyRows.length === 0 && placementRows.length === 0 ? (
          <p className="text-sm text-muted">No vacancies or placements with rates yet.</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-surface/50 px-3 py-2">
                <dt className="text-xs text-muted">Placements running</dt>
                <dd className="font-display text-lg font-semibold text-brand-900 tabular-nums">{formatCurrency(totals.runningPerMonth, "None")}</dd>
              </div>
              <div className="rounded-xl border border-border bg-surface/50 px-3 py-2">
                <dt className="text-xs text-muted">Open vacancies, budget</dt>
                <dd className="font-display text-lg font-semibold text-brand-900 tabular-nums">{formatCurrency(totals.openBudgetPerMonth, "None")}</dd>
              </div>
            </dl>
            {placementRows.length > 0 && (
              <div>
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Placements</h3>
                <ul className="mt-2 divide-y divide-border text-sm">
                  {placementRows.map((p) => {
                    const status = optionFor(placementStatuses, p.status);
                    return (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                        <Link href={`/dashboard/placements/${p.id}`} className="min-w-0 truncate text-ink hover:text-brand-700 hover:underline">
                          {p.candidate?.full_name ?? "Candidate"}
                          {p.vacancy?.title ? <span className="text-muted">, {p.vacancy.title}</span> : null}
                        </Link>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="tabular-nums">{formatCurrency(p.monthly_rate, "No rate")}</span>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {vacancyRows.length > 0 && (
              <div>
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Vacancies</h3>
                <ul className="mt-2 divide-y divide-border text-sm">
                  {vacancyRows.map((v) => {
                    const status = optionFor(vacancyStatuses, v.status);
                    return (
                      <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                        <Link href={`/dashboard/vacancies/${v.id}`} className="min-w-0 truncate text-ink hover:text-brand-700 hover:underline">
                          {v.title}
                        </Link>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="tabular-nums">{vacancyBudgetText(v) ?? <span className="text-muted">No budget</span>}</span>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
