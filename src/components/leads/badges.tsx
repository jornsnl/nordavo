import type {
  ActivityOutcome,
  CompanyStatus,
  ContactStatus,
  EmailStatus,
  IcpDecision,
  Segment,
  SignalType,
} from "@/lib/database.types";
import { Badge } from "@/components/ui/badge";
import {
  activityOutcomes,
  companyStatuses,
  contactStatuses,
  contactTiers,
  emailStatuses,
  icpDecisions,
  optionFor,
  segments,
  signalTypes,
} from "@/lib/labels";

export function IcpBadge({ decision, score }: { decision: IcpDecision | null; score?: number | null }) {
  if (!decision) {
    return <Badge tone="neutral">Nog niet beoordeeld</Badge>;
  }
  const option = optionFor(icpDecisions, decision);
  return (
    <Badge tone={option.tone}>
      {option.label}
      {score !== null && score !== undefined && (
        <span className="tabular-nums opacity-80">
          <span aria-hidden="true">· </span>
          <span className="sr-only">score </span>
          {score}
        </span>
      )}
    </Badge>
  );
}

export function SegmentBadge({ segment }: { segment: Segment | null }) {
  if (!segment) return <span className="text-muted">Geen segment</span>;
  const option = optionFor(segments, segment);
  return <Badge tone={option.tone}>{option.label}</Badge>;
}

export function CompanyStatusBadge({ status }: { status: CompanyStatus }) {
  const option = optionFor(companyStatuses, status);
  return <Badge tone={option.tone}>{option.label}</Badge>;
}

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  const option = optionFor(contactStatuses, status);
  return <Badge tone={option.tone}>{option.label}</Badge>;
}

export function SignalTypeBadge({ type }: { type: SignalType }) {
  const option = optionFor(signalTypes, type);
  return <Badge tone={option.tone}>{option.label}</Badge>;
}

export function EmailStatusBadge({ status }: { status: EmailStatus | null }) {
  if (!status) return <Badge tone="neutral">Niet gecontroleerd</Badge>;
  const option = optionFor(emailStatuses, status);
  return <Badge tone={option.tone}>{option.label}</Badge>;
}

export function OutcomeBadge({ outcome }: { outcome: ActivityOutcome }) {
  const option = optionFor(activityOutcomes, outcome);
  return <Badge tone={option.tone}>{option.label}</Badge>;
}

/** "Tier 1" with the full description as tooltip. */
export function TierBadge({ tier }: { tier: number | null }) {
  if (!tier) return <span className="text-muted">Geen tier</span>;
  const option = optionFor(contactTiers, String(tier) as "1" | "2" | "3");
  return (
    <span title={option.label}>
      <Badge tone={option.tone}>Tier {tier}</Badge>
    </span>
  );
}
