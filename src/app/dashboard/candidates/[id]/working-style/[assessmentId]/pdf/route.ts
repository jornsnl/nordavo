import { NextResponse } from "next/server";
import { z } from "zod";
import { loadStaffConsent } from "@/lib/wsp/data";
import { wspPdfResponse } from "@/lib/wsp/pdf-response";
import { createClient } from "@/lib/supabase/server";

/**
 * Staff PDF: the report with the client intro, without flags and raw
 * answers (logged as a download). With ?share=<id>: the copy for that
 * client or prospect, with their name and the date in the watermark on every
 * page; only while the share and the permission are active.
 */
export async function GET(request: Request, { params }: RouteContext<"/dashboard/candidates/[id]/working-style/[assessmentId]/pdf">) {
  const { assessmentId } = await params;
  if (!z.guid().safeParse(assessmentId).success) return new NextResponse("Not found", { status: 404 });
  const shareId = new URL(request.url).searchParams.get("share");
  if (!shareId) return wspPdfResponse({ assessmentId }, "staff");
  if (!z.guid().safeParse(shareId).success) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: assessment } = await supabase.from("wsp_assessments").select("person_id").eq("id", assessmentId).maybeSingle();
  if (!assessment?.person_id) return new NextResponse("Not found", { status: 404 });
  const consent = await loadStaffConsent(assessment.person_id);
  const share = consent?.recipients.find((r) => r.id === shareId && r.assessmentId === assessmentId && !r.revokedAt);
  if (!consent?.consented || !share) return new NextResponse("Not found", { status: 404 });
  return wspPdfResponse({ assessmentId }, "staff", { name: share.name, sharedAt: share.sharedAt });
}
