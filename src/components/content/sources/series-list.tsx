"use client";

import { useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PendingSubmit } from "@/components/placements/form-utils";
import { archiveSeriesAction, createSeriesAction, updateSeriesAction } from "@/app/content/actions/sources";
import type { SeriesItem } from "@/lib/content/sources";
import { statusTone } from "@/lib/content/rules";
import { useContentButton, useContentForm } from "@/components/content/media/use-content-action";

export function SeriesList({
  workspaceId,
  slug,
  series,
  statusLabels,
  canEdit,
}: {
  workspaceId: string;
  slug: string;
  series: SeriesItem[];
  statusLabels: Record<string, string>;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<SeriesItem | "new" | null>(null);
  const { pending, run } = useContentButton();

  return (
    <>
      {canEdit && (
        <div className="mb-4">
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            New series
          </Button>
        </div>
      )}
      {series.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-brand-200 bg-card px-5 py-10 text-center text-sm text-muted">
          No series yet. Group posts, for example Objections, the Reddit series or Project J.
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {series.map((s) => {
            const percent = s.targetCount ? Math.min(100, Math.round((s.live / s.targetCount) * 100)) : null;
            return (
              <li key={s.id} className={`rounded-2xl border border-border bg-card p-4 shadow-xs ${s.archived ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-display font-semibold text-brand-900">{s.name}</h2>
                    {s.description && <p className="mt-0.5 text-sm text-muted">{s.description}</p>}
                  </div>
                  {s.archived && <Badge tone="neutral">Archived</Badge>}
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-muted">
                    <span>
                      {s.live} live{s.targetCount ? ` of ${s.targetCount}` : ""}
                    </span>
                    <span>{s.active} in the series</span>
                  </div>
                  <div
                    className="mt-1 h-2 overflow-hidden rounded-full bg-brand-50"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent ?? undefined}
                    aria-label="Progress"
                  >
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${percent ?? (s.active ? Math.round((s.live / s.active) * 100) : 0)}%` }}
                    />
                  </div>
                </div>
                {Object.keys(s.byStatus).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(s.byStatus).map(([status, n]) => (
                      <Badge key={status} tone={statusTone(status)}>
                        {statusLabels[status] ?? status}: {n}
                      </Badge>
                    ))}
                  </div>
                )}
                {s.posts.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                    {s.posts.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2">
                        <Link href={`/content/w/${slug}/posts/${p.id}`} className="min-w-0 truncate text-brand-700 hover:underline">
                          {p.label}
                        </Link>
                        <span className="shrink-0 text-xs text-muted">{p.plannedDate ?? "No date"}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {canEdit && (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                      <Pencil aria-hidden="true" />
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => archiveSeriesAction(s.id, !s.archived))}>
                      {s.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                      {s.archived ? "Restore" : "Archive"}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "New series" : "Edit series"}>
        {editing && (
          <SeriesForm
            key={editing === "new" ? "new" : editing.id}
            series={editing === "new" ? null : editing}
            workspaceId={workspaceId}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}

function SeriesForm({ series, workspaceId, onDone }: { series: SeriesItem | null; workspaceId: string; onDone: () => void }) {
  const action = series ? updateSeriesAction.bind(null, series.id) : createSeriesAction.bind(null, workspaceId);
  const { state, formAction, pending, errors } = useContentForm(action, onDone);
  return (
    <form action={formAction} className="space-y-4">
      <Field label="Name" htmlFor="series-name" error={errors.name} required>
        <Input id="series-name" name="name" maxLength={120} defaultValue={series?.name ?? ""} required />
      </Field>
      <Field label="Description" htmlFor="series-description" error={errors.description}>
        <Textarea id="series-description" name="description" rows={3} maxLength={2000} defaultValue={series?.description ?? ""} />
      </Field>
      <Field label="Planned posts" htmlFor="series-target" error={errors.target_count} hint="For the progress bar. Optional.">
        <Input id="series-target" name="target_count" inputMode="numeric" defaultValue={series?.targetCount ?? ""} />
      </Field>
      {state.error && <FormMessage error={state.error} />}
      <PendingSubmit pending={pending} pendingLabel="Saving">
        {series ? "Save" : "Add series"}
      </PendingSubmit>
    </form>
  );
}
