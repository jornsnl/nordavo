import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Opens a task file through a signed link that works for 60 seconds. Both the
 * attachment row and the storage object are read as the signed-in user, so
 * RLS decides: someone without access to the task gets a 404, also with the
 * id in hand.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return NextResponse.redirect(new URL(`/work/sign-in?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url));
  }

  const { data: file } = await supabase.from("work_attachments").select("storage_path, file_name").eq("id", id).maybeSingle();
  if (!file) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await supabase.storage
    .from("work")
    .createSignedUrl(file.storage_path, 60, { download: file.file_name });
  if (error || !data) return new NextResponse("Not found", { status: 404 });

  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
