import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { getProfileFile } from "@/lib/data/matches";
import { createSignedUrl } from "@/lib/storage";

/** Opens an anonymous profile PDF through a fresh, short-lived signed URL. */
export async function GET(_request: Request, { params }: RouteContext<"/dashboard/vacatures/[id]/profielen/[profileId]">) {
  await requireStaff();
  const { id, profileId } = await params;
  const file = await getProfileFile(profileId, id);
  if (!file) {
    return new Response("Geen profiel gevonden.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const url = await createSignedUrl(file.path, 60);
  if (!url) {
    return new Response("Het profiel kon niet worden geopend. Probeer het later opnieuw.", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  redirect(url);
}
