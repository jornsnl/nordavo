import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { bookingLinksOrEnv, isHttpsUrl, type BookingLink } from "@/lib/sales/booking";

type Db = SupabaseClient<Database>;

/** The Cal.com sales links of Settings, General (or the env link when none is saved). */
export async function loadBookingLinks(db: Db): Promise<BookingLink[]> {
  const { data, error } = await db
    .from("sales_booking_links")
    .select("id, label, url, company_field, role_field")
    .order("position")
    .order("created_at");
  if (error && !/does not exist|schema cache/i.test(error.message)) console.error("loadBookingLinks", error.message);
  const links = (data ?? [])
    .filter((l) => isHttpsUrl(l.url))
    .map((l) => ({ id: l.id, label: l.label, url: l.url, companyField: l.company_field, roleField: l.role_field }));
  return bookingLinksOrEnv(links, process.env.NEXT_PUBLIC_CALCOM_SALES_URL);
}
