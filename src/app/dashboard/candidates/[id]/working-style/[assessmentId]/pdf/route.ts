import { NextResponse } from "next/server";
import { z } from "zod";
import { wspPdfResponse } from "@/lib/wsp/pdf-response";

/** Staff PDF: the report with the client intro, without flags and raw answers (logged as a download). */
export async function GET(_request: Request, { params }: RouteContext<"/dashboard/candidates/[id]/working-style/[assessmentId]/pdf">) {
  const { assessmentId } = await params;
  if (!z.guid().safeParse(assessmentId).success) return new NextResponse("Not found", { status: 404 });
  return wspPdfResponse({ assessmentId }, "staff");
}
