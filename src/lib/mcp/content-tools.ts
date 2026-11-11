import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import type { ContentRole, ContentTextField } from "@/lib/content/database";
import { locateOriginal } from "@/lib/content/text-match";
import { linkedInText } from "@/lib/content/rules";
import { check, fail, idSchema, ok, type McpDb, type McpToolContext } from "@/lib/mcp/shared";
import { downloadDriveFile, hasGoogleDrive, safeFileName } from "@/lib/content/drive";
import { allowedMediaType, driveFileId, fetchableLink, fileNameFrom, LINK_MAX_BYTES } from "@/lib/content/link-media";

/**
 * Content module tools (docs/content.md) for the token owner's own Claude.
 * Reads follow the owner's rights in Content (content_api_role,
 * content_api_can_view_post, content_api_can_view_idea). Writes go through
 * the content_api_* functions as the token owner with source claude, so
 * the same rules, versions and activity log apply as in the app and every
 * change of Claude is told apart (feedback Julius, 11 November 2026: within
 * Content Claude may do everything itself). The suggest tools stay for when
 * Claude wants a person to decide. Which tools are offered follows the
 * level an admin set for Content (module-access.ts).
 */

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const SUGGEST = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const SUGGESTION_NOTE =
  "Anything you write here is shown to the author or reviewer as a suggestion they accept or reject; you never pick, approve, schedule or publish.";

const textFields = ["title", "hook", "body", "closing_question", "first_comment"] as const satisfies readonly ContentTextField[];

type Visible = { id: string; name: string; slug: string; role: ContentRole };

async function visibleWorkspaces(db: McpDb, userId: string): Promise<Visible[]> {
  const { data } = await db.from("content_workspaces").select("id, name, slug").is("archived_at", null).order("name");
  const rows = await Promise.all(
    (data ?? []).map(async (w) => {
      const { data: role } = await db.rpc("content_api_role", { p_workspace: w.id, p_actor: userId });
      return role ? { ...w, role } : null;
    }),
  );
  return rows.filter((w): w is Visible => w !== null);
}

async function canViewPost(db: McpDb, postId: string, userId: string) {
  const { data } = await db.rpc("content_api_can_view_post", { p_post: postId, p_actor: userId });
  return data === true;
}

function errorText(error: { message: string }) {
  return error.message.replace(/^.*?ERROR:\s*/, "");
}

/** The private bucket of Content (CONTENT_BUCKET in content/data.ts, which needs next/navigation). */
const CONTENT_BUCKET = "content";

const POST_FIELDS_NOTE = "Option fields (channel, language, audience, theme, angle, format, priority, time_slot) take the option key of the workspace.";

const postFieldsSchema = {
  hook: z.string().max(3000).optional(),
  body: z.string().max(10_000).optional(),
  closing_question: z.string().max(3000).optional(),
  first_comment: z.string().max(3000).optional(),
  channel: z.string().max(60).optional(),
  language: z.string().max(60).optional(),
  audience: z.string().max(60).optional(),
  theme: z.string().max(60).optional(),
  angle: z.string().max(60).optional(),
  format: z.string().max(60).optional(),
  priority: z.string().max(60).optional(),
  planned_date: z.union([z.iso.date(), z.literal("")]).optional().describe("YYYY-MM-DD."),
  time_slot: z.string().max(60).optional(),
  series_id: z.union([idSchema, z.literal("")]).optional(),
  source_id: z.union([idSchema, z.literal("")]).optional(),
  notes: z.string().max(10_000).optional(),
  linkedin_url: z.union([z.url().max(2000), z.literal("")]).optional(),
  published_at: z.iso.datetime({ offset: true }).optional().describe("When it went live (for a published post)."),
};

/** The fields Claude gave, for content_api_create_post and content_api_update_post. */
export function postFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
}

