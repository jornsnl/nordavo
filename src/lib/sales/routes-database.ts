// Types of public.sales_routes (20261127010000_sales_routes.sql), merged into
// Database in src/lib/database.types.ts. Pure types, safe everywhere.

import type { SalesRouteRow } from "@/lib/sales/routes";

type Editable = Pick<
  SalesRouteRow,
  "name" | "channel" | "status" | "started_on" | "ends_on" | "company_count" | "owner_text" | "note" | "updated_by" | "updated_source"
>;

export type RoutesTables = {
  sales_routes: {
    Row: SalesRouteRow;
    Insert: Partial<SalesRouteRow> & Pick<SalesRouteRow, "name">;
    Update: Partial<Editable>;
    Relationships: [];
  };
};
