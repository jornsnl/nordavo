import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadCompanyRows, loadContactRows, loadViews } from "@/lib/sales/data";
import type { SalesViewEntity } from "@/lib/sales/database";
import { SalesWorkspace } from "./data-grid";
import type { AnyRow, GridKind } from "./grid-kinds";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

/** Loads the rows and saved views of one sales table and renders it (server). */
export async function SalesTable({
  kind,
  params,
  emptyText,
}: {
  kind: GridKind;
  params: SearchParams;
  emptyText?: string;
}) {
  const supabase = await createClient();
  const entity: SalesViewEntity = kind;
  const [rows, views] = await Promise.all([
    kind === "contacts"
      ? loadContactRows(supabase)
      : loadCompanyRows(supabase, { pipelineOnly: kind === "pipeline" }),
    loadViews(supabase, entity),
  ]);
  const requested = first(params.view);
  const initialViewId = requested && views.some((v) => v.id === requested) ? requested : null;
  return (
    <SalesWorkspace
        kind={kind}
        rows={rows as AnyRow[]}
        views={views.map((v) => ({ id: v.id, name: v.name, config: v.config, isCallList: v.isCallList, isShared: v.isShared }))}
        initialViewId={initialViewId}
        initialMode={first(params.mode) === "board" ? "board" : "table"}
        emptyText={emptyText}
      />
  );
}
