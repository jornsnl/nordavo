import type { ApplicationStage, ClientDecision } from "@/lib/database.types";
import type { Tone } from "@/lib/labels";

/** Client facing wording for the stages a client can see. */
export const portalStageLabels: Partial<Record<ApplicationStage, { label: string; tone: Tone }>> = {
  presented: { label: "Voorgesteld", tone: "accent" },
  final_interview: { label: "Eindgesprekken", tone: "brand" },
  placed: { label: "Geplaatst", tone: "success" },
};

export const portalDecisionLabels: Record<ClientDecision, { label: string; tone: Tone }> = {
  pending: { label: "Wacht op jouw reactie", tone: "warning" },
  approved: { label: "Akkoord", tone: "success" },
  rejected: { label: "Afgewezen", tone: "danger" },
};
