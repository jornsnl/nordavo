"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Link2, LoaderCircle, MailWarning, Send } from "lucide-react";
import { sendFormAction, type SendResult } from "@/app/dashboard/vacancies/[id]/form/tracking/actions";
import type { ApplicationStage } from "@/lib/database.types";
import { applicationStages, optionFor } from "@/lib/labels";
import { CopyButton } from "@/components/talent/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Input } from "@/components/ui/field";

export type TrackingItem = {
  applicationId: string;
  candidateId: string;
  name: string;
  email: string | null;
  stage: ApplicationStage;
  headhunted: boolean;
  status: "not_sent" | "waiting" | "overdue" | "reminded" | "completed";
  sentAt: string | null;
  completedAt: string | null;
  remindedAt: string | null;
  deadline: string | null;
  link: string | null;
};

const statusLabels: Record<TrackingItem["status"], { label: string; tone: "neutral" | "brand" | "warning" | "danger" | "success" }> = {
  not_sent: { label: "Not sent", tone: "neutral" },
  waiting: { label: "Waiting", tone: "brand" },
  overdue: { label: "Past deadline", tone: "danger" },
  reminded: { label: "Reminded", tone: "warning" },
  completed: { label: "Filled in", tone: "success" },
};

const filters = [
  { key: "all", label: "All" },
  { key: "not_sent", label: "Not sent" },
  { key: "open", label: "Not filled in" },
  { key: "completed", label: "Filled in" },
] as const;

function fmt(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Amsterdam" }).format(new Date(value));
}

