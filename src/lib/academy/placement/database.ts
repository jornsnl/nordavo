// Types of the tables and functions of the placement page, rituals and pulse
// (supabase/migrations/20261113200000_academy_placement_page.sql,
// 20261113210000_academy_holidays.sql, 20261113220000_academy_rituals_pulse.sql),
// merged into Database in src/lib/database.types.ts. Columns added to the
// foundation tables are in src/lib/academy/database.ts.

import type { AcademyPlacementRole } from "@/lib/academy/database";

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

type Fn<Args, Returns> = { Args: Args; Returns: Returns };

export type AcademyPlacementCalendarRow = {
  placement_id: string;
  token: string;
  created_at: string;
  rotated_at: string | null;
};

export type AcademyRitualReminderRow = {
  ritual_id: string;
  placement_id: string;
  profile_id: string;
  period_date: string;
  sent_at: string;
};

export type AcademyPlacementTables = {
  academy_placement_calendars: Table<AcademyPlacementCalendarRow, "placement_id">;
  academy_ritual_reminders: Table<AcademyRitualReminderRow, "ritual_id" | "placement_id" | "profile_id" | "period_date">;
};

/** academy_placement_view(): one placement without money; my_role null for a manager. */
export type AcademyPlacementViewRow = {
  id: string;
  my_role: AcademyPlacementRole | null;
  status: "active" | "notice" | "ended";
  start_date: string;
  end_date: string | null;
  probation_end_date: string | null;
  hours_per_week: number | null;
  overlap_start: string | null;
  overlap_end: string | null;
  overlap_time_zone: string;
  client_id: string;
  client_name: string | null;
  developer_profile_id: string | null;
  developer_name: string | null;
  developer_title: string | null;
  vacancy_title: string | null;
  nordavo_contact_id: string | null;
  nordavo_contact_name: string | null;
  nordavo_contact_email: string | null;
  nordavo_contact_booking_url: string | null;
  nordavo_response_hours: number;
};

export type AcademyCalendarFeedRow = {
  uid: string;
  starts_on: string;
  ends_on: string;
  title_nl: string;
  title_en: string;
  category: string;
};

export type AcademyPlacementFunctions = {
  academy_placement_view: Fn<{ p_placement_id: string }, AcademyPlacementViewRow[]>;
  academy_cancel_leave: Fn<{ p_request_id: string }, boolean>;
  academy_calendar_token: Fn<{ p_placement_id: string }, string | null>;
  academy_rotate_calendar_token: Fn<{ p_placement_id: string }, string>;
  academy_calendar_feed: Fn<{ p_token: string }, AcademyCalendarFeedRow[]>;
  academy_tick_ritual: Fn<{ p_ritual_id: string; p_period_date: string; p_done?: boolean; p_note?: string | null }, boolean>;
  academy_seed_holidays: Fn<{ p_year: number }, number>;
  academy_easter: Fn<{ p_year: number }, string>;
  /** Service role only. */
  academy_send_ritual_reminders: Fn<{ p_now?: string }, number>;
  /** Service role only. */
  academy_ensure_all_placement_rituals: Fn<Record<string, never>, number>;
  /** Service role only. */
  academy_ensure_milestones: Fn<{ p_placement_id: string }, number>;
  /** Service role only: pulse rounds, pulse reminders, review reminders. */
  academy_open_pulse_rounds: Fn<{ p_today?: string | null }, { opened: number; reminded: number; reviews: number }>;
};
