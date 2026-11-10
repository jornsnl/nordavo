import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ContentEventRow } from "@/lib/content/database";

/**
 * Internal events of the content core. The database writes one row in
 * content_events for every idea created, post created, status change and
 * post published (and announces it with pg_notify on content_events). The
 * job content-notify claims new events and runs the handlers registered
 * here, so a new module hooks in with one call and no change to the core:
 *
 *   registerContentEventHandler("post_published", async (event, db) => { ... });
 *
 * Handlers run with the secret key, at least once per event: make them safe
 * to run twice (use a dedupe key). A failing handler is logged and does not
 * stop the others.
 */

type Db = SupabaseClient<Database>;

export type ContentEventKind = "idea_created" | "post_created" | "status_changed" | "post_published" | (string & {});
export type ContentEventHandler = (event: ContentEventRow, db: Db) => Promise<void>;

const handlers = new Map<string, ContentEventHandler[]>();

export function registerContentEventHandler(kind: ContentEventKind, handler: ContentEventHandler) {
  handlers.set(kind, [...(handlers.get(kind) ?? []), handler]);
}

export function contentEventHandlers(kind: string): ContentEventHandler[] {
  return handlers.get(kind) ?? [];
}

export type EventRunResult = { events: number; handled: number; failed: number };

export async function runContentEvents(db: Db, log: (message: string) => void = console.log): Promise<EventRunResult> {
  const result: EventRunResult = { events: 0, handled: 0, failed: 0 };
  for (let round = 0; round < 20; round++) {
    const { data: events, error } = await db.rpc("content_claim_events", { p_limit: 200 });
    if (error) throw new Error(`content_claim_events: ${error.message}`);
    if (!events || events.length === 0) break;
    result.events += events.length;
    for (const event of events) {
      for (const handler of contentEventHandlers(event.kind)) {
        try {
          await handler(event, db);
          result.handled++;
        } catch (e) {
          result.failed++;
          log(`event ${event.id} (${event.kind}) failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    if (events.length < 200) break;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Built-in handlers
// ---------------------------------------------------------------------------

/** After publishing, ask the author for the next idea (a note for a follow-up post). */
registerContentEventHandler("post_published", async (event, db) => {
  if (!event.entity_id) return;
  const { data: post } = await db
    .from("content_posts")
    .select("id, workspace_id, author_id, title, next_idea_done_at")
    .eq("id", event.entity_id)
    .maybeSingle();
  if (!post?.author_id || post.next_idea_done_at) return;
  // The same preferences as the database notifications (no row: both on).
  const { data: pref } = await db
    .from("content_notification_prefs")
    .select("in_app, email")
    .eq("user_id", post.author_id)
    .eq("kind", "next_idea")
    .maybeSingle();
  const inApp = pref?.in_app ?? true;
  const email = pref?.email ?? true;
  if (!inApp && !email) return;
  const { error } = await db.from("content_notifications").upsert(
    {
      user_id: post.author_id,
      workspace_id: post.workspace_id,
      post_id: post.id,
      kind: "next_idea",
      message: `Published: ${post.title.slice(0, 120)}. What is the next idea?`,
      dedupe_key: `next_idea:${post.id}`,
      read_at: inApp ? null : new Date().toISOString(),
      email_state: email ? "pending" : "skipped",
    },
    { onConflict: "dedupe_key", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
});
