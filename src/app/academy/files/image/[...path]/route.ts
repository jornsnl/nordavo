import { NextResponse, type NextRequest } from "next/server";
import { FILES_BUCKET } from "@/lib/academy/media/files";
import { createClient } from "@/lib/supabase/server";

/**
 * An image of the explanation block (attachments/academy/image/<id>/<file>).
 * Storage RLS lets every Academy participant and manager read these; others
 * get a 404. Redirects to a signed link that works for an hour, so the
 * browser can cache the redirect for a little less.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (!Array.isArray(path) || path.length !== 2 || path.some((p) => !/^[\w.-]{1,200}$/.test(p) || p.startsWith("."))) {
    return new NextResponse("Not found", { status: 404 });
  }
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/academy")}`, request.url));

  const { data } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(`academy/image/${path.join("/")}`, 3600);
  if (!data?.signedUrl) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "private, max-age=3000" } });
}
