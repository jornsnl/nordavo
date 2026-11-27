"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Bot, Plus, Trash2 } from "lucide-react";
import { addRouteAction, deleteRouteAction, updateRouteAction } from "@/app/dashboard/routes/actions";
import { Button } from "@/components/ui/button";
import {
  NO_END_DATE,
  ROUTE_CHANNELS,
  ROUTE_STATUSES,
  routeChannelLabels,
  routeStatusLabels,
  visibleRoutes,
  type RouteFields,
  type SalesRouteRow,
} from "@/lib/sales/routes";

// Running routes (deel B): one table, edited in place. Text, number and date
// cells save when you leave them, the selects at once. Rows Claude added or
// changed show a small mark; the page reloads its data when you come back to
// the tab, so a change through the MCP shows without a manual refresh.

const cell =
  "w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm text-ink hover:border-border focus:border-brand-500 focus:bg-white focus:outline-none";

export function RoutesTable({ initialRows }: { initialRows: SalesRouteRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [showDone, setShowDone] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Bumped when the server brings rows that differ from what is on screen
  // (a change by Claude or a colleague), so the cells show the new values.
  // Our own saves come back the same and keep the focus where it is.
  const [version, setVersion] = useState(0);
  const [serverRows, setServerRows] = useState(initialRows);
  if (serverRows !== initialRows) {
    setServerRows(initialRows);
    if (!sameRows(rows, initialRows)) {
      setRows(initialRows);
      setVersion((v) => v + 1);
    }
  }

  // Back on the tab: pick up what Claude (or a colleague) changed meanwhile.
  useEffect(() => {
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);

  const shown = useMemo(() => visibleRoutes(rows, showDone), [rows, showDone]);
  const doneCount = rows.filter((r) => r.status === "done").length;

  function replace(row: SalesRouteRow) {
    setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
  }

  function save(row: SalesRouteRow, patch: Partial<RouteFields>) {
    const key = Object.keys(patch)[0] as keyof RouteFields | undefined;
    if (!key || row[key] === patch[key]) return;
    setError(null);
    replace({ ...row, ...patch });
    startTransition(async () => {
      const result = await updateRouteAction(row.id, patch);
      if (result.ok && result.row) replace(result.row);
      else {
        replace(row);
        setError(result.ok ? null : result.error);
      }
    });
  }

  function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addRouteAction({ name });
      if (result.ok && result.row) {
        const row = result.row;
        setRows((prev) => [...prev, row]);
        setName("");
      } else setError(result.ok ? null : result.error);
    });
  }

  function remove(row: SalesRouteRow) {
    if (!window.confirm(`Delete the route "${row.name}"?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteRouteAction(row.id);
      if (result.ok) setRows((prev) => prev.filter((r) => r.id !== row.id));
      else setError(result.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={add} className="flex min-w-64 flex-1 items-center gap-2 sm:max-w-md">
          <label htmlFor="new-route" className="sr-only">
            Name of the new route
          </label>
          <input
            id="new-route"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New route, for example Bellijst Noord50"
            maxLength={200}
            className="h-9 w-full rounded-xl border border-border bg-white px-3 text-sm"
          />
          <Button size="sm" type="submit" disabled={pending || name.trim() === ""}>
            <Plus aria-hidden="true" />
            Add
          </Button>
        </form>
        <label className="inline-flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="size-4 rounded border-border" />
          Show done too{doneCount > 0 ? ` (${doneCount})` : ""}
        </label>
        <span className="text-xs text-muted" aria-live="polite">
          {pending ? "Saving" : `${shown.length} routes`}
        </span>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-xs">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="border-b border-border bg-surface/60 text-xs font-semibold tracking-wide text-muted uppercase">
            <tr>
              <th scope="col" className="px-3 py-3">Name</th>
              <th scope="col" className="w-32 px-3 py-3">Channel</th>
              <th scope="col" className="w-32 px-3 py-3">Status</th>
              <th scope="col" className="w-40 px-3 py-3">Started on</th>
              <th scope="col" className="w-40 px-3 py-3">Ends on</th>
              <th scope="col" className="w-28 px-3 py-3">Companies</th>
              <th scope="col" className="w-40 px-3 py-3">Who</th>
              <th scope="col" className="px-3 py-3">Note or next step</th>
              <th scope="col" className="w-12 px-3 py-3"><span className="sr-only">Delete</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted">
                  No running routes. Add one above.
                </td>
              </tr>
            )}
            {shown.map((row) => (
              <RouteRow key={`${row.id}:${version}`} row={row} onSave={(patch) => save(row, patch)} onDelete={() => remove(row)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function sameRows(a: SalesRouteRow[], b: SalesRouteRow[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((r) => [r.id, r]));
  return b.every((r) => {
    const other = byId.get(r.id);
    return other !== undefined && JSON.stringify(other) === JSON.stringify(r);
  });
}

function RouteRow({
  row,
  onSave,
  onDelete,
}: {
  row: SalesRouteRow;
  onSave: (patch: Partial<RouteFields>) => void;
  onDelete: () => void;
}) {
  const text = (value: string) => (value.trim() === "" ? null : value.trim());
  return (
    <tr className={row.status === "done" ? "text-muted" : undefined}>
      <td className="px-1 py-1">
        <div className="flex items-center gap-1">
          <input
            aria-label="Name"
            defaultValue={row.name}
            maxLength={200}
            required
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (value === "") e.target.value = row.name;
              else onSave({ name: value });
            }}
            className={`${cell} font-medium`}
          />
          {(row.updated_source === "claude" || row.created_source === "claude") && (
            <span title={row.updated_source === "claude" ? "Last changed by Claude" : "Added by Claude"}>
              <Bot className="size-4 shrink-0 text-muted" aria-label="Claude" />
            </span>
          )}
        </div>
      </td>
      <td className="px-1 py-1">
        <select
          aria-label="Channel"
          defaultValue={row.channel ?? ""}
          onChange={(e) => onSave({ channel: (e.target.value || null) as RouteFields["channel"] })}
          className={cell}
        >
          <option value="">None</option>
          {ROUTE_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {routeChannelLabels[c]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-1 py-1">
        <select
          aria-label="Status"
          defaultValue={row.status ?? ""}
          onChange={(e) => onSave({ status: (e.target.value || null) as RouteFields["status"] })}
          className={cell}
        >
          <option value="">None</option>
          {ROUTE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {routeStatusLabels[s]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-1 py-1">
        <input
          type="date"
          aria-label="Started on"
          defaultValue={row.started_on ?? ""}
          onBlur={(e) => onSave({ started_on: e.target.value || null })}
          className={cell}
        />
      </td>
      <td className="px-1 py-1">
        <input
          type="date"
          aria-label="Ends on"
          title={row.ends_on ? undefined : NO_END_DATE}
          defaultValue={row.ends_on ?? ""}
          onBlur={(e) => onSave({ ends_on: e.target.value || null })}
          className={`${cell} ${row.ends_on ? "" : "text-muted"}`}
        />
        {!row.ends_on && <span className="block px-2 text-xs text-muted">{NO_END_DATE}</span>}
      </td>
      <td className="px-1 py-1">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          aria-label="Number of companies"
          defaultValue={row.company_count ?? ""}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            const value = raw === "" ? null : Number(raw);
            if (value !== null && (!Number.isInteger(value) || value < 0)) {
              e.target.value = row.company_count?.toString() ?? "";
              return;
            }
            onSave({ company_count: value });
          }}
          className={`${cell} tabular-nums`}
        />
      </td>
      <td className="px-1 py-1">
        <input
          aria-label="Who"
          defaultValue={row.owner_text ?? ""}
          maxLength={200}
          onBlur={(e) => onSave({ owner_text: text(e.target.value) })}
          className={cell}
        />
      </td>
      <td className="px-1 py-1">
        <textarea
          aria-label="Note or next step"
          defaultValue={row.note ?? ""}
          maxLength={4000}
          rows={1}
          onBlur={(e) => onSave({ note: text(e.target.value) })}
          className={`${cell} min-h-9 resize-y`}
        />
      </td>
      <td className="px-1 py-1 text-right">
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg p-2 text-muted hover:bg-danger-bg hover:text-danger"
          aria-label={`Delete ${row.name}`}
        >
          <Trash2 className="size-4" />
        </button>
      </td>
    </tr>
  );
}
