import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { MEDIA_BUCKET } from "@/lib/academy/media/files";
import { createClient } from "@/lib/supabase/server";

/**
 * The WebVTT subtitles of a video version for the player's <track>. Served
 * from this origin (no CORS), read as the signed-in user so RLS
 * (academy_can_see_video, storage academy_can_read_file) decides.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ versionId: string; lang: string }> }) {
  const { versionId, lang } = await params;
  if (!z.guid().safeParse(versionId).success || (lang !== "nl" && lang !== "en")) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: version } = await supabase
    .from("academy_video_versions")
    .select("subtitles_nl_path, subtitles_en_path")
    .eq("id", versionId)
    .maybeSingle();
  const path = lang === "nl" ? version?.subtitles_nl_path : version?.subtitles_en_path;
  if (!path) return new NextResponse("Not found", { status: 404 });
  const { data } = await supabase.storage.from(MEDIA_BUCKET).download(path);
  if (!data) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(await data.text(), {
    headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "private, max-age=300" },
  });
}
