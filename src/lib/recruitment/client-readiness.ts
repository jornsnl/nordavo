/**
 * What a client needs before it is Active (feedback round 3): an owner and
 * at least one contact person are required; city and industry only warn.
 * Pure, so the actions, the client page and the tests share it.
 */

export type ClientReadinessInput = {
  owner_id: string | null;
  city: string | null;
  industry: string | null;
  contactCount: number;
};

export type ClientReadiness = {
  /** Blocks status Active. */
  missing: string[];
  /** Worth filling in, does not block. */
  warnings: string[];
};

export function clientReadiness(c: ClientReadinessInput): ClientReadiness {
  const missing: string[] = [];
  const warnings: string[] = [];
  if (!c.owner_id) missing.push("an owner");
  if (c.contactCount < 1) missing.push("a contact person");
  if (!c.city?.trim()) warnings.push("city");
  if (!c.industry?.trim()) warnings.push("industry");
  return { missing, warnings };
}

/** "an owner and a contact person" */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function activeBlockedMessage(missing: string[]): string {
  return `A client can only be Active with ${joinList(missing)}. Save it as Lead, add what is missing, then set it to Active.`;
}
