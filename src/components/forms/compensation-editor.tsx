"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { FileText, LoaderCircle, Pencil, Upload } from "lucide-react";
import { saveCompensation, uploadPayslip } from "@/components/forms/compensation-actions";
import { initialActionState } from "@/lib/action-state";
import { ctcBreakdown, formatEur, formatInr, hourlyBreakdown } from "@/lib/forms/compensation";
import type { CompensationItem, ExchangeRate, Payslip } from "@/lib/forms/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";

function fmtDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(value.length === 10 ? `${value}T12:00:00Z` : value),
  );
}

/** Per year INR, per month INR and per month EUR. */
function Ctc({ label, amount, rate }: { label: string; amount: number | null; rate: number | null }) {
  if (amount === null) return <Line label={label} value={<span className="text-muted">Not filled in</span>} />;
  const b = ctcBreakdown(amount, rate);
  return (
    <Line
      label={label}
      value={
        <>
          <span className="font-medium">{formatInr(b.perYearInr)}</span> <span className="text-muted">per year</span>
          <span className="block text-xs text-muted">
            {formatInr(b.perMonthInr)} per month{b.perMonthEur !== null ? ` · ${formatEur(b.perMonthEur)} per month` : ""}
          </span>
        </>
      }
    />
  );
}

function Hourly({ label, amount, rate }: { label: string; amount: number | null; rate: number | null }) {
  if (amount === null) return <Line label={label} value={<span className="text-muted">Not filled in</span>} />;
  const b = hourlyBreakdown(amount, rate);
  return (
    <Line
      label={label}
      value={
        <>
          <span className="font-medium">{formatInr(b.perHourInr)}</span> <span className="text-muted">per hour</span>
          {b.perHourEur !== null && <span className="block text-xs text-muted">{formatEur(b.perHourEur)} per hour</span>}
        </>
      }
    />
  );
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}

/**
 * Asked (from the form) and negotiated (by staff) compensation for one
 * application, with the payslip. Used on the candidate page and in the
 * pipeline card modal. Staff only.
 */
