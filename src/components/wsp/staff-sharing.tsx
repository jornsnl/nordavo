"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, LoaderCircle, Search, Share2 } from "lucide-react";
import { requestWspPermission, searchWspProspects, shareWspProfile } from "@/app/dashboard/candidates/[id]/working-style/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { ASK_PERMISSION_BUTTON } from "@/lib/wsp/content";
import { CHANNEL_LABELS, mayRequestPermission, shareBlockedReason, type WspStaffConsent } from "@/lib/wsp/consent";
import { formatWspDate } from "@/lib/wsp/text";

type Assessment = { id: string; completedAt: string | null };

/**
 * Staff: whether the person gave the one general permission and since when,
 * with whom the profile was shared, sharing with a client (client portal or
 * PDF) or a prospect (PDF or with the anonymous profile), and asking for
 * permission (at most once per term). Without permission the share button
 * is off and says why (feedback Julius). The database checks it all again
 * and logs every share.
 */
export function WspStaffSharing({
  candidateId,
  consent,
  assessments,
  clients,
}: {
  candidateId: string;
  consent: WspStaffConsent | null;
  /** Completed questionnaires, newest first. */
  assessments: Assessment[];
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [target, setTarget] = useState<"client" | "prospect">("client");
  const [clientId, setClientId] = useState<string | null>(null);
  const [prospect, setProspect] = useState<{ id: string; name: string } | null>(null);
  const [channel, setChannel] = useState<"portal" | "pdf" | "anonymous_profile">("portal");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ id: string; name: string; domain: string | null }[]>([]);
  const latest = assessments[0] ?? null;
  const blocked = shareBlockedReason(consent, Boolean(latest));
  const ask = mayRequestPermission(consent);
  const pdfBase = latest ? `/dashboard/candidates/${candidateId}/working-style/${latest.id}/pdf` : null;

  const run = (fn: () => Promise<{ ok: true; message?: string; shareId?: string } | { ok: false; error: string }>, done: string, open?: (id: string) => void) =>
    startTransition(async () => {
      const result = await fn();
      setMessage(result.ok ? { ok: true, text: result.message ?? done } : { ok: false, text: result.error });
      if (result.ok && "shareId" in result && result.shareId && open) open(result.shareId);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-ink">Permission to share</span>
        {consent?.consented ? (
          <Badge tone="success">Yes, since {formatWspDate(consent.consentedAt)}</Badge>
        ) : consent?.withdrawnAt ? (
          <Badge tone="warning">Withdrawn on {formatWspDate(consent.withdrawnAt)}</Badge>
        ) : consent?.declinedAt ? (
          <Badge tone="neutral">Not now ({formatWspDate(consent.declinedAt)})</Badge>
        ) : (
          <Badge tone="neutral">Not given</Badge>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">Shared with</h4>
        {!consent || consent.recipients.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Nobody yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-border rounded-xl border border-border">
            {consent.recipients.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-ink">{r.name}</span>
                  <span className="text-muted">
                    {" "}
                    {r.kind === "prospect" ? "(prospect) " : ""}
                    {CHANNEL_LABELS[r.channel]}, {formatWspDate(r.sharedAt)}
                    {r.sharedByName && ` by ${r.sharedByName}`}
                  </span>
                </span>
                {r.revokedAt ? (
                  <Badge tone="warning">Ended {formatWspDate(r.revokedAt)}</Badge>
                ) : (
                  r.channel !== "portal" &&
                  consent.consented && (
                    <a
                      href={`/dashboard/candidates/${candidateId}/working-style/${r.assessmentId}/pdf?share=${r.id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                    >
                      <Download className="size-3.5" aria-hidden="true" />
                      PDF for {r.name}
                    </a>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <fieldset className="space-y-3 rounded-xl border border-border p-3" disabled={pending || Boolean(blocked)}>
        <legend className="px-1 text-sm font-medium text-ink">Share the profile</legend>
        {blocked && <p className="text-xs text-muted">{blocked}</p>}
        <div className="inline-flex rounded-xl border border-border bg-white p-1" role="group" aria-label="Share with">
          {(["client", "prospect"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={target === t}
              onClick={() => {
                setTarget(t);
                setChannel(t === "client" ? "portal" : "pdf");
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${target === t ? "bg-brand-700 text-white" : "text-muted hover:bg-brand-50"}`}
            >
              {t === "client" ? "Client" : "Prospect"}
            </button>
          ))}
        </div>
        {target === "client" ? (
          <SearchSelect
            value={clientId}
            onChange={setClientId}
            aria-label="Client"
            placeholder="Pick a client"
            searchPlaceholder="Search clients"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
        ) : prospect ? (
          <p className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium text-ink">{prospect.name}</span>
            <button type="button" onClick={() => setProspect(null)} className="text-xs text-muted underline">
              Change
            </button>
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Company name or domain" aria-label="Search prospects" />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => startTransition(async () => setHits(await searchWspProspects(query)))}
              >
                <Search aria-hidden="true" />
                Find
              </Button>
            </div>
            {hits.length > 0 && (
              <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button type="button" onClick={() => setProspect(h)} className="w-full px-3 py-2 text-left hover:bg-brand-50">
                      {h.name}
                      {h.domain && <span className="text-muted"> · {h.domain}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <Select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} aria-label="How">
          {target === "client" && <option value="portal">In their client portal</option>}
          <option value="pdf">As a PDF, with an introduction</option>
          <option value="anonymous_profile">With the anonymous profile (PDF)</option>
        </Select>
        <Button
          type="button"
          size="sm"
          disabled={!latest || (target === "client" ? !clientId : !prospect)}
          onClick={() =>
            latest &&
            run(
              () =>
                shareWspProfile({
                  candidateId,
                  assessmentId: latest.id,
                  clientId: target === "client" ? clientId : null,
                  companyId: target === "prospect" ? (prospect?.id ?? null) : null,
                  channel,
                }),
              channel === "portal" ? "Shared: the client sees it in their portal." : "Shared. Download the PDF for them below.",
              channel === "portal" || !pdfBase ? undefined : (id) => window.open(`${pdfBase}?share=${id}`, "_blank"),
            )
          }
        >
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Share2 aria-hidden="true" />}
          Share
        </Button>
      </fieldset>

      {!consent?.consented && latest && (
        <div className="space-y-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending || !ask.ok}
            onClick={() => run(() => requestWspPermission(candidateId, latest.id), "Asked. The person gets a mail and, with an account, a notification.")}
          >
            {ASK_PERMISSION_BUTTON}
          </Button>
          {ask.reason && <p className="text-xs text-muted">{ask.reason}</p>}
        </div>
      )}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-xs ${message.ok ? "text-emerald-700" : "text-danger"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
