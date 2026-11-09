import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { documentDownloadLink } from "@/lib/academy/media/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Download of an Academy document (lesson block, module workbook, placement
 * document): the current version, or ?version=<n>. The rows are read as
 * the signed-in user, so RLS (academy_can_see_document) decides;
 * ?block=<id> records the block as opened (academy_record_block_view),
 * which completes a document block.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guid = z.guid();
  if (!guid.safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/academy")}`, request.url));

  const { data: document } = await supabase.from("academy_documents").select("id, current_version").eq("id", id).maybeSingle();
  if (!document) return new NextResponse("Not found", { status: 404 });
  const asked = Number(request.nextUrl.searchParams.get("version"));
  const versionNumber = Number.isInteger(asked) && asked > 0 ? asked : document.current_version;
  const { data: version } = await supabase
    .from("academy_document_versions")
    .select("storage_path, file_name")
    .eq("document_id", id)
    .eq("version", versionNumber)
    .maybeSingle();
  if (!version) return new NextResponse("Not found", { status: 404 });

  const block = request.nextUrl.searchParams.get("block");
  if (block && guid.safeParse(block).success) {
    const { error } = await supabase.rpc("academy_record_block_view", { p_block_id: block });
    if (error) console.error("academy document view", error.code, error.message);
  }

  const url = await documentDownloadLink(supabase, version.storage_path, version.file_name);
  if (!url) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
}