/** Fetch a file from a link for the library: Drive through the service account, else plain https. */
async function fetchMediaLink(link: string): Promise<{ bytes: ArrayBuffer; name: string; mime: string }> {
  const driveId = driveFileId(link);
  if (driveId && hasGoogleDrive()) {
    const file = await downloadDriveFile(driveId);
    if (!allowedMediaType(file.mimeType)) throw new Error("Only photos, videos and PDFs go in the library.");
    if (file.bytes.byteLength > LINK_MAX_BYTES) throw new Error(`At most ${LINK_MAX_BYTES / 1024 / 1024} MB per file.`);
    return { bytes: file.bytes, name: file.name, mime: file.mimeType };
  }
  const checked = fetchableLink(driveId ? `https://drive.google.com/uc?export=download&id=${driveId}` : link);
  if (!checked.ok) throw new Error(checked.error);
  const response = await fetch(checked.url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  const final = fetchableLink(response.url || checked.url.toString());
  if (!final.ok) throw new Error(final.error);
  if (!response.ok) throw new Error(`The link answered ${response.status}.`);
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!allowedMediaType(mime)) throw new Error("Only photos, videos and PDFs go in the library (this link is not a file, or is not public).");
  if (Number(response.headers.get("content-length") ?? 0) > LINK_MAX_BYTES) throw new Error(`At most ${LINK_MAX_BYTES / 1024 / 1024} MB per file.`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > LINK_MAX_BYTES) throw new Error(`At most ${LINK_MAX_BYTES / 1024 / 1024} MB per file.`);
  return { bytes, name: fileNameFrom(link, response.headers.get("content-disposition"), mime), mime };
}

