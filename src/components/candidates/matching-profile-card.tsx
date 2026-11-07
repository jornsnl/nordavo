import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { Candidate } from "@/lib/database.types";
import { listCandidateMatches } from "@/lib/data/matches";
import { matchStatuses, optionFor } from "@/lib/labels";
import { consentOptions, consentValue, seniorityOptions } from "./matching-fields";

type Values = Pick<
  Candidate,
  "id" | "seniority" | "employers" | "project_types" | "sectors" | "cv_text" | "english_level" | "availability" | "profile_consent"
>;

function Value({ children }: { children: React.ReactNode }) {
  return <dd className="mt-1 text-sm break-words text-ink">{children ?? <span className="text-muted">Not set</span>}</dd>;
}

/** What T2 matching and the anonymous profile read from this candidate, plus the vacancies it was matched to. */
export async function MatchingProfileCard({ candidate }: { candidate: Values }) {
  const matches = await listCandidateMatches(candidate.id);
  const seniority = seniorityOptions.find((o) => o.value === candidate.seniority)?.label ?? null;
  const consent = consentOptions.find((o) => o.value === consentValue(candidate.profile_consent))?.label;
  const items: [string, React.ReactNode][] = [
    ["Seniority", seniority],
    ["English", candidate.english_level],
    ["Availability", candidate.availability],
    ["Profile consent", consent],
    ["Employers", candidate.employers.length > 0 ? candidate.employers.join(", ") : null],
    ["Project types", candidate.project_types.length > 0 ? candidate.project_types.join(", ") : null],
    ["Sectors", candidate.sectors.length > 0 ? candidate.sectors.join(", ") : null],
    ["CV text", candidate.cv_text ? `${candidate.cv_text.length.toLocaleString("en")} characters` : null],
  ];

  return (
    <Card>
      <CardHeader title="Matching" description="What talent matching (T2) and the anonymous profile read. Change it with the edit button." />
      <CardBody className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:gap-x-6">
          {items.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
              <Value>{value}</Value>
            </div>
          ))}
        </dl>
        <div>
          <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Matched to</h3>
          {matches.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No matches yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {matches.map((m) => {
                const status = optionFor(matchStatuses, m.status);
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
                    {m.vacancy ? (
                      <Link href={`/dashboard/vacatures/${m.vacancy.id}`} className="font-medium text-brand-700 hover:underline">
                        {m.vacancy.title}
                      </Link>
                    ) : (
                      <span className="text-muted">Unknown vacancy</span>
                    )}
                    <span className="text-muted">score {m.score ?? "n/a"}</span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
