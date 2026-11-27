// Running routes (opdracht Julius, 27 november 2026, deel B): a hand kept
// overview of the outreach that runs now. Pure, safe for client components:
// the page, the server actions and the MCP tools share these rules.
//
// The table (public.sales_routes, 20261127010000_sales_routes.sql) links to
// nothing: no campaign, bucket or company, and nothing is filled in for you.

import { z } from "zod";

export const ROUTE_CHANNELS = ["call", "mail", "linkedin", "other"] as const;
export type RouteChannel = (typeof ROUTE_CHANNELS)[number];
export const ROUTE_STATUSES = ["planned", "running", "paused", "done"] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];
export type RouteSource = "handmatig" | "claude";

export const routeChannelLabels: Record<RouteChannel, string> = {
  call: "Calling",
  mail: "Mail",
  linkedin: "LinkedIn",
  other: "Other",
};

export const routeStatusLabels: Record<RouteStatus, string> = {
  planned: "Planned",
  running: "Running",
  paused: "Paused",
  done: "Done",
};

export type SalesRouteRow = {
  id: string;
  name: string;
  channel: RouteChannel | null;
  status: RouteStatus | null;
  started_on: string | null;
  ends_on: string | null;
  company_count: number | null;
  owner_text: string | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
  created_source: RouteSource;
  updated_at: string;
  updated_by: string | null;
  updated_source: RouteSource;
};

/** The fields a person or Claude fills in. */
export type RouteFields = Pick<
  SalesRouteRow,
  "name" | "channel" | "status" | "started_on" | "ends_on" | "company_count" | "owner_text" | "note"
>;

/** Shown for an empty end date. */
export const NO_END_DATE = "nog niet duidelijk";

const date = z.iso.date({ error: "Use a date like 2026-12-31." });
const optionalText = (max: number) =>
  z
    .string()
    .max(max, { error: `Use at most ${max} characters.` })
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .nullable();

/** Every field but the name may be left empty (null). The name is required. */
export const routeFieldSchemas = {
  name: z.string().trim().min(1, { error: "Give the route a name." }).max(200, { error: "Use at most 200 characters." }),
  channel: z.enum(ROUTE_CHANNELS).nullable(),
  status: z.enum(ROUTE_STATUSES).nullable(),
  started_on: date.nullable(),
  ends_on: date.nullable(),
  company_count: z.number().int().min(0).max(1_000_000).nullable(),
  owner_text: optionalText(200),
  note: optionalText(4000),
} as const;

export const newRouteSchema = z.object({
  name: routeFieldSchemas.name,
  channel: routeFieldSchemas.channel.optional(),
  status: routeFieldSchemas.status.optional(),
  started_on: routeFieldSchemas.started_on.optional(),
  ends_on: routeFieldSchemas.ends_on.optional(),
  company_count: routeFieldSchemas.company_count.optional(),
  owner_text: routeFieldSchemas.owner_text.optional(),
  note: routeFieldSchemas.note.optional(),
});

export const routePatchSchema = newRouteSchema.partial();
export type RoutePatch = z.infer<typeof routePatchSchema>;

/** Running first, then planned, paused, no status, and done last. */
const statusOrder: Record<RouteStatus | "none", number> = { running: 0, planned: 1, paused: 2, none: 3, done: 4 };

/**
 * The standard order: by status (running on top), then by end date (soonest
 * first, no end date after the dated ones), then by name.
 */
export function sortRoutes<T extends Pick<SalesRouteRow, "status" | "ends_on" | "name">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const s = statusOrder[a.status ?? "none"] - statusOrder[b.status ?? "none"];
    if (s !== 0) return s;
    if (a.ends_on !== b.ends_on) {
      if (a.ends_on === null) return 1;
      if (b.ends_on === null) return -1;
      return a.ends_on < b.ends_on ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "nl");
  });
}

/** The default view hides done routes; "show done" shows them too. */
export function visibleRoutes<T extends Pick<SalesRouteRow, "status" | "ends_on" | "name">>(rows: T[], showDone: boolean): T[] {
  return sortRoutes(showDone ? rows : rows.filter((r) => r.status !== "done"));
}
