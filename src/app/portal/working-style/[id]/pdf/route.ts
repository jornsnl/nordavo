import { NextResponse } from "next/server";
import { z } from "zod";
import { wspPdfResponse } from "@/lib/wsp/pdf-response";

/**
 * The client PDF: only with an active share, the watermark on every page,
 * the download logged with the role. 404 after the permission is withdrawn.
 */
export async function GET(_request: Request, { params }: RouteContext<"/portal/working-style/[id]/pdf">) {
  const { id } = await params;
  if (!z.guid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  return wspPdfResponse({ assessmentId: id }, "client");
}
