import { NextResponse } from "next/server";
import { z } from "zod";
import { wspPdfResponse } from "@/lib/wsp/pdf-response";

/** The own report as a PDF from the own account (logged as a download). */
export async function GET(_request: Request, { params }: RouteContext<"/academy/working-style/[id]/pdf">) {
  const { id } = await params;
  if (!z.guid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  return wspPdfResponse({ assessmentId: id }, "person");
}
