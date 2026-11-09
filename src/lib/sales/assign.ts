// Spreading contacts over callers (Call lists, AssignCallersDialog). Pure.

/**
 * Round robin over the callers, one company at a time: all contacts of a
 * company go to the same caller (the company is the unit), the next company
 * to the next caller. Keeps the order of the input.
 */
export function roundRobinByCompany(
  contacts: { id: string; company_id: string }[],
  callerIds: string[],
): Map<string, string[]> {
  const out = new Map<string, string[]>(callerIds.map((id) => [id, []]));
  if (callerIds.length === 0) return out;
  const companyIndex = new Map<string, number>();
  for (const c of contacts) {
    if (!companyIndex.has(c.company_id)) companyIndex.set(c.company_id, companyIndex.size);
    const caller = callerIds[companyIndex.get(c.company_id)! % callerIds.length];
    out.get(caller)!.push(c.id);
  }
  return out;
}
