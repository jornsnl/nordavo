import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hasModule, getCurrentUser } from "@/lib/auth";
import { getDocumentDetail, listWorksheetAnswers } from "@/lib/academy/media/server";
import { answersCsv, normalizeFields } from "@/lib/academy/media/worksheet";
import { safeFileName } from "@/lib/academy/media/files";

/** All answers to a worksheet as CSV (Academy managers; RLS keeps others out). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.guid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const user = await getCurrentUser();
  if (!hasModule(user, "academy")) return new NextResponse("Not found", { status: 404 });
  const detail = await getDocumentDetail(id);
  if (!detail || detail.document.kind !== "worksheet") return new NextResponse("Not found", { status: 404 });
  const rows = await listWorksheetAnswers(id);
  const csv = answersCsv(
    normalizeFields(detail.document.worksheet_fields),
    rows.map((r) => ({ name: r.name, email: r.email, submittedAt: r.submittedAt, answers: r.answers })),
  );
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFileName(detail.document.title)}-answers.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
