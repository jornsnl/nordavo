import { NextResponse } from "next/server";
import { requireJobDb } from "@/lib/gtm/jobs";
import { handleCalBooking, parseCalWebhook, verifyCalSignature } from "@/lib/integrations/calcom";
import { recordInterviewBooking } from "@/lib/integrations/calcom-interviews";
import { parseInterviewBooking } from "@/lib/recruitment/interviews";

/**
 * Cal.com webhook: BOOKING_CREATED, BOOKING_RESCHEDULED and BOOKING_CANCELLED
 * become meeting activities (S8), or, for interview invitations sent from the
 * portal (2.14), update the interview and the pipeline. Public in the proxy; authenticated by the
 * X-Cal-Signature-256 HMAC of the raw body with CALCOM_WEBHOOK_SECRET.
 *
 * 200 for handled and ignored events (so Cal.com does not retry them),
 * 401 for a missing secret or bad signature, 500 when writing fails (Cal.com retries).
 */
export async function POST(request: Request) {
  const secret = process.env.CALCOM_WEBHOOK_SECRET;
  const rawBody = await request.text();

  if (!secret) {
    console.error("[calcom] CALCOM_WEBHOOK_SECRET is missing: webhook refused.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 401 });
  }
  if (!verifyCalSignature(rawBody, request.headers.get("x-cal-signature-256"), secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ status: "ignored", reason: "not JSON" });
  }

  // Interviews first: a booking that belongs to an interview never reaches sales.
  const interview = parseInterviewBooking(json);
  if (interview) {
    try {
      const result = await recordInterviewBooking(requireJobDb(), interview);
      if (result.matched) return NextResponse.json({ status: "handled", kind: "interview", ...result });
    } catch (error) {
      console.error("[calcom] interview processing failed:", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "Processing failed" }, { status: 500 });
    }
  }

  const parsed = parseCalWebhook(json);
  if ("ignored" in parsed) return NextResponse.json({ status: "ignored", reason: parsed.ignored });

  try {
    const result = await handleCalBooking(requireJobDb(), parsed.booking);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[calcom] processing failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
