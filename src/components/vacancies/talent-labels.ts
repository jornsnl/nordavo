import type { VacancySource } from "@/lib/database.types";
import type { Tone } from "@/lib/labels";

/** Where a vacancy came from (vacancies.source). */
export const vacancySources: { value: VacancySource; label: string; tone: Tone }[] = [
  { value: "klant_eigen", label: "Vacature van de klant", tone: "neutral" },
  { value: "samen_opgesteld", label: "Samen opgesteld", tone: "brand" },
  { value: "gescrapet", label: "Gescrapet", tone: "neutral" },
];

export function sourceLabel(value: VacancySource | null) {
  return vacancySources.find((s) => s.value === value)?.label ?? null;
}
