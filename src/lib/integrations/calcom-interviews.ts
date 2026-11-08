import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { InterviewBooking } from "@/lib/recruitment/interviews";

/**
 * Cal.com bookings of interview invitations (2.14). The webhook route calls
 * this before the sales flow; the matching and the stage move happen in
 * public.interview_from_booking() (service role only), so they are tested
 * in SQL (supabase/tests/recruitment_planning.test.sql).
 */

export type InterviewBookingResult = {
  matched: boolean;
  interview_id?: string;
  application_id?: string;
  status?: string;
  moved_to?: string | null;
  ignored?: string;
};

export async function recordInterviewBooking(
  db: SupabaseClient<Database>,
  booking: InterviewBooking,
): Promise<InterviewBookingResult> {
  const { data, error } = await db.rpc("interview_from_booking", {
    p_trigger: booking.trigger,
    p_uid: booking.uid,
    p_previous_uid: booking.previousUid,
    p_interview_id: booking.interviewId,
    p_attendee_email: booking.attendeeEmail,
    p_starts_at: booking.startTime,
    p_ends_at: booking.endTime,
    p_reason: booking.reason,
  });
  if (error) throw new Error(`interview_from_booking: ${error.message}`);
  const result = (data ?? {}) as InterviewBookingResult;
  return { ...result, matched: result.matched === true };
}
