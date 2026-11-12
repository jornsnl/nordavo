import { NextResponse } from "next/server";
import { requireJobDb } from "@/lib/gtm/jobs";
import { parseCallEvent, secretMatches } from "@/lib/sales/telephony";

/**
 * Calls from your own phone system (Dubline or any other that can send a
 * JSON webhook), with the recording, at the lead (feedback Julius, b6942cdc).
 *
 *   POST /api/webhooks/calls
 *   Authorization: Bearer <CALLS_WEBHOOK_SECRET>   (or X-Webhook-Secret: <secret>, or ?secret=<secret>)
 *   { "id": "...", "direction": "outbound", "to": "+31612345678", "started_at": "...",
 *     "duration": 95, "recording_url": "https://...", "status": "answered", "agent_email": "..." }
 *
 * The number is matched on its digits to a contact (mobile) or a company
 * (general number); the call lands in Activities with source telephony, the
 * recording link and the duration (sales_log_phone_call). The same call id
 * twice is one activity; a later delivery adds the recording. Public in the
 * proxy like the other webhooks; docs/calls.md has the setup.
 *
 * 200 for handled and ignored calls, 401 without the right secret, 500 when
 * writing fails (so the phone system retries).
 */
export async function POST(request: Request) {
  const secret = process.env.CALLS_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[calls] CALLS_WEBHOOK_SECRET is missing: webhook refused.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 401 });
  }
  const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const given = auth ?? request.headers.get("x-webhook-secret") ?? new URL(request.url).searchParams.get("secret");
  if (!secretMatches(given, secret)) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ status: "ignored", reason: "not JSON" });
  }
  const event = parseCallEvent(json);
  if (!event) return NextResponse.json({ status: "ignored", reason: "no call id or number" });

  try {
    const db = requireJobDb();
    const { data, error } = await db.rpc("sales_log_phone_call", {
      p_external_id: event.id,
      p_phone: event.phone,
      p_direction: event.direction,
      p_started_at: event.startedAt,
      p_duration: event.durationSeconds,
      p_recording_url: event.recordingUrl,
      p_answered: event.answered,
      p_agent_email: event.agentEmail,
      p_notes: event.notes,
    });
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ status: "ignored", reason: "no lead with this number" });
    return NextResponse.json({ status: "handled", activity_id: data });
  } catch (error) {
    console.error("[calls] logging failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
