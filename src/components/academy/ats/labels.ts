import type { AtsEventKind, AtsEventStatus } from "@/lib/academy/ats/database";
import type { AcademyModuleState } from "@/lib/academy/database";
import type { Tone } from "@/lib/labels";

// Labels of the Academy and ATS screens (English, like the dashboard).

const eventLabels: Record<AtsEventKind, string> = {
  placed: "Placed: accounts, courses and placement page",
  vacancy_linked: "Linked to a vacancy: developer course",
  top_candidate: "Top candidate: extra modules and mail",
  enrol: "Added to the developer course",
};

export function atsEventLabel(kind: string): string {
  return eventLabels[kind as AtsEventKind] ?? kind;
}

export function atsEventTone(status: string): Tone {
  const tones: Record<AtsEventStatus, Tone> = { pending: "warning", done: "success", skipped: "neutral", failed: "danger" };
  return tones[status as AtsEventStatus] ?? "neutral";
}

export function moduleStateText(state: AcademyModuleState | null): string {
  switch (state) {
    case "completed":
      return "Done";
    case "open":
      return "Open";
    case "locked_scope":
      return "Not open for this person";
    case "locked_release":
      return "Opens later";
    case "locked_requirement":
      return "Waits for another module";
    case "locked_order":
      return "Waits for the previous module";
    default:
      return "Not visible";
  }
}

export function submissionStatusText(status: string): string {
  return status === "approved" ? "Approved" : status === "changes_requested" ? "Changes requested" : "Waiting for a reply";
}
