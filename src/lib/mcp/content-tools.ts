import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import type { ContentRole, ContentTextField } from "@/lib/content/database";
import { locateOriginal } from "@/lib/content/text-match";
import { linkedInText } from "@/lib/content/rules";
import { check, fail, idSchema, ok, type McpDb, type McpToolContext } from "@/lib/mcp/shared";

/**
 * Content module tools (docs/content.md) for the token owner's own Claude.
 * Reads follow the owner's rights in Content (content_api_role,
 * content_api_can_view_post: reviewers only see posts sent to review, ideas
 * are never exposed). Writes are suggestions only, through the
 * content_api_* functions: Claude never picks, approves, schedules or
 * publishes; a person decides on every suggestion in the portal.
 */

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
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
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).max(10_000).default(0),
      },
      annotations: READ_ONLY,
    },
    async ({ workspace, status, limit, offset }) => {
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
      if (ws.role === "reviewer") query = query.not("submitted_at", "is", null);
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
}
