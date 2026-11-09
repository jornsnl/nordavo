import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { env } from "@/lib/env";
import { buildIcs } from "@/lib/academy/placement/ics";

/**
 * Calendar subscription of a placement: GET /api/academy/calendar/<token>.ics
 * (?lang=nl for Dutch titles). No session: calendar apps cannot sign in, the
 * token is the key (academy_placement_calendars, replaced by Nordavo on the
 * placement's Academy tab). The proxy lets this path through
 * (TOKEN_API_PATHS in src/lib/supabase/proxy.ts). The database function
 * academy_calendar_feed() only returns holidays, the timeline and approved
 * leave; it runs with the publishable key, so no secret is needed.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, "");
  if (!/^[0-9a-f]{32,128}$/i.test(token)) return new NextResponse("Not found", { status: 404 });

  const supabase = createClient<Database>(env.supabaseUrl(), env.supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.rpc("academy_calendar_feed", { p_token: token });
  if (error) {
    console.error("academy calendar feed", error.code, error.message);
    return new NextResponse("Not available", { status: 503 });
  }
  if (!data || data.length === 0) return new NextResponse("Not found", { status: 404 });

  const dutch = request.nextUrl.searchParams.get("lang") === "nl";
  const ics = buildIcs({
    name: dutch ? "Nordavo plaatsing" : "Nordavo placement",
    events: data.map((row) => ({
      uid: row.uid,
      start: row.starts_on,
      end: row.ends_on,
      summary: dutch ? row.title_nl : row.title_en,
      categories: [row.category],
    })),
  });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="nordavo-placement.ics"',
      "Cache-Control": "private, max-age=900",
    },
  });
}
