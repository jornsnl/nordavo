"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { loadApplicationCompensation, type ApplicationCompensation } from "./compensation-actions";
import { CompensationEditor } from "./compensation-editor";

/**
 * Self contained compensation section for the pipeline card modal:
 * <CompensationSection applicationId={card.id} />. Loads its own data.
 */
export function CompensationSection({ applicationId }: { applicationId: string }) {
  const [data, setData] = useState<ApplicationCompensation | null | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let live = true;
    loadApplicationCompensation(applicationId)
      .then((result) => {
        if (live) setData(result);
      })
      .catch(() => {
        if (live) setData(null);
      });
    return () => {
      live = false;
    };
  }, [applicationId, version]);

  return (
    <section aria-labelledby={`comp-${applicationId}`} className="rounded-xl border border-border bg-surface/60 p-4">
      <h3 id={`comp-${applicationId}`} className="mb-3 font-display text-sm font-semibold text-brand-900">
        Compensation
      </h3>
      {data === undefined ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Loading
        </p>
      ) : data === null ? (
        <p className="text-sm text-muted">Compensation could not be loaded.</p>
      ) : (
        <CompensationEditor item={data.item} rate={data.rate} candidateId={data.candidateId} payslips={data.payslips} showVacancy={false} onSaved={reload} />
      )}
    </section>
  );
}
