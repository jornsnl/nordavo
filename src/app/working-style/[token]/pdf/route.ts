import { NextResponse } from "next/server";
import { TOKEN_RE } from "@/lib/wsp/data";
import { wspPdfResponse } from "@/lib/wsp/pdf-response";

/** The own report as a PDF through the personal link (logged as a download). */
export async function GET(_request: Request, { params }: RouteContext<"/working-style/[token]/pdf">) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return new NextResponse("Not found", { status: 404 });
  return wspPdfResponse({ token }, "person");
}
