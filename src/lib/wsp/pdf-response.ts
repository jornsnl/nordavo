import "server-only";
import { NextResponse } from "next/server";
import { loadReport, type WspAccess } from "./data";
import { buildReportPdf } from "./pdf";
import { pdfFileName } from "./text";

/**
 * The PDF download for whoever asks: the database decides the role (person,
 * staff, client with an active share) and logs the download (wsp_report with
 * p_export). Clients get the watermark on every page. 404 when not allowed,
 * also for a client whose permission was withdrawn.
 */
export async function wspPdfResponse(access: WspAccess, expect?: "client" | "staff" | "person"): Promise<NextResponse> {
  const report = await loadReport(access, true);
  if (!report || (expect && report.audience !== expect)) return new NextResponse("Not found", { status: 404 });
  const bytes = await buildReportPdf({
    fullName: report.fullName,
    roleLabel: report.roleLabel ?? (report.personType === "developer" ? "Developer" : "Candidate"),
    completedAt: report.completedAt,
    results: report.results,
    audience: report.audience,
    watermark: report.audience === "client" && report.share ? { clientName: report.share.clientName, consentedAt: report.share.consentedAt } : null,
  });
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFileName(report.fullName, report.completedAt)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
