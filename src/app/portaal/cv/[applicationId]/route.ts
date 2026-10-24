import { NextResponse, type NextRequest } from "next/server";
import { getCvPathForApplication } from "@/lib/data/portal";
import { createSignedUrl } from "@/lib/storage";

/**
 * CV download for a presented candidate. Checks that the application belongs
 * to this client, then sends the browser to a signed URL that is valid for one
 * minute. The signed URL is created with the user's own Supabase client, so
 * storage RLS decides as well.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/portaal/cv/[applicationId]">) {
  const { applicationId } = await ctx.params;
  const path = await getCvPathForApplication(applicationId);
  const signedUrl = path ? await createSignedUrl(path, 60) : null;

  if (!signedUrl) {
    return new NextResponse("Dit CV is niet beschikbaar. Neem contact op met Nordavo via info@nordavo.nl.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const response = NextResponse.redirect(signedUrl, 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
