import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Download a document of a placement (or a global placement document): a
 * signed link of 60 seconds. The document, its version and the file are all
 * read as the signed-in user, so RLS decides; without access it is a 404.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const { id, documentId } = await params;
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(id) || !uuid.test(documentId)) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/academy/placements/${id}`)}`, request.url));
  }

  const { data: document } = await supabase.from("academy_documents").select("id, current_version").eq("id", documentId).maybeSingle();
  if (!document || document.current_version < 1) return new NextResponse("Not found", { status: 404 });
  const { data: version } = await supabase
    .from("academy_document_versions")
    .select("storage_path, file_name")
    .eq("document_id", documentId)
    .eq("version", document.current_version)
    .maybeSingle();
  if (!version) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await supabase.storage
    .from("attachments")
    .createSignedUrl(version.storage_path, 60, { download: version.file_name });
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
