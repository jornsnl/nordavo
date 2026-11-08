import { Suspense } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { getCandidateCompensation, type CompensationItem } from "@/lib/forms/data";
import { CompensationEditor, Payslips } from "./compensation-editor";

/**
 * Candidate page: asked and negotiated CTC or hourly rate per vacancy, in
 * INR and EUR, and the payslip. Staff only, never shown to clients.
 */
export function CompensationCard({ candidateId }: { candidateId: string }) {
  return (
    <Suspense fallback={<ListSkeleton rows={3} />}>
      <Compensation candidateId={candidateId} />
    </Suspense>
  );
}

async function Compensation({ candidateId }: { candidateId: string }) {
  const { items, missing, payslips, rate } = await getCandidateCompensation(candidateId);
  const all: CompensationItem[] = [
    ...items,
    ...missing.map((m) => ({
      applicationId: m.applicationId,
      vacancyId: "",
      vacancyTitle: m.vacancyTitle,
      roleType: m.roleType,
      currentCtc: null,
      expectedCtc: null,
      askedHourly: null,
      negotiatedCtc: null,
      negotiatedHourly: null,
      negotiatedRate: null,
      negotiatedRateDate: null,
      negotiatedAt: null,
      payslipRequestedAt: null,
      notes: null,
    })),
  ];

  return (
    <Card>
      <CardHeader title="Compensation" description="Asked in the form and negotiated by us. Internal only." />
      <CardBody className="space-y-5">
        {all.length === 0 ? (
          <p className="text-sm text-muted">Link the candidate to a vacancy to record compensation.</p>
        ) : (
          <ul className="divide-y divide-border">
            {all.map((item) => (
              <li key={item.applicationId} className="py-4 first:pt-0 last:pb-0">
                <CompensationEditor item={item} rate={rate} candidateId={candidateId} payslips={payslips} showPayslips={false} />
              </li>
            ))}
          </ul>
        )}
        <Payslips candidateId={candidateId} payslips={payslips} />
      </CardBody>
    </Card>
  );
}
