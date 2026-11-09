import { GraduationCap } from "lucide-react";
import { getPlacementAutomation } from "@/lib/academy/ats/data";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { atsEventTone } from "./labels";
import { RunPlacementAcademyButton } from "./placement-run";

const steps: { key: string; label: string }[] = [
  { key: "developer_account", label: "Developer account" },
  { key: "client_account", label: "Client contact" },
  { key: "welcome_developer", label: "Welcome mail developer" },
  { key: "welcome_client", label: "Welcome mail client" },
];

function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

/** Status placed in the Academy: what the automation did for this placement. */
export async function PlacementAcademyCard({ placementId }: { placementId: string }) {
  const data = await getPlacementAutomation(placementId);
  if (!data) return null;
  const { event, canManage } = data;
  const result = (event?.result && typeof event.result === "object" && !Array.isArray(event.result) ? event.result : {}) as Record<string, unknown>;
  const database = (result.database && typeof result.database === "object" ? result.database : {}) as Record<string, unknown>;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <GraduationCap className="size-4 text-brand-700" aria-hidden="true" />
            Academy
          </span>
        }
        description="Placed: developer gets the whole developer course, the client contact the client course, the placement page its timeline."
      />
      <CardBody className="space-y-3 text-sm">
        {!event ? (
          <p className="text-muted">No automation for this placement (recorded before the Academy link).</p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={atsEventTone(event.status)}>{event.status}</Badge>
              <span className="text-xs text-muted">{event.processed_at ? formatDateTime(event.processed_at) : formatDateTime(event.created_at)}</span>
            </p>
            {event.error && <p className="text-danger">{event.error}</p>}
            <dl className="space-y-1">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Developer in the Academy</dt>
                <dd>{text(database.developer) ?? "–"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Client contact</dt>
                <dd>{text(database.client_contact) ?? text(result.client_account) ?? "–"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Milestones, rituals, task dates</dt>
                <dd className="tabular-nums">
                  {text(database.milestones_added) ?? "–"} / {text(database.rituals_added) ?? "–"} / {text(database.task_deadlines) ?? "–"}
                </dd>
              </div>
              {steps.map((s) =>
                text(result[s.key]) ? (
                  <div key={s.key} className="flex justify-between gap-3">
                    <dt className="text-muted">{s.label}</dt>
                    <dd className="text-right">{text(result[s.key])}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          </>
        )}
        {canManage && <RunPlacementAcademyButton placementId={placementId} again={Boolean(event)} />}
      </CardBody>
    </Card>
  );
}
