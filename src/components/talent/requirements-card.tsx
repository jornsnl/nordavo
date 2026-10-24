import { CircleHelp, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { hasClaude } from "@/lib/ai/claude";
import type { Vacancy } from "@/lib/database.types";
import { formatCurrency, formatDate } from "@/lib/format";
import { optionFor, seniorities } from "@/lib/labels";
import { extractVacancyAction, resolveUnclearAction, saveRequirementsAction } from "@/app/dashboard/vacatures/talent-actions";
import { ActionButton } from "./action-button";
import { IntakePanel } from "./intake-panel";

function budgetText(min: number | null, max: number | null) {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return `${formatCurrency(min)} tot ${formatCurrency(max)} per maand`;
  if (min !== null) return `Vanaf ${formatCurrency(min)} per maand`;
  return `Tot ${formatCurrency(max)} per maand`;
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-ink marker:text-accent-500">
      {items.map((item, i) => (
        <li key={`${item}-${i}`}>{item}</li>
      ))}
    </ul>
  );
}

/** T1: the fixed requirements ("vaste eisen") of a vacancy, with the intake panel. */
export function RequirementsCard({ vacancy }: { vacancy: Vacancy }) {
  const hasRequirements = vacancy.stack.length > 0 || vacancy.must_haves.length > 0;
  const contact = vacancy.client_contact_required;

  return (
    <Card>
      <CardHeader
        title="Vaste eisen"
        description={
          vacancy.intake_at
            ? `Intake op ${formatDate(vacancy.intake_at)}. Deze eisen gebruikt de matching.`
            : "Nog geen intake. Lees de vacature uit, dan zet Claude de tekst om in vaste eisen."
        }
      />
      <CardBody className="space-y-5">
        {contact === true && (
          <p role="alert" className="flex gap-2 rounded-xl border border-danger/20 bg-danger-bg px-3 py-2.5 text-sm text-danger">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <strong className="font-semibold">No go:</strong> de developer moet direct contact hebben met de klanten van de klant.
              Bespreek dit met de klant voor je kandidaten voorstelt.
            </span>
          </p>
        )}

        {hasRequirements ? (
          <>
            <DetailList
              items={[
                { label: "Senioriteit", value: optionFor(seniorities, vacancy.seniority).label },
                { label: "Uren per week", value: vacancy.hours ? `${vacancy.hours} uur` : null },
                { label: "Overlap tijdzone", value: vacancy.timezone_overlap },
                { label: "Budget", value: budgetText(vacancy.budget_min, vacancy.budget_max) },
                {
                  label: "Klantcontact",
                  value: contact === null ? null : contact ? "Ja, direct met klanten van de klant" : "Nee",
                },
              ]}
            />
            <div className="space-y-2">
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Stack</h3>
              {vacancy.stack.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {vacancy.stack.map((item, i) => (
                    <li key={`${item}-${i}`}>
                      <Badge tone="brand">{item}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Geen stack ingevuld.</p>
              )}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Must haves</h3>
                <List items={vacancy.must_haves} empty="Geen must haves." />
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Nice to haves</h3>
                <List items={vacancy.nice_to_haves} empty="Geen nice to haves." />
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">Nog geen vaste eisen. Zonder stack of must haves kan de matching niet draaien.</p>
        )}

        {vacancy.unclear.length > 0 && (
          <div className="rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
              <CircleHelp className="size-4" aria-hidden="true" />
              Nog navragen bij de klant
            </h3>
            <ul className="mt-2 space-y-1.5">
              {vacancy.unclear.map((item, i) => (
                <li key={`${item}-${i}`} className="flex items-start gap-2 text-sm text-amber-950">
                  <ActionButton
                    action={resolveUnclearAction.bind(null, vacancy.id, item)}
                    variant="ghost"
                    size="sm"
                    feedback={false}
                    ariaLabel={`Afvinken: ${item}`}
                    className="-my-1 shrink-0"
                  >
                    <span aria-hidden="true" className="block size-4 rounded border-2 border-amber-700/60 bg-white" />
                  </ActionButton>
                  <span className="pt-0.5">{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-amber-800">Vink een vraag af zodra je het antwoord hebt en verwerk het in de eisen.</p>
          </div>
        )}

        <div className="border-t border-border pt-4">
          <IntakePanel
            extractAction={extractVacancyAction.bind(null, vacancy.id)}
            saveAction={saveRequirementsAction.bind(null, vacancy.id)}
            hasClaude={hasClaude()}
            defaultText={vacancy.raw_text ?? vacancy.description ?? ""}
            current={{
              stack: vacancy.stack,
              seniority: vacancy.seniority,
              hours: vacancy.hours,
              timezone_overlap: vacancy.timezone_overlap,
              budget_min: vacancy.budget_min,
              budget_max: vacancy.budget_max,
              client_contact_required: vacancy.client_contact_required,
              must_haves: vacancy.must_haves,
              nice_to_haves: vacancy.nice_to_haves,
              unclear: vacancy.unclear,
            }}
          />
        </div>
      </CardBody>
    </Card>
  );
}
