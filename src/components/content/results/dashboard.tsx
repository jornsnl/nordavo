import type { Dimension, MonthCount } from "@/lib/content/results";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

/** Posts published per month against the goal, as bars. */
export function MonthBars({ months }: { months: MonthCount[] }) {
  const scale = Math.max(1, ...months.map((m) => Math.max(m.published, m.goal)));
  return (
    <ul className="space-y-2">
      {months.map((m) => {
        const [y, mo] = m.month.split("-").map(Number);
        const label = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, mo - 1, 1)));
        const onTrack = m.published >= m.goal;
        return (
          <li key={m.month} className="grid grid-cols-[4rem_1fr_5rem] items-center gap-3 text-sm">
            <span className="text-muted">{label}</span>
            <span className="relative h-3 rounded-full bg-slate-100" aria-hidden="true">
              <span className={`absolute inset-y-0 left-0 rounded-full ${onTrack ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${(m.published / scale) * 100}%` }} />
              <span className="absolute inset-y-[-3px] w-0.5 bg-brand-900/60" style={{ left: `${(m.goal / scale) * 100}%` }} title={`Goal ${m.goal}`} />
            </span>
            <span className="text-right tabular-nums">
              <span className="font-semibold text-ink">{m.published}</span>
              <span className="text-muted"> / {m.goal}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Averages of the 7 day results per value of each dimension. */
export function DimensionTables({ dimensions }: { dimensions: Dimension[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {dimensions.map((d) => (
        <Card key={d.key}>
          <CardHeader title={`Per ${d.label.toLowerCase()}`} />
          <CardBody className="overflow-x-auto">
            {d.rows.length === 0 ? (
              <p className="text-sm text-muted">No 7 day results yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1 pr-3 font-medium">{d.label}</th>
                    <th className="py-1 pr-3 text-right font-medium">Posts</th>
                    <th className="py-1 pr-3 text-right font-medium">Impressions</th>
                    <th className="py-1 pr-3 text-right font-medium">Likes + comments</th>
                    <th className="py-1 text-right font-medium">Success</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.rows.map((row) => (
                    <tr key={row.key}>
                      <td className="py-1.5 pr-3 font-medium text-ink">{row.label}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{row.posts}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{row.avgImpressions ?? "–"}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{row.avgEngagement}</td>
                      <td className={`py-1.5 text-right tabular-nums ${row.successRate >= 50 ? "text-emerald-700" : "text-danger"}`}>{row.successRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
