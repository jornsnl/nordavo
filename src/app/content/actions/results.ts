"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContentUser } from "@/lib/content/data";
import { contentErrorMessage, type ContentActionState } from "@/lib/content/errors";
import { createClient } from "@/lib/supabase/server";

/** Results after 48 hours and 7 days. The trigger checks the post is published; RLS who may enter them. */

/** A count from the form: digits with optional thousands separators. Null when empty, NaN when wrong. */
function readCount(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const cleaned = value.replace(/[\s.,]/g, "");
  if (!/^\d{1,10}$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

/** Save (or correct) one measurement; with mark_measured on, a 7 day result also sets the post to Measured. */
export async function saveResultAction(
  postId: string,
  measuredAfter: "48h" | "7d",
  _prev: ContentActionState,
  formData: FormData,
): Promise<ContentActionState> {
  await requireContentUser();
  if (!z.guid().safeParse(postId).success || (measuredAfter !== "48h" && measuredAfter !== "7d")) return { error: "Post not found." };
  const values = {
    impressions: readCount(formData.get("impressions")),
    likes: readCount(formData.get("likes")),
    comments: readCount(formData.get("comments")),
    reposts: readCount(formData.get("reposts")) ?? 0,
  };
  const fieldErrors: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && Number.isNaN(value)) fieldErrors[key] = "Whole numbers only";
  }
  if (values.likes === null) fieldErrors.likes = "Enter the likes";
  if (values.comments === null) fieldErrors.comments = "Enter the comments";
  if (Object.keys(fieldErrors).length > 0) return { error: "Check the numbers.", fieldErrors };
  const supabase = await createClient();
  const { error } = await supabase.from("content_results").upsert(
    {
      post_id: postId,
      measured_after: measuredAfter,
      impressions: values.impressions,
      likes: values.likes!,
      comments: values.comments!,
      reposts: values.reposts,
    },
    { onConflict: "post_id,measured_after" },
  );
  if (error) return { error: contentErrorMessage(error) };

  let message = measuredAfter === "48h" ? "48 hour results saved." : "7 day results saved.";
  if (measuredAfter === "7d" && formData.get("mark_measured") === "on") {
    const { data: post } = await supabase.from("content_posts").select("status").eq("id", postId).maybeSingle();
    if (post && post.status === "published") {
      const { error: statusError } = await supabase.from("content_posts").update({ status: "measured" }).eq("id", postId);
      if (statusError) return { ok: true, message: `${message} Not set to Measured: ${contentErrorMessage(statusError)}` };
      message += " The post is Measured.";
    }
  }
  revalidatePath("/content", "layout");
  return { ok: true, message };
}
