import type { ApplicationStage, ClientDecision } from "@/lib/database.types";
import type { Tone } from "@/lib/labels";

/** Client facing wording for the stages a client can see. */
export const portalStageLabels: Partial<Record<ApplicationStage, { label: string; tone: Tone }>> = {
  presented: { label: "Presented", tone: "accent" },
  final_interview: { label: "Final interviews", tone: "brand" },
  placed: { label: "Placed", tone: "success" },
};

export const portalDecisionLabels: Record<ClientDecision, { label: string; tone: Tone }> = {
  pending: { label: "Awaiting your response", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
};
