import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createSignedUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

/** Opens a CV or payslip from the form pages through a short-lived signed URL. Staff only. */
export async function GET(_request: Request, { params }: RouteContext<"/dashboard/forms/attachments/[id]">) {
  await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found.", { status: 404 });

  const supabase = await createClient();
  const { data } = await supabase.from("attachments").select("storage_path").eq("id", id).maybeSingle();
  if (!data) return new Response("File not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

  const url = await createSignedUrl(data.storage_path, 60);
  if (!url) {
    return new Response("The file could not be opened. Please try again later.", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  redirect(url);
}
