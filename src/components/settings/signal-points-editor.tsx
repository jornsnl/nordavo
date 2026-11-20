"use client";

import { useState, useTransition } from "react";
import { saveScoreApproaches, saveSignalPoints } from "@/app/dashboard/settings/sales-list-actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import type { ScoreGroupRow, SignalPointRow } from "@/lib/sales/leadregels-database";

const cell = "rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

/**
 * The points table of the score (leadregels, deel 3 and 4): per kind of
 * signal the points, active yes or no, and how many days a new signal of
 * that kind counts. Saving computes every score again.
 */
export function SignalPointsEditor({ rows }: { rows: SignalPointRow[] }) {
  const [values, setValues] = useState(rows);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (type: string, patch: Partial<SignalPointRow>) => setValues((list) => list.map((r) => (r.type === type ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      <FormMessage error={message?.tone === "error" ? message.text : undefined} success={message?.tone === "ok" ? message.text : undefined} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs tracking-wide text-muted uppercase">
              <th className="py-2 pr-3 font-medium">Signal</th>
              <th className="py-2 pr-3 font-medium">Points</th>
              <th className="py-2 pr-3 font-medium">Active</th>
              <th className="py-2 pr-3 font-medium">Counts for (days)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {values.map((r) => (
              <tr key={r.type} className="align-top">
                <td className="py-2 pr-3">
                  <span className="font-medium text-ink">{r.label}</span>
                  {r.description && <span className="block text-xs text-muted">{r.description}</span>}
                  {r.derived && <span className="block text-xs text-muted">Derived from the vacancies.</span>}
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="number"
                    min={-100}
                    max={100}
                    aria-label={`Points for ${r.label}`}
                    className={`${cell} w-20 tabular-nums`}
                    value={r.points}
                    onChange={(e) => set(r.type, { points: Number(e.target.value) })}
                  />
                </td>
                <td className="py-2 pr-3">
                  <label className="inline-flex min-h-9 items-center gap-2">
                    <input type="checkbox" className="size-4 accent-brand-600" checked={r.active} onChange={(e) => set(r.type, { active: e.target.checked })} />
                    {r.active ? "Yes" : "No"}
                  </label>
                </td>
                <td className="py-2 pr-3">
                  {r.derived || r.type === "vacature" ? (
                    <span className="text-xs text-muted">While open</span>
                  ) : (
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      aria-label={`Days a ${r.label} signal counts`}
                      placeholder="No end"
                      className={`${cell} w-24 tabular-nums`}
                      value={r.valid_days ?? ""}
                      onChange={(e) => set(r.type, { valid_days: e.target.value ? Number(e.target.value) : null })}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await saveSignalPoints(values.map((r) => ({ type: r.type, points: r.points, active: r.active, valid_days: r.valid_days })));
            setMessage(result.ok ? { tone: "ok", text: "Saved. Every score is computed again." } : { tone: "error", text: result.error });
          })
        }
      >
        Save points
      </Button>
    </div>
  );
}

/** Which approach belongs to which score group: room for the decision that is still open (leadregels, deel 2). */
export function ScoreApproachEditor({ rows }: { rows: ScoreGroupRow[] }) {
  const [values, setValues] = useState(rows);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <FormMessage error={message?.tone === "error" ? message.text : undefined} success={message?.tone === "ok" ? message.text : undefined} />
      <div className="space-y-3">
        {values.map((g) => (
          <label key={g.key} className="grid gap-1 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-center">
            <span className="text-sm font-medium text-ink">{g.label}</span>
            <input
              className={cell}
              maxLength={500}
              placeholder="Not decided yet"
              value={g.approach ?? ""}
              onChange={(e) => setValues((list) => list.map((x) => (x.key === g.key ? { ...x, approach: e.target.value } : x)))}
            />
          </label>
        ))}
      </div>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await saveScoreApproaches(values.map((g) => ({ key: g.key, approach: g.approach?.trim() || null })));
            setMessage(result.ok ? { tone: "ok", text: "Saved." } : { tone: "error", text: result.error });
          })
        }
      >
        Save approaches
      </Button>
    </div>
  );
}
