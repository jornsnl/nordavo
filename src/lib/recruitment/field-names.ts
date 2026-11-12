/**
 * Warning for a new custom field whose name is already taken (feedback
 * round 3): by a fixed field of the record type, or by a custom field of
 * another record type (as happened with notice period and LinkedIn
 * profile on vacancies, which are candidate data). Pure.
 */

type Entity = string;

/** Fixed fields per record type, by the names people would type. */
export const CORE_FIELD_NAMES: Record<Entity, string[]> = {
  candidate: [
    "Name", "Full name", "Email", "Phone", "Location", "Current title", "Role", "Years of experience", "Experience", "Skills",
    "LinkedIn", "LinkedIn profile", "Video intro", "Summary", "Status", "Owner", "Seniority", "English level", "Availability",
    "Employers", "Project types", "Sectors", "CV", "CV text", "Notice period", "Current company", "Willing to relocate",
    "Current CTC", "Expected CTC", "Source", "Origin",
  ],
  vacancy: [
    "Title", "Job title", "Job profile", "Description", "Stack", "Seniority", "Status", "Budget", "Monthly budget",
    "Minimum budget", "Maximum budget", "Desired start", "Desired start date", "Start time", "Hours", "Hours per week",
    "Time zone overlap", "Must haves", "Nice to haves", "Owner", "Client", "Source", "Presentation deadline", "Talent stage",
  ],
  application: ["Stage", "Video score", "Technical score", "English score", "CV score", "Interview", "Client decision", "Source", "Origin"],
  client: ["Name", "Website", "Industry", "City", "Location", "Status", "Owner", "Notes"],
  placement: ["Start date", "End date", "Monthly rate", "Hours per week", "Status", "Notice period", "Notes"],
};

const ENTITY_LABEL: Record<Entity, string> = {
  candidate: "candidates",
  vacancy: "vacancies",
  application: "applications",
  client: "clients",
  placement: "placements",
};

/** Lower case letters and digits only, so "LinkedIn-profile" and "linkedin profile" compare equal. */
export function fieldNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export type FieldNameClash = { kind: "core" | "custom_same" | "other"; entity: Entity; label: string };

/**
 * Clashes for a field name on a record type: a fixed field of that type,
 * a custom field of that type, or a fixed or custom field of another type.
 */
export function fieldNameClashes(
  label: string,
  entity: Entity,
  existing: { label: string; key: string; entity: Entity; id?: string }[],
  options: { ignoreId?: string } = {},
): FieldNameClash[] {
  const key = fieldNameKey(label);
  if (key.length < 2) return [];
  const out: FieldNameClash[] = [];
  for (const core of CORE_FIELD_NAMES[entity] ?? []) {
    if (fieldNameKey(core) === key) out.push({ kind: "core", entity, label: core });
  }
  for (const f of existing) {
    if (options.ignoreId && f.id === options.ignoreId) continue;
    if (fieldNameKey(f.label) !== key && fieldNameKey(f.key) !== key) continue;
    out.push({ kind: f.entity === entity ? "custom_same" : "other", entity: f.entity, label: f.label });
  }
  // Fixed fields of other record types, unless the name is generic (on three or more types, like Status or Owner).
  const typesWithName = Object.values(CORE_FIELD_NAMES).filter((names) => names.some((n) => fieldNameKey(n) === key)).length;
  for (const [other, names] of Object.entries(CORE_FIELD_NAMES)) {
    if (other === entity || typesWithName >= 3) continue;
    const hit = names.find((n) => fieldNameKey(n) === key);
    if (hit && !out.some((c) => c.entity === other)) out.push({ kind: "other", entity: other, label: hit });
  }
  return out;
}

/** One sentence for the form, or null. */
export function fieldNameWarning(clashes: FieldNameClash[], entity: Entity): string | null {
  if (clashes.length === 0) return null;
  const core = clashes.find((c) => c.kind === "core");
  if (core) return `"${core.label}" is already a fixed field on ${ENTITY_LABEL[entity] ?? entity}. Use that field instead of a new one.`;
  const same = clashes.find((c) => c.kind === "custom_same");
  if (same) return `There is already a field "${same.label}" on ${ENTITY_LABEL[entity] ?? entity}.`;
  const others = [...new Set(clashes.map((c) => ENTITY_LABEL[c.entity] ?? c.entity))];
  return `A field with this name exists on ${others.join(" and ")}. Is this really data of ${ENTITY_LABEL[entity] ?? entity}?`;
}
