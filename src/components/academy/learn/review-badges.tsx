import type { AcademySubmissionStatus } from "@/lib/academy/database";
import { Badge } from "@/components/ui/badge";

const labels: Record<AcademySubmissionStatus, { label: string; tone: "warning" | "accent" | "success" }> = {
  submitted: { label: "Waiting for Nordavo", tone: "warning" },
  changes_requested: { label: "Changes requested", tone: "accent" },
  approved: { label: "Approved", tone: "success" },
};

/** Status of an assignment submission in the (English) dashboard. */
export function SubmissionStatusBadge({ status }: { status: AcademySubmissionStatus }) {
  const { label, tone } = labels[status];
  return <Badge tone={tone}>{label}</Badge>;
}
