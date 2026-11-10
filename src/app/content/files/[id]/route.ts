import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Opens a content file through a signed link that works for 60 seconds.
 *   /content/files/<media id>                     a file of a media library
 *   /content/files/<idea id>?kind=idea            the photo of an idea
 *   /content/files/<source id>?kind=source        the screenshot of a source
 * Add ?download=<name> to save it under that name (the publish panel numbers
 * the files of a carousel that way). The row is read as the signed-in user,
 * so RLS decides: without access the answer is 404, also with the id in hand.
 * The bucket has no policies for signed-in users, so the link itself is made
 * with the secret key, after that check.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return NextResponse.redirect(new URL(`/work/sign-in?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url));
  }

  const kind = request.nextUrl.searchParams.get("kind");
  let path: string | null = null;
  let name: string | null = null;
  if (kind === "idea") {
    const { data } = await supabase.from("content_ideas").select("photo_path").eq("id", id).maybeSingle();
    path = data?.photo_path ?? null;
  } else if (kind === "source") {
    const { data } = await supabase.from("content_sources").select("screenshot_path").eq("id", id).maybeSingle();
    path = data?.screenshot_path ?? null;
  } else {
    const { data } = await supabase.from("content_media").select("storage_path, file_name").eq("id", id).maybeSingle();
    path = data?.storage_path ?? null;
    name = data?.file_name ?? null;
  }
  if (!path) return new NextResponse("Not found", { status: 404 });

  const admin = createAdminClient();
  if (!admin) return new NextResponse("Files are not configured", { status: 503 });
  const download = request.nextUrl.searchParams.get("download");
  const fileName = download ? download.replace(/[\\/:*?"<>|\r\n]+/g, "-").slice(0, 200) || name : null;
  const { data, error } = await admin.storage
    .from("content")
    .createSignedUrl(path, 60, fileName ? { download: fileName } : undefined);
  if (error || !data) return new NextResponse("Not found", { status: 404 });

  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
