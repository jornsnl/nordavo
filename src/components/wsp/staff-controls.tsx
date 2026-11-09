"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Send } from "lucide-react";
import {
  deleteWspAssessment,
  linkWspClient,
  requestWspPermission,
  resendWspInvite,
  sendWspInvite,
  setVacancyWsp,
  setWspPersonMode,
  setWspTalentPoolConsent,
  type WspStaffResult,
} from "@/app/dashboard/candidates/[id]/working-style/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { ASK_PERMISSION_BUTTON, PERSON_MODE_LABELS, SEND_BUTTON, VACANCY_SENTENCE } from "@/lib/wsp/content";
import type { WspMode } from "@/lib/wsp/database";

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<WspStaffResult | null>(null);
  const run = (fn: () => Promise<WspStaffResult>) =>
    startTransition(async () => {
      const r = await fn();
      setResult(r);
      router.refresh();
    });
  return { pending, result, run };
}

function Feedback({ result }: { result: WspStaffResult | null }) {
  if (!result) return null;
  return result.ok ? (
    result.message ? <p role="status" className="text-xs text-emerald-700">{result.message}</p> : null
  ) : (
    <p role="alert" className="text-xs text-danger">{result.error}</p>
  );
}

/** Person setting: Follow vacancy (default), Always, Never; and talent pool consent (retention). */
export function WspPersonSettings({ candidateId, mode, talentPool }: { candidateId: string; mode: WspMode; talentPool: boolean }) {
  const { pending, result, run } = useAction();
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="font-medium text-ink">Working style profile for this person</span>
        <Select
          className="mt-1"
          defaultValue={mode}
          disabled={pending}
          onChange={(e) => run(() => setWspPersonMode(candidateId, e.target.value as WspMode))}
        >
          {(Object.keys(PERSON_MODE_LABELS) as WspMode[]).map((value) => (
            <option key={value} value={value}>
              {PERSON_MODE_LABELS[value]}
            </option>
          ))}
        </Select>
        <span className="mt-1 block text-xs text-muted">Never blocks every invitation, automatic and by hand. Always invites even when the vacancy is off.</span>
      </label>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          defaultChecked={talentPool}
          disabled={pending}
          onChange={(e) => run(() => setWspTalentPoolConsent(candidateId, e.target.checked))}
          className="mt-0.5 size-4 accent-brand-700"
        />
        <span>
          Agreed to stay in the talent pool
          <span className="block text-xs text-muted">The profile is then kept 1 year after the questionnaire instead of 4 weeks after the application ends.</span>
        </span>
      </label>
      <Feedback result={result} />
    </div>
  );
}

/** "Send working style profile", optionally for a vacancy (and its client) or a client. */
export function WspSendButton({
  candidateId,
  vacancies,
  clients,
  label = SEND_BUTTON,
}: {
  candidateId: string;
  vacancies: { id: string; title: string; clientName: string | null }[];
  clients: { id: string; name: string }[];
  label?: string;
}) {
  const { pending, result, run } = useAction();
  const [vacancy, setVacancy] = useState("");
  const [client, setClient] = useState("");
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select aria-label="Vacancy (optional)" value={vacancy} onChange={(e) => setVacancy(e.target.value)}>
          <option value="">No vacancy</option>
          {vacancies.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title}
              {v.clientName ? ` (${v.clientName})` : ""}
            </option>
          ))}
        </Select>
        <Select aria-label="Client (optional)" value={client} onChange={(e) => setClient(e.target.value)} disabled={Boolean(vacancy)}>
          <option value="">{vacancy ? "Client of the vacancy" : "No client"}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <Button size="sm" disabled={pending} onClick={() => run(() => sendWspInvite(candidateId, vacancy || null, vacancy ? null : client || null))}>
        {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
        {label}
      </Button>
      <Feedback result={result} />
    </div>
  );
}

export function WspActionButton({
  children,
  action,
  variant = "secondary",
  confirm,
}: {
  children: ReactNode;
  action: () => Promise<WspStaffResult>;
  variant?: "secondary" | "danger" | "ghost" | "primary";
  confirm?: string;
}) {
  const { pending, result, run } = useAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        size="sm"
        variant={variant}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          run(action);
        }}
      >
        {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        {children}
      </Button>
      <Feedback result={result} />
    </span>
  );
}

export function WspResendButton({ candidateId, assessmentId, label = "Send again" }: { candidateId: string; assessmentId: string; label?: string }) {
  return <WspActionButton action={() => resendWspInvite(candidateId, assessmentId)}>{label}</WspActionButton>;
}

export function WspAskPermissionButton({ candidateId, assessmentId, clientId }: { candidateId: string; assessmentId: string; clientId: string }) {
  return <WspActionButton action={() => requestWspPermission(candidateId, assessmentId, clientId)}>{ASK_PERMISSION_BUTTON}</WspActionButton>;
}

export function WspDeleteAssessmentButton({ candidateId, assessmentId }: { candidateId: string; assessmentId: string }) {
  return (
    <WspActionButton
      variant="danger"
      confirm="Delete this working style profile? Answers, report and permissions are deleted at once; clients it was shared with lose access and get the withdrawal mail."
      action={() => deleteWspAssessment(candidateId, assessmentId)}
    >
      Delete profile
    </WspActionButton>
  );
}

export function WspLinkForm({
  candidateId,
  assessmentId,
  clients,
}: {
  candidateId: string;
  assessmentId: string;
  clients: { id: string; name: string }[];
}) {
  const { pending, result, run } = useAction();
  const [client, setClient] = useState("");
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <Select aria-label="Client to link" value={client} onChange={(e) => setClient(e.target.value)} className="sm:w-64">
        <option value="">Link a client…</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="secondary" disabled={pending || !client} onClick={() => run(() => linkWspClient(candidateId, assessmentId, null, client))}>
        Link
      </Button>
      <Feedback result={result} />
    </div>
  );
}

/** Vacancy setting: on or off, with the fixed sentence it adds to the outward vacancy text. */
export function WspVacancyToggle({ vacancyId, enabled }: { vacancyId: string; enabled: boolean }) {
  const { pending, result, run } = useAction();
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input
          type="checkbox"
          defaultChecked={enabled}
          disabled={pending}
          onChange={(e) => run(() => setVacancyWsp(vacancyId, e.target.checked))}
          className="size-4 accent-brand-700"
        />
        Working style profile on for this vacancy
      </label>
      <p className="text-xs text-muted">
        When on, shortlisted candidates who follow the vacancy get an invitation, and the application form shows: “{VACANCY_SENTENCE}”
      </p>
      <Feedback result={result} />
    </div>
  );
}
