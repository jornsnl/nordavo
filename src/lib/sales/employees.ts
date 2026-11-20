// Company size as a range (02 Portaal aanpassingen leadregels, punt 11).
// The exact number stays in companies.employees (the rule "under 5 employees"
// and the imports need it); the portal and the MCP show the range.

export const employeeBands = [
  { key: "1_10", label: "1 tot 10", min: 0, max: 10 },
  { key: "11_50", label: "11 tot 50", min: 11, max: 50 },
  { key: "51_200", label: "51 tot 200", min: 51, max: 200 },
  { key: "201_500", label: "201 tot 500", min: 201, max: 500 },
  { key: "501_1000", label: "501 tot 1.000", min: 501, max: 999 },
  { key: "1000_plus", label: "1.000 en meer", min: 1000, max: Number.POSITIVE_INFINITY },
] as const;

export type EmployeeBand = (typeof employeeBands)[number];

/** The range a head count falls in, or null when it is not known. 0 counts as the first range. */
export function employeeBand(employees: number | null | undefined): EmployeeBand | null {
  if (employees === null || employees === undefined || !Number.isFinite(employees) || employees < 0) return null;
  return employeeBands.find((b) => employees >= b.min && employees <= b.max) ?? null;
}

/** "11 tot 50", "1.000 en meer" or null. */
export function employeesBandLabel(employees: number | null | undefined): string | null {
  return employeeBand(employees)?.label ?? null;
}