export function CompensationEditor({
  item,
  rate,
  candidateId,
  payslips,
  showPayslips = true,
  showVacancy = true,
  onSaved,
}: {
  item: CompensationItem;
  rate: ExchangeRate | null;
  candidateId: string;
  payslips: Payslip[];
  showPayslips?: boolean;
  showVacancy?: boolean;
  /** Called after a save, for views that load their own data (the card modal). */
  onSaved?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(saveCompensation, initialActionState);
  useEffect(() => {
    if (state.ok) onSaved?.();
  }, [state, onSaved]);
  const current = rate?.inrPerEur ?? null;
  // Negotiated amounts use the rate saved with them.
  const negotiatedRate = item.negotiatedRate ?? current;
  const freelance = item.roleType === "freelance";
  const errors = state.fieldErrors ?? {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {showVacancy && <span className="font-medium text-brand-900">{item.vacancyTitle}</span>}
        <Badge tone="brand">{freelance ? "Freelance" : "Fulltime"}</Badge>
        {item.payslipRequestedAt && <Badge tone="warning">Payslip requested {fmtDate(item.payslipRequestedAt)}</Badge>}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
          <Pencil aria-hidden="true" />
          {editing ? "Close" : "Edit"}
        </Button>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {freelance ? (
          <>
            <Hourly label="Asked hourly rate" amount={item.askedHourly} rate={current} />
            <Hourly label="Negotiated hourly rate" amount={item.negotiatedHourly} rate={negotiatedRate} />
          </>
        ) : (
          <>
            <Ctc label="Current CTC" amount={item.currentCtc} rate={current} />
            <Ctc label="Expected CTC (asked)" amount={item.expectedCtc} rate={current} />
            <Ctc label="Negotiated CTC" amount={item.negotiatedCtc} rate={negotiatedRate} />
          </>
        )}
      </dl>
      <p className="text-xs text-muted">
        {rate ? `Asked amounts in EUR at ₹${rate.inrPerEur} per euro (rate of ${fmtDate(rate.rateDate)}).` : "No exchange rate set, so no EUR amounts. "}
        {item.negotiatedRate ? ` Negotiated at ₹${item.negotiatedRate} per euro (${fmtDate(item.negotiatedRateDate)}).` : ""}{" "}
        <Link href="/dashboard/exchange-rate" className="text-brand-700 hover:underline">
          Exchange rate
        </Link>
      </p>
      {item.notes && <p className="text-sm whitespace-pre-line text-ink">{item.notes}</p>}

      {editing && (
        <form action={formAction} className="space-y-4 rounded-xl border border-border bg-surface/60 p-4">
          <input type="hidden" name="applicationId" value={item.applicationId} />
          <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
          <Field label="Kind of role" htmlFor={`role-${item.applicationId}`}>
            <Select id={`role-${item.applicationId}`} name="roleType" defaultValue={item.roleType}>
              <option value="fulltime">Fulltime (CTC per year)</option>
              <option value="freelance">Freelance (hourly rate)</option>
            </Select>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <AmountField id={`cur-${item.applicationId}`} name="current_ctc" label="Current CTC, INR per year" value={item.currentCtc} error={errors.current_ctc} />
            <AmountField id={`exp-${item.applicationId}`} name="expected_ctc" label="Expected CTC, INR per year" value={item.expectedCtc} error={errors.expected_ctc} />
            <AmountField id={`neg-${item.applicationId}`} name="negotiated_ctc" label="Negotiated CTC, INR per year" value={item.negotiatedCtc} error={errors.negotiated_ctc} />
            <AmountField id={`ask-${item.applicationId}`} name="asked_hourly" label="Asked hourly rate, INR" value={item.askedHourly} error={errors.asked_hourly} />
            <AmountField id={`negh-${item.applicationId}`} name="negotiated_hourly" label="Negotiated hourly rate, INR" value={item.negotiatedHourly} error={errors.negotiated_hourly} />
            <Field label="Payslip requested on" htmlFor={`pay-${item.applicationId}`} error={errors.payslip_requested_at}>
              <Input id={`pay-${item.applicationId}`} name="payslip_requested_at" type="date" defaultValue={item.payslipRequestedAt ?? ""} />
            </Field>
          </div>
          <Field label="Notes" htmlFor={`notes-${item.applicationId}`} hint="Internal, never shown to the client.">
            <Textarea id={`notes-${item.applicationId}`} name="notes" rows={2} maxLength={2000} defaultValue={item.notes ?? ""} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Save
            </Button>
          </div>
        </form>
      )}

      {showPayslips && <Payslips candidateId={candidateId} payslips={payslips} onSaved={onSaved} />}
    </div>
  );
}

function AmountField({ id, name, label, value, error }: { id: string; name: string; label: string; value: number | null; error?: string }) {
  return (
    <Field label={label} htmlFor={id} error={error}>
      <Input id={id} name={name} inputMode="numeric" defaultValue={value ?? ""} placeholder="For example 1200000 or 12 LPA" />
    </Field>
  );
}

/** Payslip files of the candidate, and an upload. */
export function Payslips({ candidateId, payslips, onSaved }: { candidateId: string; payslips: Payslip[]; onSaved?: () => void }) {
  const [state, formAction, pending] = useActionState(uploadPayslip.bind(null, candidateId), initialActionState);
  useEffect(() => {
    if (state.ok) onSaved?.();
  }, [state, onSaved]);
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">Payslip</p>
      {payslips.length === 0 ? (
        <p className="text-sm text-muted">No payslip yet.</p>
      ) : (
        <ul className="space-y-1">
          {payslips.map((p) => (
            <li key={p.id}>
              <a
                href={`/dashboard/forms/attachments/${p.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
              >
                <FileText className="size-4" aria-hidden="true" />
                {p.fileName}
              </a>
              <span className="ml-2 text-xs text-muted">{fmtDate(p.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          name="file"
          accept="application/pdf,image/png,image/jpeg"
          aria-label="Payslip file"
          className="max-w-full text-sm file:mr-2 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
          Upload payslip
        </Button>
      </form>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
    </div>
  );
}
