import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { listHolidays } from "@/lib/academy/placement/data";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/dashboard/page-header";
import { HolidayButtons, HolidayForm, SeedYearButton } from "@/components/academy/admin/placement/forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Academy holidays" };

/**
 * Holidays of the Netherlands and India (Karnataka). The Dutch ones and the
 * Indian ones on a fixed date follow rules and are filled in per year; the
 * Karnataka festival days follow the moon: they were seeded for 2026 to 2028
 * as expected dates ("check") and Nordavo confirms them against the state's
 * official list.
 */
export default function Page({ searchParams }: PageProps<"/dashboard/academy/holidays">) {
  return (
    <>
      <PageHeader
        eyebrow="Academy"
        title="Holidays"
        description="Shown on every placement page and in the calendar link. Reminders of rituals skip a day off in the person's own country; leave days skip Indian days off."
      />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Holidays searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Holidays({ searchParams }: Pick<PageProps<"/dashboard/academy/holidays">, "searchParams">) {
  const query = await searchParams;
  const current = new Date().getUTCFullYear();
  const requested = Number(Array.isArray(query.year) ? query.year[0] : query.year);
  const year = Number.isInteger(requested) && requested >= 2020 && requested <= 2100 ? requested : current;
  const holidays = await listHolidays(year);
  const unconfirmed = holidays.filter((h) => !h.confirmed).length;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <nav aria-label="Year" className="flex flex-wrap gap-2">
          {[current - 1, current, current + 1, current + 2].map((y) => (
            <Link
              key={y}
              href={`/dashboard/academy/holidays?year=${y}`}
              aria-current={y === year ? "page" : undefined}
              className={`rounded-xl px-3 py-1.5 text-sm font-medium ${y === year ? "bg-brand-700 text-white" : "border border-border bg-white text-brand-900 hover:bg-brand-50"}`}
            >
              {y}
            </Link>
          ))}
        </nav>
        {unconfirmed > 0 && (
          <p className="rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {unconfirmed} {unconfirmed === 1 ? "date follows" : "dates follow"} the moon and {unconfirmed === 1 ? "is" : "are"} not checked yet. Compare with the
            Karnataka government list of general holidays for {year} and press &quot;Date is right&quot; or change the date.
          </p>
        )}
        {(["NL", "IN"] as const).map((country) => {
          const list = holidays.filter((h) => h.country === country);
          return (
            <Card key={country}>
              <CardHeader title={country === "NL" ? "Netherlands" : "India (Karnataka)"} description={`${list.length} holidays in ${year}`} />
              <CardBody>
                {list.length === 0 ? (
                  <SeedYearButton year={year} />
                ) : (
                  <ul className="divide-y divide-border">
                    {list.map((h) => (
                      <li key={h.id} className="py-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-brand-900">
                              {formatDate(h.date)} · {h.name_en}
                              {!h.day_off && <Badge>No day off</Badge>}
                              {!h.confirmed && <Badge tone="warning">Check</Badge>}
                            </p>
                            <p className="text-xs text-muted">{h.name_nl}</p>
                          </div>
                          <HolidayButtons id={h.id} name={h.name_en} confirmed={h.confirmed} />
                        </div>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-brand-700">Change</summary>
                          <div className="mt-2">
                            <HolidayForm holiday={h} />
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Add a holiday" />
          <CardBody>
            <HolidayForm holiday={null} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Rule-based holidays" description="Dutch holidays (Easter, Ascension, Pentecost, King's Day) and Indian holidays on a fixed date. Existing rows stay." />
          <CardBody>
            <SeedYearButton year={year} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