/** Who did and did not fill in, and sending the form to a selection. */
export function SendFormPanel({
  vacancyId,
  items,
  published,
  mailConfigured,
  defaultCc,
  defaultDeadline,
  preselected,
}: {
  vacancyId: string;
  items: TrackingItem[];
  published: boolean;
  mailConfigured: boolean;
  defaultCc: string;
  defaultDeadline: string;
  preselected: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselected.filter((id) => items.some((i) => i.applicationId === id))));
  const [filter, setFilter] = useState<(typeof filters)[number]["key"]>("all");
  const [cc, setCc] = useState(defaultCc);
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [result, setResult] = useState<SendResult | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(
    () =>
      items.filter((i) =>
        filter === "all" ? true : filter === "completed" ? i.status === "completed" : filter === "not_sent" ? i.status === "not_sent" : i.status !== "completed" && i.status !== "not_sent",
      ),
    [items, filter],
  );
  const allVisibleSelected = visible.length > 0 && visible.every((i) => selected.has(i.applicationId));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((s) => {
      const next = new Set(s);
      for (const i of visible) {
        if (allVisibleSelected) next.delete(i.applicationId);
        else next.add(i.applicationId);
      }
      return next;
    });
  }
  function run(linksOnly: boolean) {
    const ids = [...selected];
    if (!linksOnly && !window.confirm(`Send the form to ${ids.length} ${ids.length === 1 ? "candidate" : "candidates"}? Each gets their own mail.`)) return;
    startTransition(async () => {
      const r = await sendFormAction({ vacancyId, applicationIds: ids, cc, deadline, linksOnly });
      setResult(r);
      if (r.ok) setSelected(new Set());
    });
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {!mailConfigured && (
        <p role="status" className="flex gap-3 rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <MailWarning className="size-5 shrink-0" aria-hidden="true" />
          <span>
            Mail is not configured (RESEND_API_KEY and MAIL_FROM_RECRUITMENT or MAIL_FROM are missing), so nothing is mailed. Sending marks the
            candidates as sent and shows their personal links to copy and send yourself. Reminders are not mailed either.
          </span>
        </p>
      )}
      {!published && (
        <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
          The form is not published.{" "}
          <Link href={`/dashboard/vacancies/${vacancyId}/form`} className="font-medium underline">
            Publish it first
          </Link>
          , then send it.
        </p>
      )}

      <Card>
        <CardHeader
          title="Send the form"
          description="Each selected candidate gets one mail with their own link. Sourced and Techstack check move to Fill out."
        />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="CC" htmlFor="send-cc" hint="Optional, for example Floris. Comma separated.">
              <Input id="send-cc" type="text" inputMode="email" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="floris@nordavo.nl" />
            </Field>
            <Field label="Deadline" htmlFor="send-deadline" hint="Reminders go out after this day if the form is still open.">
              <Input id="send-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => run(false)} disabled={pending || selected.size === 0 || !published}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
              {mailConfigured ? "Send form" : "Mark as sent and show links"} ({selected.size})
            </Button>
            <Button variant="secondary" onClick={() => run(true)} disabled={pending || selected.size === 0 || !published}>
              <Link2 aria-hidden="true" />
              Only make links
            </Button>
          </div>
          {result && (
            <div className="space-y-3">
              <FormMessage error={result.error} success={result.ok ? result.message : undefined} />
              {result.links.some((l) => l.status !== "mailed") && (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {result.links
                    .filter((l) => l.status !== "mailed")
                    .map((l) => (
                      <li key={l.applicationId} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center">
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="font-medium text-ink">{l.name}</span>
                          <span className="text-muted"> {l.email ?? "no email"}</span>
                        </span>
                        <code className="min-w-0 truncate text-xs text-muted sm:max-w-64">{l.link}</code>
                        <CopyButton text={l.link} label={`link for ${l.name}`} />
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Who filled in"
          description={`${items.filter((i) => i.status === "completed").length} of ${items.length} filled in, ${items.filter((i) => i.status !== "completed" && i.status !== "not_sent").length} still open.`}
          actions={
            <div className="flex flex-wrap gap-1">
              {filters.map((f) => (
                <Button key={f.key} size="sm" variant={filter === f.key ? "primary" : "ghost"} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}>
                  {f.label}
                </Button>
              ))}
            </div>
          }
        />
        {visible.length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted">No candidates here.</p>
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-surface/60 text-xs font-semibold tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="w-10 px-4 py-3">
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all shown" className="size-4 accent-brand-700" />
                  </th>
                  <th scope="col" className="px-4 py-3">Candidate</th>
                  <th scope="col" className="px-4 py-3">Stage</th>
                  <th scope="col" className="px-4 py-3">Form</th>
                  <th scope="col" className="px-4 py-3">Sent</th>
                  <th scope="col" className="px-4 py-3">Deadline</th>
                  <th scope="col" className="px-4 py-3">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((i) => {
                  const stage = optionFor(applicationStages, i.stage);
                  const status = statusLabels[i.status];
                  return (
                    <tr key={i.applicationId} className="hover:bg-brand-50/40">
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(i.applicationId)}
                          onChange={() => toggle(i.applicationId)}
                          aria-label={`Select ${i.name}`}
                          className="size-4 accent-brand-700"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <Link href={`/dashboard/candidates/${i.candidateId}`} className="font-medium text-brand-900 hover:underline">
                          {i.name}
                        </Link>
                        <span className="block text-xs text-muted">{i.email ?? "No email"}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex flex-wrap gap-1">
                          <Badge tone={stage.tone}>{stage.label}</Badge>
                          {i.headhunted && <Badge tone="accent">Headhunted</Badge>}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {i.completedAt && <span className="block text-xs text-muted">{fmt(i.completedAt)}</span>}
                        {i.remindedAt && !i.completedAt && <span className="block text-xs text-muted">reminded {fmt(i.remindedAt)}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-muted">{fmt(i.sentAt)}</td>
                      <td className="px-4 py-2.5 text-muted">{i.deadline ? fmt(`${i.deadline}T12:00:00Z`) : ""}</td>
                      <td className="px-2 py-2.5">{i.link && <CopyButton text={i.link} label={`link for ${i.name}`} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
