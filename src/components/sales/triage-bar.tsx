"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { loadTriageOptions, triageLeads, type TriageOptions } from "@/app/dashboard/inbox/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { TriageDestination } from "@/lib/sales/flow-database";
import { triageDestinations } from "@/lib/sales/triage";

const control = "h-9 w-full rounded-lg border border-border bg-white px-2 text-sm";

/**
 * "Send to" for one lead or a selection (feedback Julius, 038aa8ea): Find
 * number, Call (call list or caller), Mail or LinkedIn campaign, Park with a
 * date, No go with a reason. Occupied leads are skipped unless forced.
 */
export function TriageBar({
  companyIds,
  callers,
  onDone,
  onError,
  label = "Send to",
}: {
  companyIds: string[];
  /** Only for admins: external callers to give leads to. */
  callers?: { id: string; name: string }[];
  onDone: (message: string) => void;
  onError?: (message: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<TriageOptions | null>(null);
  const [destination, setDestination] = useState<TriageDestination>("find_number");
  const [viewId, setViewId] = useState("");
  const [callerId, setCallerId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openDialog = () => {
    setOpen(true);
    setError(null);
    if (!options) startTransition(async () => setOptions(await loadTriageOptions()));
  };

  const meta = triageDestinations.find((d) => d.value === destination);
  const channel = destination === "mail_campaign" ? "mail" : destination === "linkedin_campaign" ? "linkedin" : null;
  const campaigns = (options?.campaigns ?? []).filter((c) => c.channel === channel);
  const callerList = callers ?? options?.callers ?? [];

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await triageLeads({
        companyIds,
        destination,
        viewId: destination === "call" && viewId ? viewId : null,
        callerId: destination === "call" && callerId ? callerId : null,
        campaignId: channel && campaignId ? campaignId : null,
        until: destination === "parked" || (destination === "call" && callerId) ? until || null : null,
        reason: destination === "no_go" ? reason : null,
        force,
      });
      if (!result.ok) {
        setError(result.error);
        onError?.(result.error);
        return;
      }
      setOpen(false);
      onDone(result.message);
    });
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={openDialog}>
        <Send aria-hidden="true" />
        {label}
      </Button>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={companyIds.length === 1 ? "Send this lead to" : `Send ${companyIds.length} leads to`}
          description="Every lead is in exactly one bucket or flow. Moving it here takes it out of where it was."
        >
          <div className="space-y-4 text-sm">
            <fieldset className="space-y-1.5">
              <legend className="mb-1 font-medium text-ink">Destination</legend>
              {triageDestinations.map((d) => (
                <label key={d.value} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-surface">
                  <input
                    type="radio"
                    name="destination"
                    className="mt-0.5"
                    checked={destination === d.value}
                    onChange={() => setDestination(d.value)}
                  />
                  <span>
                    <span className="font-medium text-ink">{d.label}</span>
                    <span className="block text-xs text-muted">{d.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {meta?.needs === "list_or_caller" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="font-medium">Call list</span>
                  <select className={control} value={viewId} onChange={(e) => setViewId(e.target.value)}>
                    <option value="">(none)</option>
                    {(options?.callLists ?? []).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="font-medium">or external caller</span>
                  <select className={control} value={callerId} onChange={(e) => setCallerId(e.target.value)}>
                    <option value="">(the team)</option>
                    {callerList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                {callerId && (
                  <label className="space-y-1 sm:col-span-2">
                    <span className="font-medium">Caller until (optional)</span>
                    <input type="date" className={control} value={until} onChange={(e) => setUntil(e.target.value)} />
                  </label>
                )}
              </div>
            )}

            {meta?.needs === "campaign" && (
              <label className="block space-y-1">
                <span className="font-medium">Campaign</span>
                <select className={control} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                  <option value="">Pick a campaign</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {options && campaigns.length === 0 && (
                  <span className="block text-xs text-muted">No running campaigns on this channel. Add one under Sequences, Campaigns.</span>
                )}
              </label>
            )}

            {meta?.needs === "date" && (
              <label className="block space-y-1">
                <span className="font-medium">Back on</span>
                <input type="date" className={control} value={until} onChange={(e) => setUntil(e.target.value)} />
              </label>
            )}

            {meta?.needs === "reason" && (
              <label className="block space-y-1">
                <span className="font-medium">Reason</span>
                <input className={control} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it is no go" />
              </label>
            )}

            {(destination === "call" || channel) && (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={force} onChange={(e) => setForce(e.target.checked)} />
                <span>
                  <span className="font-medium">Also leads that are occupied</span>
                  <span className="block text-xs text-muted">Normally a lead in a running campaign, sequence or call list is skipped.</span>
                </span>
              </label>
            )}

            {error && (
              <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={pending}>
                Move {companyIds.length === 1 ? "lead" : `${companyIds.length} leads`}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
