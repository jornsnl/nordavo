import type { VacancySource } from "@/lib/database.types";
import type { Tone } from "@/lib/labels";

/** Where a vacancy came from (vacancies.source). */
export const vacancySources: { value: VacancySource; label: string; tone: Tone }[] = [
  { value: "klant_eigen", label: "Client's own vacancy", tone: "neutral" },
  { value: "samen_opgesteld", label: "Written together", tone: "brand" },
  { value: "gescrapet", label: "Scraped", tone: "neutral" },
];

export function sourceLabel(value: VacancySource | null) {
  return vacancySources.find((s) => s.value === value)?.label ?? null;
}
