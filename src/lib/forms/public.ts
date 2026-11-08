import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ATTACHMENTS_BUCKET } from "@/lib/storage";
import type { FormVia } from "./database";
import { readBlocks, type Block } from "./schema";

/**
 * The public form (/apply/<token>) reads with the service role, so it only
 * ever selects the published version of one form and, for a personal link,
 * the first name and email of that one candidate. Nothing else leaves here.
 */

export const TOKEN_RE = /^[0-9a-f]{64}$/;

export type PublicForm = {
  formId: string;
  version: number;
  via: FormVia;
  title: string;
  intro: string | null;
  blocks: Block[];
  headerImageUrl: string | null;
  logoUrl: string | null;
  /** Personal link: prefill these. */
  prefill: { full_name?: string; email?: string; phone?: string } | null;
  alreadyCompleted: boolean;
};

export type ResolvedForm =
  | { state: "open"; form: PublicForm }
  | { state: "closed"; title: string }
  | { state: "not_found" }
  | { state: "unavailable" };

const IMAGE_TTL_SECONDS = 60 * 60;

export async function resolvePublicForm(token: string): Promise<ResolvedForm> {
  if (!TOKEN_RE.test(token)) return { state: "not_found" };
  const db = createAdminClient();
  if (!db) return { state: "unavailable" };

  let via: FormVia = "general";
  let formId: string | null = null;
  let prefill: PublicForm["prefill"] = null;
  let alreadyCompleted = false;

  const { data: invite } = await db
    .from("form_invites")
    .select("form_id, completed_at, application:applications(candidate:candidates(full_name, email, phone))")
    .eq("token", token)
    .maybeSingle();

  if (invite) {
    via = "personal";
    formId = invite.form_id;
    alreadyCompleted = Boolean(invite.completed_at);
    const candidate = invite.application?.candidate;
    if (candidate) {
      prefill = {
        full_name: candidate.full_name || undefined,
        email: candidate.email ?? undefined,
        phone: candidate.phone ?? undefined,
      };
    }
  } else {
    const { data: form } = await db
      .from("recruitment_forms")
      .select("id, public_token, headhunted_token")
      .or(`public_token.eq.${token},headhunted_token.eq.${token}`)
      .maybeSingle();
    if (!form) return { state: "not_found" };
    formId = form.id;
    via = form.headhunted_token === token ? "headhunted" : "general";
  }

  const { data: form } = await db.from("recruitment_forms").select("status, version, title").eq("id", formId).maybeSingle();
  if (!form) return { state: "not_found" };
  if (form.status !== "published" || form.version === 0) return { state: "closed", title: form.title };

  const { data: version } = await db
    .from("recruitment_form_versions")
    .select("title, intro, blocks, header_image_path, logo_path")
    .eq("form_id", formId)
    .eq("version", form.version)
    .maybeSingle();
  if (!version) return { state: "closed", title: form.title };

  const [headerImageUrl, logoUrl] = await Promise.all([
    signed(db, version.header_image_path),
    signed(db, version.logo_path),
  ]);

  return {
    state: "open",
    form: {
      formId,
      version: form.version,
      via,
      title: version.title,
      intro: version.intro,
      blocks: readBlocks(version.blocks),
      headerImageUrl,
      logoUrl,
      prefill,
      alreadyCompleted,
    },
  };
}

async function signed(db: NonNullable<ReturnType<typeof createAdminClient>>, path: string | null) {
  // Only form images (stored under the vacancy folder) are ever signed here.
  if (!path || !path.startsWith("vacancy/") || path.includes("..")) return null;
  const { data } = await db.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, IMAGE_TTL_SECONDS);
  return data?.signedUrl ?? null;
}
