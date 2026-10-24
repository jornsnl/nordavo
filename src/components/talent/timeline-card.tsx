import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { Vacancy } from "@/lib/database.types";
import { daysBetween, formatDate } from "@/lib/format";
import { optionFor, talentStages } from "@/lib/labels";
import { LEAD_TIME_LIMIT_DAYS, type LeadTime } from "@/lib/talent/lead-time";
import { updateTimelineAction } from "@/app/dashboard/vacatures/talent-actions";
import { LeadTimeSignal } from "./lead-time-signal";
import { TimelineForm } from "./timeline-form";

/** YYYY-MM-DD in Amsterdam for a date input. */
function dateInput(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date(value));
}

/** T6 doorlooptijd: intake, profiles sent, first interview and start. */
export function TimelineCard({ vacancy, leadTime }: { vacancy: Vacancy; leadTime: LeadTime }) {
  const stage = optionFor(talentStages, vacancy.talent_stage);
  const steps = [
    { label: "Intake", date: vacancy.intake_at },
    { label: "Profielen verstuurd", date: vacancy.profiles_sent_at },
    { label: "Eerste gesprek", date: vacancy.first_interview_at },
    { label: "Start", date: vacancy.start_at },
  ];
  const sinceIntake = (date: string | null) =>
    vacancy.intake_at && date ? Math.max(0, daysBetween(vacancy.intake_at, date)) : null;

  return (
    <Card>
      <CardHeader
        title="Doorlooptijd"
        description="Belofte: drie kandidaten binnen drie weken na de intake."
        actions={<Badge tone={stage.tone}>{stage.label}</Badge>}
      />
      <CardBody className="space-y-5">
        <p className="text-sm">
          <LeadTimeSignal leadTime={leadTime} />
        </p>
        {(leadTime.level === "warning" || leadTime.level === "danger") && !vacancy.profiles_sent_at && (
          <p
            role="alert"
            className={`flex gap-2 rounded-xl border px-3 py-2.5 text-sm ${
              leadTime.level === "danger" ? "border-danger/20 bg-danger-bg text-danger" : "border-amber-600/20 bg-amber-50 text-amber-900"
            }`}
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {leadTime.level === "danger"
              ? `Al meer dan ${LEAD_TIME_LIMIT_DAYS} dagen na de intake en nog geen profielen verstuurd. Bespreek met Floris wat er nodig is.`
              : "Deze vacature loopt richting de 3 weken zonder verstuurde profielen. Tijd om op te schalen."}
          </p>
        )}
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {steps.map((step, i) => {
            const days = i === 0 ? null : sinceIntake(step.date);
            return (
              <li
                key={step.label}
                className={`rounded-xl border px-3 py-2.5 ${step.date ? "border-brand-100 bg-brand-50/50" : "border-dashed border-border"}`}
              >
                <span className="block text-xs text-muted">{step.label}</span>
                <span className={`mt-0.5 block text-sm font-semibold ${step.date ? "text-brand-900" : "text-muted"}`}>
                  {formatDate(step.date, "Nog niet")}
                </span>
                {days !== null && <span className="block text-xs text-muted">dag {days}</span>}
              </li>
            );
          })}
        </ol>
        <TimelineForm
          action={updateTimelineAction.bind(null, vacancy.id)}
          dates={{
            intake_at: dateInput(vacancy.intake_at),
            profiles_sent_at: dateInput(vacancy.profiles_sent_at),
            first_interview_at: dateInput(vacancy.first_interview_at),
            start_at: vacancy.start_at ?? "",
          }}
        />
      </CardBody>
    </Card>
  );
}
