// Types of what 20261124300000_call_screen_contacts.sql and
// 20261124310000_call_screen_signals_cheatsheet.sql add (the typed client is
// hand written, see src/lib/database.types.ts).

export type CheatsheetRow = {
  /** Lower case key, a-z 0-9 and _; the built in sections use usps, price, starter_fee, trade_off and meetings. */
  key: string;
  title: string;
  body: string;
  position: number;
  hidden: boolean;
  updated_by: string | null;
  updated_at: string;
};

/** The Cal.com links for sales meetings (20261125100000_meeting_booking_flow.sql). */
export type BookingLinkRow = {
  id: string;
  label: string;
  url: string;
  /** Cal.com question identifiers that get the company and the role (?bedrijfsnaam=...). */
  company_field: string;
  role_field: string;
  position: number;
  created_at: string;
  updated_at: string;
};

type Rel = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<Row, Required extends keyof Row, Relationships extends Rel[]> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: Relationships;
};

export type CallScreenTables = {
  sales_call_cheatsheet: Table<CheatsheetRow, "key" | "title" | "body", []>;
  sales_booking_links: Table<BookingLinkRow, "label" | "url", []>;
};

type Fn<Args, Returns> = { Args: Args; Returns: Returns };
type Actor = { p_actor?: string | null };

/** What the call screen shows of a contact after a change. */
export type CallContactResult = {
  id: string;
  company_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  phone_wrong_at: string | null;
};

export type CallScreenFunctions = {
  /** "Meeting planned": makes the awaiting meeting with the reason and keeps the contact open. */
  sales_start_booking: Fn<
    { p_contact: string; p_reason: string; p_note?: string | null; p_with?: string | null } & Actor,
    { meeting_id: string; status: "awaiting_booking" | "planned" }
  >;
  /** Gives up an awaiting meeting; returns whether it changed. */
  sales_cancel_booking: Fn<{ p_meeting: string } & Actor, boolean>;
  /** Name, job title, mobile number and mail of one contact; a caller needs to hold a contact of the same company. */
  sales_caller_update_contact: Fn<
    {
      p_contact: string;
      p_first_name: string | null;
      p_last_name: string | null;
      p_title: string | null;
      p_phone: string | null;
      p_email: string | null;
    } & Actor,
    CallContactResult
  >;
  /** Marks (or clears) the mobile number of a contact as wrong. */
  sales_caller_mark_phone: Fn<{ p_contact: string; p_wrong: boolean } & Actor, CallContactResult>;
  /** A new contact at a company the caller is calling. */
  sales_caller_add_contact: Fn<
    {
      p_company: string;
      p_first_name: string | null;
      p_last_name: string | null;
      p_title: string | null;
      p_phone: string | null;
      p_email: string | null;
    } & Actor,
    CallContactResult
  >;
};
