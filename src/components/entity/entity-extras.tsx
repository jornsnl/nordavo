import type { EntityType } from "@/lib/database.types";

export type EntityRef = { entityType: EntityType; entityId: string };

/**
 * Tasks, notes, attachments and activity for one record, shown on every
 * detail page (client, vacancy, candidate, placement).
 *
 * Contract: an async Server Component. Render it inside a <Suspense>
 * boundary; it calls requireStaff() itself.
 *
 * PLACEHOLDER: implemented by the generic building blocks work.
 */
export async function EntityExtras({ entityType, entityId }: EntityRef) {
  void entityType;
  void entityId;
  return null;
}
