"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import type { Json } from "@/lib/database.types";
import type { CompanyCategory, LeadStatus, PipelineStage } from "@/lib/sales/database";
import { companyCategories, companyPrios, leadStatuses, pipelineStages } from "@/lib/sales/labels";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { SearchSelect } from "@/components/ui/search-select";
import { applyEdits } from "./actions";

export type LeadSalesFields = {
  id: string;
  lead_status: LeadStatus;
  pipeline_stage: PipelineStage | null;
  lost_reason: string | null;
  prio: number | null;
  category: CompanyCategory | null;
  owner_id: string | null;
  partner_id: string | null;
  next_action: string | null;
  next_action_date: string | null;
  description: string | null;
  general_phone: string | null;
  opening_line: string | null;
  red_flags: string[];
  source_note: string | null;
};

type Option = { id: string; name: string };

const label = "block text-xs font-medium tracking-wide text-muted uppercase";
const control =
  "mt-1 block w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-ink shadow-xs outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100";

/**
 * The sales side of a lead: lead status, pipeline stage, prio, owner, partner,
 * primary contact and the fields from the call list. Every field saves on its
 * own and lands in Activities.
 */
export function LeadSalesPanel({
  company,
  contacts,
  owners,
  partners,
  primaryContactId,
}: {
  company: LeadSalesFields;
  contacts: Option[];
  owners: Option[];
  partners: Option[];
  primaryContactId: string | null;
}) {
  const [values, setValues] = useState(company);
  const [primary, setPrimary] = useState(primaryContactId);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState(company.lost_reason ?? "");

  const save = (fields: Partial<LeadSalesFields>, entity: "company" | "contact" = "company", id = company.id) => {
    const previous = values;
    if (entity === "company") setValues((v) => ({ ...v, ...fields }));
    start(async () => {
      const result = await applyEdits([{ entity, ids: [id], fields: fields as Record<string, Json> }]);
      if (!result.ok) {
        setValues(previous);
        setMessage({ tone: "error", text: result.error });
      } else {
        setMessage({ tone: "ok", text: "Saved." });
      }
    });
  };

  const text = (key: keyof LeadSalesFields, labelText: string, options: { long?: boolean; type?: string } = {}) => {
    const value = (values[key] as string | null) ?? "";
    const commit = (next: string) => {
      const clean = next.trim() === "" ? null : next.trim();
      if (clean !== (company[key] ?? null) && clean !== (values[key] ?? null)) save({ [key]: clean } as Partial<LeadSalesFields>);
    };
    return (
      <label className="block">
        <span className={label}>{labelText}</span>
        {options.long ? (
          <textarea key={value} defaultValue={value} rows={3} className={control} onBlur={(e) => commit(e.target.value)} />
        ) : (
          <input key={value} type={options.type ?? "text"} defaultValue={value} className={control} onBlur={(e) => commit(e.target.value)} />
        )}
      </label>
    );
  };

  return (
    <Card>
      <CardHeader
        title="Sales"
        description="Lead status, pipeline and the details from the call list. Changes save at once and show up in the timeline."
      />
      <CardBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Lead status</span>
            <select className={control} value={values.lead_status} onChange={(e) => save({ lead_status: e.target.value as LeadStatus })}>
              {leadStatuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                  {s.description ? `: ${s.description}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={label}>Pipeline stage</span>
            <select
              className={control}
              value={values.pipeline_stage ?? ""}
              onChange={(e) => {
                const stage = (e.target.value || null) as PipelineStage | null;
                if (stage === "lost") {
                  setLostOpen(true);
                  return;
                }
                save({ pipeline_stage: stage });
              }}
            >
              <option value="">Not in the pipeline</option>
              {pipelineStages.map((s, i) => (
                <option key={s.value} value={s.value}>
                  {i + 1}. {s.label}
                </option>
              ))}
            </select>
          </label>
          {(lostOpen || values.pipeline_stage === "lost") && (
            <div className="sm:col-span-2">
              <label className="block">
                <span className={label}>Lost reason</span>
                <textarea rows={2} className={control} value={lostReason} onChange={(e) => setLostReason(e.target.value)} />
              </label>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={!lostReason.trim() || pending}
                  onClick={() => {
                    save({ pipeline_stage: "lost", lost_reason: lostReason.trim() });
                    setLostOpen(false);
                  }}
                >
                  {values.pipeline_stage === "lost" ? "Save reason" : "Move to Lost"}
                </Button>
                {lostOpen && values.pipeline_stage !== "lost" && (
                  <Button size="sm" variant="ghost" onClick={() => setLostOpen(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}
          <label className="block">
            <span className={label}>Prio</span>
            <select className={control} value={values.prio ?? ""} onChange={(e) => save({ prio: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No prio</option>
              {companyPrios.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={label}>Category</span>
            <select className={control} value={values.category ?? ""} onChange={(e) => save({ category: (e.target.value || null) as CompanyCategory | null })}>
              <option value="">Unknown</option>
              {companyCategories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className={label} id="lead-owner-label">
              Owner
            </span>
            <SearchSelect
              className="mt-1"
              aria-labelledby="lead-owner-label"
              value={values.owner_id}
              options={owners.map((o) => ({ value: o.id, label: o.name }))}
              placeholder="Nobody"
              onChange={(value) => save({ owner_id: value })}
            />
          </div>
          <div>
            <span className={label} id="lead-partner-label">
              Brought in by partner
            </span>
            <SearchSelect
              className="mt-1"
              aria-labelledby="lead-partner-label"
              value={values.partner_id}
              options={partners.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="No partner"
              onChange={(value) => save({ partner_id: value })}
            />
            {values.partner_id && (
              <Link href={`/dashboard/partners/${values.partner_id}`} className="mt-1 inline-block text-xs text-brand-700 hover:underline">
                Open partner
              </Link>
            )}
          </div>
          <div className="sm:col-span-2">
            <span className={label} id="lead-primary-label">
              <Star className="mr-1 inline size-3" aria-hidden="true" />
              Primary contact person
            </span>
            <SearchSelect
              className="mt-1"
              aria-labelledby="lead-primary-label"
              value={primary}
              options={contacts.map((c) => ({ value: c.id, label: c.name }))}
              placeholder={contacts.length === 0 ? "Add a contact first" : "Pick the primary contact"}
              allowClear={false}
              onChange={(value) => {
                if (!value) return;
                const before = primary;
                setPrimary(value);
                start(async () => {
                  const result = await applyEdits([{ entity: "contact", ids: [value], fields: { is_primary: true } }]);
                  if (!result.ok) {
                    setPrimary(before);
                    setMessage({ tone: "error", text: result.error });
                  } else setMessage({ tone: "ok", text: "Primary contact saved." });
                });
              }}
            />
            <p className="mt-1 text-xs text-muted">Shown on top of every task on this lead, with mail, phone and LinkedIn.</p>
          </div>
          {text("next_action", "Next action")}
          {text("next_action_date", "Next action date", { type: "date" })}
          {text("general_phone", "General number", { type: "tel" })}
          <label className="block">
            <span className={label}>Red flags</span>
            <input
              key={values.red_flags.join("|")}
              defaultValue={values.red_flags.join(", ")}
              className={control}
              placeholder="Comma separated"
              onBlur={(e) => {
                const next = e.target.value.split(/[;,\n]/).map((s) => s.trim()).filter(Boolean);
                if (next.join("|") !== values.red_flags.join("|")) save({ red_flags: next });
              }}
            />
          </label>
        </div>
        {text("description", "What the company does", { long: true })}
        {text("opening_line", "Opening line", { long: true })}
        {text("source_note", "Source note", { long: true })}
        {message && (
          <p role={message.tone === "error" ? "alert" : "status"} className={`text-sm ${message.tone === "error" ? "text-danger" : "text-emerald-700"}`}>
            {pending ? "Saving..." : message.text}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
