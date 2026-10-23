import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { getCandidate } from "@/lib/data/candidates";
import { createSignedUrl } from "@/lib/storage";

/** Opens the CV through a fresh, short-lived signed URL. */
export async function GET(_request: Request, { params }: RouteContext<"/dashboard/kandidaten/[id]/cv">) {
  await requireStaff();
  const { id } = await params;
  const candidate = await getCandidate(id);
  if (!candidate?.cv_path) {
    return new Response("Geen cv gevonden.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const url = await createSignedUrl(candidate.cv_path, 60);
  if (!url) {
    return new Response("Het cv kon niet worden geopend. Probeer het later opnieuw.", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  redirect(url);
}
