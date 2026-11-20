"use client";

import { useState, useTransition } from "react";
import { MessageCircle, ShieldAlert, TriangleAlert } from "lucide-react";
import type { Json } from "@/lib/database.types";
import { applyEdits } from "@/components/sales/actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import { segments } from "@/lib/labels";

/** One sentence per line in, a list out. */
function lines(value: string): string[] {
  return value
    .split("\n")
    .map((s) => s.replace(/^[\s\-*•]+/, "").trim())
    .filter(Boolean);
}

const label = "block text-xs font-medium tracking-wide text-muted uppercase";
const control =
  "mt-1 block w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-ink shadow-xs outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100";

export type IcpCardProps = {
  companyId: string;
  decision: "GO" | "NO_GO" | null;
  reason: string | null;
  segment: "A" | "B" | null;
  score: number | null;
  /** "A 50 + vacature 30 = 80". */
  scoreLine: string | null;
  talkingPoints: string[];
  redFlags: string[];
  /** Talking points and red flags read from the old red flags block (before 20 November 2026), shown until someone saves new lists. */
  legacyTalkingPoints: string[];
  clientContactRisk: boolean;
  assessed: string;
  /** The score group and its approach from Settings (null while not decided). */
  scoreGroup?: { label: string; approach: string | null } | null;
};

/**
 * The ICP verdict of a lead (leadregels, deel 1 to 3): GO, No go with its
 * reason, or empty (not judged yet); with GO the segment. The score follows
 * from the segment and the signals and shows how it is built. Talking points
 * and red flags are two lists of whole sentences. Saves through sales_update,
 * so every change is in the timeline.
 */
export function IcpCard(props: IcpCardProps) {
  const [editing, setEditing] = useState(false);
  const [decision, setDecision] = useState<"" | "GO" | "NO_GO">(props.decision ?? "");
  const [reason, setReason] = useState(props.reason ?? "");
  const [segment, setSegment] = useState<"" | "A" | "B">(props.segment ?? "");
  const [talking, setTalking] = useState((props.talkingPoints.length ? props.talkingPoints : props.legacyTalkingPoints).join("\n"));
  const [flags, setFlags] = useState(props.redFlags.join("\n"));
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const shownTalking = props.talkingPoints.length > 0 ? props.talkingPoints : props.legacyTalkingPoints;

  function save() {
    if (decision === "NO_GO" && !reason.trim()) {
      setMessage({ tone: "error", text: "A No go needs a short reason: it is shown in the lead list." });
      return;
    }
    if (decision === "GO" && !segment) {
      setMessage({ tone: "error", text: "A GO needs segment A or B." });
      return;
    }
    const fields: Record<string, Json> = {
      icp_decision: decision || null,
      icp_reason: reason.trim() || null,
      segment: decision === "GO" ? segment : null,
      talking_points: lines(talking),
      red_flags: lines(flags),
    };
    start(async () => {
      const result = await applyEdits([{ entity: "company", ids: [props.companyId], fields }]);
      if (!result.ok) setMessage({ tone: "error", text: result.error });
      else {
        setMessage({ tone: "ok", text: "Saved. The score follows the segment and the signals." });
        setEditing(false);
      }
    });
  }

  return (
    <Card>
      <CardHeader
        title="ICP and score"
        description={props.assessed}
        actions={
          !editing && (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        }
      />
      <CardBody className="space-y-5">
        <FormMessage error={message?.tone === "error" ? message.text : undefined} success={message?.tone === "ok" ? message.text : undefined} />
        {props.clientContactRisk && (
          <p className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Client contact risk: the developer would work directly with the client&rsquo;s own customers. That is always a No go.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <span className={label}>ICP</span>
            <p className="mt-1 text-sm font-medium text-ink">
              {props.decision === "GO" ? "GO" : props.decision === "NO_GO" ? "No go" : "Not judged yet"}
            </p>
          </div>
          <div>
            <span className={label}>Segment</span>
            <p className="mt-1 text-sm text-ink" title={segments.find((s) => s.value === props.segment)?.description}>
              {props.segment ? `Segment ${props.segment}` : props.decision === "GO" ? "Missing: pick A or B" : "Only with GO"}
            </p>
          </div>
          <div>
            <span className={label}>Score</span>
            <p className="mt-1 text-2xl font-semibold text-ink tabular-nums">{props.score ?? "No score"}</p>
            {props.scoreGroup && (
              <p className="text-xs text-muted">
                Group {props.scoreGroup.label}
                {props.scoreGroup.approach ? `: ${props.scoreGroup.approach}` : ""}
              </p>
            )}
          </div>
        </div>
        {props.scoreLine && (
          <p className="rounded-xl bg-surface px-4 py-3 text-sm text-ink tabular-nums">
            <span className="font-medium">How it is built:</span> {props.scoreLine}
          </p>
        )}

        {editing ? (
          <div className="space-y-4 border-t border-border pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={label}>ICP</span>
                <select className={control} value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}>
                  <option value="">Not judged yet</option>
                  <option value="GO">GO</option>
                  <option value="NO_GO">No go</option>
                </select>
              </label>
              <label className="block">
                <span className={label}>Segment</span>
                <select className={control} value={segment} disabled={decision !== "GO"} onChange={(e) => setSegment(e.target.value as typeof segment)}>
                  <option value="">{decision === "GO" ? "Pick A or B" : "Only with GO"}</option>
                  {segments.map((s) => (
                    <option key={s.value} value={s.value} title={s.description}>
                      {s.label}: {s.description}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className={label}>Reason{decision === "NO_GO" ? " (needed for No go)" : ""}</span>
              <textarea rows={3} className={control} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="block">
              <span className={label}>Talking points</span>
              <textarea rows={4} className={control} value={talking} onChange={(e) => setTalking(e.target.value)} placeholder="One whole sentence per line" />
              <span className="mt-1 block text-xs text-muted">
                Nederlands vereist, EU verblijf, kantoordagen, junior, tijdelijk of parttime, boven 150 FTE, geen technische beslisser, twijfel. Verlagen de score nooit.
              </span>
            </label>
            <label className="block">
              <span className={label}>Red flags</span>
              <textarea rows={3} className={control} value={flags} onChange={(e) => setFlags(e.target.value)} placeholder="One whole sentence per line" />
              <span className="mt-1 block text-xs text-muted">Echte risico&rsquo;s: VOG of nationaliteitseis, gevoelige data, embedded of hardware op locatie.</span>
            </label>
            <div className="flex gap-2">
              <Button size="sm" disabled={pending} onClick={save}>
                Save
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <h3 className={label}>{props.decision === "NO_GO" ? "Why no go" : "Reason"}</h3>
              <p className="mt-1 text-sm whitespace-pre-line text-ink">{props.reason || "No reason recorded."}</p>
            </div>
            <div>
              <h3 className={label}>Talking points</h3>
              {shownTalking.length === 0 ? (
                <p className="mt-1 text-sm text-muted">None.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {shownTalking.map((t) => (
                    <li key={t} className="flex items-start gap-2 text-sm text-ink">
                      <MessageCircle className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
                      {t}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className={label}>Red flags</h3>
              {props.redFlags.length === 0 ? (
                <p className="mt-1 text-sm text-muted">None.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {props.redFlags.map((flag) => (
                    <li key={flag} className="flex items-start gap-2 text-sm text-danger">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      {flag}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
