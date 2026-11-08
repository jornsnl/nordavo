import type { Metadata } from "next";
import { Suspense } from "react";
import { io } from "next/cache";
import { PageHeader } from "@/components/dashboard/page-header";
import { ExchangeRateForm } from "@/components/forms/exchange-rate-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { listRates } from "@/lib/forms/data";
import { localDate } from "@/lib/forms/reminders";
import { toNumber } from "@/lib/forms/compensation";

export const metadata: Metadata = {
  title: "Exchange rate",
};

/** INR per EUR for compensation (recruitment brief 2.8). Admins change it, staff read it. */
export default function Page() {
  return (
    <Suspense fallback={<ListSkeleton rows={4} />}>
      <ExchangeRate />
    </Suspense>
  );
}

async function ExchangeRate() {
  const user = await requireStaff();
  const rates = await listRates();
  await io();
  const current = rates[0];

  return (
    <>
      <PageHeader
        eyebrow="Compensation"
        title="Exchange rate"
        description="Salaries and rates are asked in Indian rupees and shown in euros with this rate. A negotiated amount keeps the rate it was saved with."
      />
      <div className="space-y-4 sm:space-y-6">
        <Card>
          <CardHeader title="Current rate" />
          <CardBody>
            {current ? (
              <p className="text-sm text-ink">
                <span className="font-display text-2xl font-bold text-brand-900">₹{toNumber(current.inr_per_eur)}</span> per euro, rate of{" "}
                {formatDate(current.rate_date)}.
              </p>
            ) : (
              <p className="text-sm text-muted">No rate set yet, so compensation is shown in rupees only.</p>
            )}
          </CardBody>
        </Card>

        {user.role === "admin" ? (
          <Card>
            <CardHeader title="New rate" description="Only admins can change the rate." />
            <CardBody>
              <ExchangeRateForm today={localDate(new Date())} />
            </CardBody>
          </Card>
        ) : (
          <p className="text-sm text-muted">Only admins can change the rate.</p>
        )}

        {rates.length > 0 && (
          <Card>
            <CardHeader title="History" />
            <ul className="divide-y divide-border">
              {rates.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-sm sm:px-5">
                  <span className="font-medium text-ink">₹{toNumber(r.inr_per_eur)}</span>
                  <span className="text-muted">{formatDate(r.rate_date)}</span>
                  {r.note && <span className="text-muted">{r.note}</span>}
                  <span className="ml-auto text-xs text-muted">
                    {r.author?.full_name || r.author?.email || "Unknown"}, {formatDateTime(r.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