export function registerContentTools(server: McpServer, ctx: McpToolContext) {
  const { db, userId } = ctx;
  const postUrl = (slug: string, id: string) => `${ctx.siteUrl.replace(/\/$/, "")}/content/w/${slug}/posts/${id}`;

  server.registerTool(
    "content_list_workspaces",
    {
      title: "Content workspaces",
      description: "LinkedIn content workspaces you can open (one per employee), with your role in each: admin, author, reviewer or viewer.",
      annotations: READ_ONLY,
    },
    async () => ok({ workspaces: await visibleWorkspaces(db, userId) }),
  );

  server.registerTool(
    "content_list_posts",
    {
      title: "Content posts",
      description:
        "Posts of a content workspace with status, planned date, time slot, format and angle. Reviewers only see posts that were sent to review. Use content_get_post for the text.",
      inputSchema: {
        workspace: z.string().min(1).max(60).describe("Workspace slug or id (content_list_workspaces)."),
        status: z.string().max(40).optional().describe("Only this status key, e.g. draft, in_review, approved, scheduled, published."),
        archived: z.boolean().default(false).describe("Archived posts instead of the live ones."),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).max(10_000).default(0),
      },
      annotations: READ_ONLY,
    },
    async ({ workspace, status, archived, limit, offset }) => {
      const ws = (await visibleWorkspaces(db, userId)).find((w) => w.slug === workspace || w.id === workspace);
      if (!ws) return fail("Workspace not found, or you have no access to it.");
      let query = db
        .from("content_posts")
        .select("id, title, status, planned_date, time_slot, format, angle, audience, language, submitted_at, updated_at")
        .eq("workspace_id", ws.id)
        .order("planned_date", { ascending: true, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (status) query = query.eq("status", status);
      query = archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
      if (ws.role === "reviewer") query = query.or(`submitted_at.not.is.null,created_by.eq.${userId}`);
      const rows = check(await query, "posts");
      return ok({
        workspace: { slug: ws.slug, role: ws.role },
        posts: rows.map((p) => ({ id: p.id, title: p.title, status: p.status, planned_date: p.planned_date, time_slot: p.time_slot, format: p.format, angle: p.angle, audience: p.audience, language: p.language, updated_at: p.updated_at, url: postUrl(ws.slug, p.id) })),
      });
    },
  );

  server.registerTool(
    "content_get_post",
    {
      title: "Content post",
      description:
        "One post with its fields, the text per field and as it goes on LinkedIn, the image brief, chosen media in order, open image suggestions and pending text suggestions.",
      inputSchema: { post_id: idSchema },
      annotations: READ_ONLY,
    },
    async ({ post_id }) => {
      if (!(await canViewPost(db, post_id, userId))) return fail("Post not found, or you have no access to it.");
      const post = check(await db.from("content_posts").select("*").eq("id", post_id).single(), "post");
      const [ws, media, images, suggestions, ideas] = await Promise.all([
        db.from("content_workspaces").select("slug, name").eq("id", post.workspace_id).single(),
        db.from("content_post_media").select("media_id, position").eq("post_id", post_id).order("position"),
        db.from("content_image_suggestions").select("id, media_id, reason, score, suggested_by").eq("post_id", post_id).eq("status", "pending"),
        db
          .from("content_suggestions")
          .select("id, field, original_text, replacement_text, note, suggested_by")
          .eq("post_id", post_id)
          .eq("status", "pending"),
        db.from("content_idea_posts").select("idea_id").eq("post_id", post_id),
      ]);
      const slug = check(ws, "workspace").slug;
      return ok({
        id: post.id,
        url: postUrl(slug, post.id),
        workspace: slug,
        title: post.title,
        status: post.status,
        planned_date: post.planned_date,
        time_slot: post.time_slot,
        channel: post.channel,
        language: post.language,
        audience: post.audience,
        theme: post.theme,
        angle: post.angle,
        format: post.format,
        priority: post.priority,
        hook: post.hook,
        body: post.body,
        closing_question: post.closing_question,
        first_comment: post.first_comment,
        linkedin_text: linkedInText({ hook: post.hook, body: post.body, closingQuestion: post.closing_question }),
        image_brief: post.image_brief,
        image_brief_by: post.image_brief_by,
        linked_idea_count: check(ideas, "ideas").length,
        chosen_media: check(media, "media"),
        open_image_suggestions: check(images, "image suggestions"),
        pending_text_suggestions: check(suggestions, "suggestions"),
        custom_fields: post.custom_fields,
        linkedin_url: post.linkedin_url,
        published_at: post.published_at,
        archived: Boolean(post.archived_at),
        notes: post.notes,
      });
    },
  );

  server.registerTool(
    "content_list_ideas",
    {
      title: "Content ideas",
      description: "Ideas of a content workspace (inbox, shortlist or archive), newest first, with tags, link and whether it became a post.",
      inputSchema: {
        workspace: z.string().min(1).max(60).describe("Workspace slug or id."),
        view: z.enum(["inbox", "shortlist", "archive", "converted", "all"]).default("inbox"),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).max(10_000).default(0),
      },
      annotations: READ_ONLY,
    },
    async ({ workspace, view, limit, offset }) => {
      const ws = (await visibleWorkspaces(db, userId)).find((w) => w.slug === workspace || w.id === workspace);
      if (!ws) return fail("Workspace not found, or you have no access to it.");
      let query = db
        .from("content_ideas")
        .select("id, text, tags, link, status, is_private, author_id, created_at")
        .eq("workspace_id", ws.id)
        .is("merged_into", null)
        .order("created_at", { ascending: false })
        .range(offset, offset + Math.min(500, limit * 4) - 1);
      const statusFor = { inbox: "new", shortlist: "shortlisted", archive: "archived", converted: "converted" } as const;
      if (view !== "all") query = query.eq("status", statusFor[view]);
      const rows = check(await query, "ideas");
      // Private ideas follow the rights of the token owner.
      const visible = [];
      for (const row of rows) {
        const { data } = await db.rpc("content_api_can_view_idea", { p_idea: row.id, p_actor: userId });
        if (data === true) visible.push(row);
        if (visible.length >= limit) break;
      }
      return ok({
        workspace: ws.slug,
        ideas: visible.map(({ author_id, ...idea }) => ({ ...idea, mine: author_id === userId })),
        url: `${ctx.siteUrl.replace(/\/$/, "")}/content/w/${ws.slug}/ideas`,
      });
    },
  );

  server.registerTool(
    "content_list_media",
    {
      title: "Content media",
      description:
        "Media files of a workspace library, or of the shared company library (workspace omitted). Filter on files without a description or files never used in a published post. Includes the description, tags, people, setting, mood and whether a suggestion of yours is waiting.",
      inputSchema: {
        workspace: z.string().min(1).max(60).optional().describe("Workspace slug or id; leave out for the company library."),
        undescribed: z.boolean().default(false).describe("Only files without a description."),
        unused: z.boolean().default(false).describe("Only files that were never published."),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).max(10_000).default(0),
      },
      annotations: READ_ONLY,
    },
    async ({ workspace, undescribed, unused, limit, offset }) => {
      const visible = await visibleWorkspaces(db, userId);
      let wsId: string | null = null;
      if (workspace) {
        const ws = visible.find((w) => w.slug === workspace || w.id === workspace);
        if (!ws) return fail("Workspace not found, or you have no access to it.");
        wsId = ws.id;
      } else if (visible.length === 0) {
        return fail("You have no access to the company library.");
      }
      let query = db
        .from("content_media")
        .select("id, file_name, mime_type, folder, taken_on, people, author_in_photo, setting, mood, clothing, orientation, usable_for_linkedin, do_not_use, description, tags, suggested_at")
        .order("created_at", { ascending: false });
      query = wsId ? query.eq("workspace_id", wsId) : query.is("workspace_id", null);
      if (undescribed) query = query.is("description", null);
      const rows = check(await query.range(offset, offset + (unused ? 500 : limit) - 1), "media");
      let list = rows;
      if (unused && rows.length) {
        const { data: used } = await db.from("content_media_usage").select("media_id").in("media_id", rows.map((r) => r.id));
        const usedIds = new Set((used ?? []).map((u) => u.media_id));
        list = rows.filter((r) => !usedIds.has(r.id)).slice(0, limit);
      }
      return ok({
        library: wsId ? workspace : "company",
        media: list.map(({ suggested_at, ...m }) => ({ ...m, suggestion_waiting: Boolean(suggested_at) })),
      });
    },
  );

  if (ctx.access !== "write") return;

  server.registerTool(
    "content_suggest_media_description",
    {
      title: "Suggest a media description",
      description: `Suggest the description, tags and details of one media file (people, setting, mood, clothing, orientation, author in photo). ${SUGGESTION_NOTE} A new suggestion replaces your previous one for that file.`,
      inputSchema: {
        media_id: idSchema,
        description: z.string().max(2000).optional(),
        tags: z.array(z.string().min(1).max(40)).max(20).optional(),
        people: z.array(z.string().min(1).max(80)).max(20).optional(),
        setting: z.string().max(200).optional(),
        mood: z.string().max(200).optional(),
        clothing: z.string().max(200).optional(),
        orientation: z.enum(["portrait", "landscape", "square"]).optional(),
        author_in_photo: z.boolean().optional(),
      },
      annotations: SUGGEST,
    },
    async ({ media_id, ...fields }) => {
      const suggestion = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Json;
      if (Object.keys(suggestion as object).length === 0) return fail("Give at least one field to suggest.");
      const { error } = await db.rpc("content_api_suggest_media", { p_media: media_id, p_suggestion: suggestion, p_actor: userId });
      if (error) return fail(errorText(error));
      return ok({ saved: true, note: "Shown as a suggestion on the file until someone accepts or rejects it." });
    },
  );

  server.registerTool(
    "content_suggest_images",
    {
      title: "Suggest images for a post",
      description: `Suggest up to 3 media files for a post, each with a short reason and a score from 1 to 5. ${SUGGESTION_NOTE} A post has at most 3 open image suggestions.`,
      inputSchema: {
        post_id: idSchema,
        items: z
          .array(
            z.object({
              media_id: idSchema,
              reason: z.string().min(1).max(500),
              score: z.number().int().min(1).max(5),
            }),
          )
          .min(1)
          .max(3),
      },
      annotations: SUGGEST,
    },
    async ({ post_id, items }) => {
      const { data, error } = await db.rpc("content_api_suggest_images", { p_post: post_id, p_items: items as Json, p_actor: userId });
      if (error) return fail(errorText(error));
      return ok({ saved: data ?? items.length });
    },
  );

  server.registerTool(
    "content_suggest_image_brief",
    {
      title: "Suggest an image brief",
      description: `Write the image brief of a post when no existing photo fits: what is in it, setting, mood, who is in it, type (photo, screenshot, graphic) and format (portrait 4:5, square). ${SUGGESTION_NOTE} You can only fill an empty brief or replace your own.`,
      inputSchema: {
        post_id: idSchema,
        what: z.string().min(1).max(500),
        setting: z.string().max(500).optional(),
        mood: z.string().max(500).optional(),
        who: z.string().max(500).optional(),
        type: z.string().max(100).optional(),
        format: z.string().max(100).optional(),
      },
      annotations: SUGGEST,
    },
    async ({ post_id, ...brief }) => {
      const { error } = await db.rpc("content_api_suggest_image_brief", {
        p_post: post_id,
        p_brief: Object.fromEntries(Object.entries(brief).filter(([, v]) => v !== undefined)) as Json,
        p_actor: userId,
      });
      if (error) return fail(errorText(error));
      return ok({ saved: true });
    },
  );

  server.registerTool(
    "content_suggest_text",
    {
      title: "Suggest a text change",
      description: `Suggest replacing a piece of the text of a post (title, hook, body, closing question or first comment). Copy the original text exactly from content_get_post; if it occurs more than once, pass occurrence (1 is the first). Leave original empty to add text at the end of the field. ${SUGGESTION_NOTE} Not possible once the post is published.`,
      inputSchema: {
        post_id: idSchema,
        field: z.enum(textFields),
        original: z.string().max(10_000).describe("The exact text to replace, as it is now."),
        replacement: z.string().max(10_000),
        occurrence: z.number().int().min(1).max(1000).optional(),
        note: z.string().max(2000).optional().describe("Why, in one sentence. Shown with the suggestion."),
      },
      annotations: SUGGEST,
    },
    async ({ post_id, field, original, replacement, occurrence, note }) => {
      if (original === replacement) return fail("The replacement is the same as the original.");
      if (!(await canViewPost(db, post_id, userId))) return fail("Post not found, or you have no access to it.");
      const { data: post } = await db.from("content_posts").select(field).eq("id", post_id).single();
      const current = String((post as Record<string, unknown> | null)?.[field] ?? "");
      const match = locateOriginal(current, original, occurrence);
      if (!match.ok) return fail(match.error);
      const { data, error } = await db.rpc("content_api_suggest_text", {
        p_post: post_id,
        p_field: field,
        p_start: match.start,
        p_original: original,
        p_replacement: replacement,
        p_note: note ?? null,
        p_actor: userId,
      });
      if (error) return fail(errorText(error));
      return ok({ suggestion_id: data, note: "The author accepts or rejects it in the post editor." });
    },
  );

  server.registerTool(
    "content_add_idea",
    {
      title: "Add an idea",
      description: "Add an idea or note for a next post to a content workspace (it stays apart from the posts until someone turns it into one).",
      inputSchema: {
        workspace: z.string().min(1).max(60).describe("Workspace slug or id."),
        text: z.string().trim().min(1).max(5000),
        tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
        link: z.url().max(2000).optional(),
      },
      annotations: WRITE,
    },
    async ({ workspace, text, tags, link }) => {
      const ws = (await visibleWorkspaces(db, userId)).find((w) => w.slug === workspace || w.id === workspace);
      if (!ws) return fail("Workspace not found, or you have no access to it.");
      const { data, error } = await db.rpc("content_api_add_idea", { p_workspace: ws.id, p_text: text, p_tags: tags, p_link: link ?? null, p_actor: userId });
      if (error) return fail(errorText(error));
      return ok({ idea_id: data, url: `${ctx.siteUrl.replace(/\/$/, "")}/content/w/${ws.slug}/ideas` });
    },
  );

  server.registerTool(
    "content_ideas_to_post",
    {
      title: "Turn ideas into a post",
      description: "Turn one or more ideas of one workspace into a draft post (the texts are combined), like Turn into post in the portal. The ideas become converted.",
      inputSchema: { idea_ids: z.array(idSchema).min(1).max(10), title: z.string().trim().max(300).optional() },
      annotations: WRITE,
    },
    async ({ idea_ids, title }) => {
      const { data, error } = await db.rpc("content_api_ideas_to_post", { p_ideas: idea_ids, p_title: title ?? null, p_actor: userId });
      if (error) return fail(errorText(error));
      return ok({ post_id: data, url: await postLink(data) });
    },
  );

  server.registerTool(
    "content_create_post",
    {
      title: "Create a post",
      description: `Create a post with every text field (title, hook, body, closing question, first comment), format, angle, theme, audience, language, priority, planned date, time slot, series and notes, in any status: draft, in_review, approved, scheduled or published. A post that already went live (for example from Airtable) gets status published with linkedin_url and published_at. The status rules of the portal apply (scheduled needs a date and time slot; published needs a LinkedIn URL). ${POST_FIELDS_NOTE}`,
      inputSchema: {
        workspace: z.string().min(1).max(60).describe("Workspace slug or id."),
        ...postFieldsSchema,
        title: z.string().trim().min(1).max(300),
        status: z.string().regex(/^[a-z][a-z0-9_]*$/).max(40).default("draft"),
      },
      annotations: WRITE,
    },
    async ({ workspace, status, ...fields }) => {
      const ws = (await visibleWorkspaces(db, userId)).find((w) => w.slug === workspace || w.id === workspace);
      if (!ws) return fail("Workspace not found, or you have no access to it.");
      const { data, error } = await db.rpc("content_api_create_post", {
        p_workspace: ws.id,
        p_fields: postFields(fields) as Json,
        p_status: status,
        p_actor: userId,
      });
      if (error) return fail(errorText(error));
      const { data: row } = await db.from("content_posts").select("status").eq("id", data).single();
      return ok({ post_id: data, status: row?.status ?? status, url: postUrl(ws.slug, data) });
    },
  );

  server.registerTool(
    "content_update_post",
    {
      title: "Change a post",
      description: `Change any field of a post and, with status, move it along the flow (draft, in_review, changes_requested, approved, scheduled, published, measured, parked, rejected); the steps in between are taken for you when the flow needs them. Leave out what stays the same; an empty string clears a field. ${POST_FIELDS_NOTE}`,
      inputSchema: {
        post_id: idSchema,
        ...postFieldsSchema,
        title: z.string().trim().min(1).max(300).optional(),
        status: z.string().regex(/^[a-z][a-z0-9_]*$/).max(40).optional(),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    async ({ post_id, status, ...fields }) => {
      if (!(await canViewPost(db, post_id, userId))) return fail("Post not found, or you have no access to it.");
      const { error } = await db.rpc("content_api_update_post", {
        p_post: post_id,
        p_fields: postFields(fields) as Json,
        p_status: status ?? null,
        p_actor: userId,
      });
      if (error) return fail(errorText(error));
      const { data: row } = await db.from("content_posts").select("status, version").eq("id", post_id).single();
      return ok({ post_id, status: row?.status, version: row?.version, url: await postLink(post_id) });
    },
  );

  server.registerTool(
    "content_archive_post",
    {
      title: "Archive a post",
      description: "Archive a post that is no longer needed (it leaves the lists, the calendar and the checks; nothing is deleted), or restore it with archived false.",
      inputSchema: { post_id: idSchema, archived: z.boolean().default(true) },
      annotations: { ...WRITE, idempotentHint: true },
    },
    async ({ post_id, archived }) => {
      const { error } = await db.rpc("content_api_archive_post", { p_post: post_id, p_archived: archived, p_actor: userId });
      if (error) return fail(errorText(error));
      return ok({ post_id, archived });
    },
  );

  server.registerTool(
    "content_set_post_media",
    {
      title: "Choose media for a post",
      description: "Choose the media of a post in this order (the first is the cover; carousels and documents keep the order). Replaces the current choice; an empty list removes all. Files come from the workspace library or the company library (content_list_media).",
      inputSchema: { post_id: idSchema, media_ids: z.array(idSchema).max(20) },
      annotations: { ...WRITE, idempotentHint: true },
    },
    async ({ post_id, media_ids }) => {
      const { data, error } = await db.rpc("content_api_set_post_media", { p_post: post_id, p_media: media_ids, p_actor: userId });
      if (error) return fail(errorText(error));
      return ok({ post_id, chosen: data ?? media_ids.length });
    },
  );

  server.registerTool(
    "content_add_media",
    {
      title: "Add a file to the library",
      description: `Put a photo, video or PDF in the media library of a workspace, or the company library (workspace omitted), from a link: a Google Drive link (the file or its folder must be shared with the portal's service account) or any public https link. At most ${LINK_MAX_BYTES / 1024 / 1024} MB. Give a description and tags right away.`,
      inputSchema: {
        workspace: z.string().min(1).max(60).optional().describe("Workspace slug or id; leave out for the company library."),
        url: z.url().max(2000),
        file_name: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        tags: z.array(z.string().min(1).max(40)).max(20).optional(),
        people: z.array(z.string().min(1).max(80)).max(20).optional(),
        setting: z.string().max(200).optional(),
        mood: z.string().max(200).optional(),
        folder: z.string().max(300).optional().describe("A folder name in the library, e.g. Photoshoot/Day 1."),
      },
      annotations: { ...WRITE, openWorldHint: true },
    },
    async ({ workspace, url, file_name, ...details }) => {
      let wsId: string | null = null;
      if (workspace) {
        const ws = (await visibleWorkspaces(db, userId)).find((w) => w.slug === workspace || w.id === workspace);
        if (!ws) return fail("Workspace not found, or you have no access to it.");
        wsId = ws.id;
      }
      let file: { bytes: ArrayBuffer; name: string; mime: string };
      try {
        file = await fetchMediaLink(url);
      } catch (error) {
        return fail(error instanceof Error ? error.message : "The file could not be fetched.");
      }
      const name = file_name ?? file.name;
      const path = `media/${wsId ?? "company"}/${crypto.randomUUID().slice(0, 8)}-${safeFileName(name)}`;
      const { error: uploadError } = await db.storage.from(CONTENT_BUCKET).upload(path, file.bytes, { contentType: file.mime, upsert: false });
      if (uploadError) return fail(`The file could not be stored: ${uploadError.message}`);
      const { data, error } = await db.rpc("content_api_add_media", {
        p_workspace: wsId,
        p_path: path,
        p_file_name: name,
        p_mime: file.mime,
        p_size: file.bytes.byteLength,
        p_details: Object.fromEntries(Object.entries(details).filter(([, v]) => v !== undefined)) as Json,
        p_source_url: url,
        p_actor: userId,
      });
      if (error) {
        await db.storage.from(CONTENT_BUCKET).remove([path]);
        return fail(errorText(error));
      }
      return ok({ media_id: data, file_name: name, size_bytes: file.bytes.byteLength });
    },
  );

  server.registerTool(
    "content_describe_media",
    {
      title: "Describe a file",
      description: "Write the description, tags and details (people, setting, mood, clothing, orientation, author in photo) of a library file directly. content_suggest_media_description proposes them instead.",
      inputSchema: {
        media_id: idSchema,
        description: z.string().max(2000).optional(),
        tags: z.array(z.string().min(1).max(40)).max(20).optional(),
        people: z.array(z.string().min(1).max(80)).max(20).optional(),
        setting: z.string().max(200).optional(),
        mood: z.string().max(200).optional(),
        clothing: z.string().max(200).optional(),
        orientation: z.enum(["portrait", "landscape", "square"]).optional(),
        author_in_photo: z.boolean().optional(),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    async ({ media_id, ...fields }) => {
      const details = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Json;
      if (Object.keys(details as object).length === 0) return fail("Give at least one field.");
      const { error } = await db.rpc("content_api_describe_media", { p_media: media_id, p_details: details, p_actor: userId });
      if (error) return fail(errorText(error));
      return ok({ saved: true });
    },
  );

  server.registerTool(
    "content_record_results",
    {
      title: "Record results",
      description:
        "Record the results of a live post: impressions (reach), likes, comments and reposts, as often as you like, so you see how a post develops. With linkedin_url (and published_at) a post that is approved but not marked live yet becomes published. slot 48h or 7d also fills that measurement for the success threshold and Measured.",
      inputSchema: {
        post_id: idSchema,
        impressions: z.number().int().min(0).optional(),
        likes: z.number().int().min(0).default(0),
        comments: z.number().int().min(0).default(0),
        reposts: z.number().int().min(0).default(0),
        measured_at: z.iso.datetime({ offset: true }).optional().describe("When you looked; default now."),
        slot: z.enum(["48h", "7d"]).optional(),
        linkedin_url: z.url().max(2000).optional(),
        published_at: z.iso.datetime({ offset: true }).optional(),
      },
      annotations: WRITE,
    },
    async (input) => {
      const { data, error } = await db.rpc("content_api_record_results", {
        p_post: input.post_id,
        p_measured_at: input.measured_at ?? null,
        p_impressions: input.impressions ?? null,
        p_likes: input.likes,
        p_comments: input.comments,
        p_reposts: input.reposts,
        p_slot: input.slot ?? null,
        p_linkedin_url: input.linkedin_url ?? null,
        p_published_at: input.published_at ?? null,
        p_actor: userId,
      });
      if (error) return fail(errorText(error));
      return ok({ measurement_id: data, likes_and_comments: input.likes + input.comments });
    },
  );

  async function postLink(postId: string) {
    const { data: post } = await db.from("content_posts").select("workspace_id").eq("id", postId).maybeSingle();
    if (!post) return null;
    const { data: ws } = await db.from("content_workspaces").select("slug").eq("id", post.workspace_id).maybeSingle();
    return ws ? postUrl(ws.slug, postId) : null;
  }
}
