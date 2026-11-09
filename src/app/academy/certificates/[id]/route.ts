import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isAcademyLocale } from "@/lib/academy/i18n";
import { certificateFileName, renderCertificatePdf } from "@/lib/academy/media/certificate-pdf";
import { createClient } from "@/lib/supabase/server";

/**
 * The certificate of a completed course as a PDF, made on request from the
 * academy_certificates row (name, course, number, date). RLS decides who may
 * read it: the person, Nordavo, and whoever may follow the person's progress.
 * Language: ?lang=nl|en, else the person's Academy language. ?view=1 opens
 * it in the browser instead of downloading.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.guid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/academy")}`, request.url));

  const { data: certificate } = await supabase.from("academy_certificates").select("*").eq("id", id).maybeSingle();
  if (!certificate) return new NextResponse("Not found", { status: 404 });
  const [{ data: course }, { data: member }] = await Promise.all([
    supabase.from("academy_courses").select("title, language").eq("id", certificate.course_id).maybeSingle(),
    supabase.from("academy_members").select("locale").eq("profile_id", certificate.profile_id).maybeSingle(),
  ]);
  const asked = request.nextUrl.searchParams.get("lang");
  const locale = isAcademyLocale(asked) ? asked : (member?.locale ?? course?.language ?? "en");
  const courseTitle = course?.title ?? "Nordavo Academy";

  const pdf = await renderCertificatePdf({
    fullName: certificate.full_name,
    courseTitle,
    number: certificate.number,
    issuedAt: certificate.issued_at,
    locale,
  });
  const inline = request.nextUrl.searchParams.get("view") === "1";
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${certificateFileName(courseTitle, certificate.number, locale)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
