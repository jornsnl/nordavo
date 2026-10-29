// Mentions are stored in the comment text as @[Name](user id), so the text
// stays readable in exports and e-mails and the ids survive renames.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const MENTION_RE = new RegExp(`@\\[([^\\]\\n]{1,80})\\]\\((${UUID})\\)`, "gi");

export function mentionToken(name: string, userId: string): string {
  return `@[${name.replace(/[\[\]\n]/g, "").trim() || "someone"}](${userId})`;
}

/** Distinct user ids mentioned in a text. */
export function parseMentions(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(MENTION_RE)) ids.add(match[2].toLowerCase());
  return [...ids];
}

/** "@[Floris](id) can you check" to "@Floris can you check". */
export function plainMentions(body: string): string {
  return body.replace(MENTION_RE, (_, name: string) => `@${name}`);
}
