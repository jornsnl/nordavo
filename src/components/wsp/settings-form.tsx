"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { saveWspSettings, type WspStaffResult } from "@/app/dashboard/candidates/[id]/working-style/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import type { WspSettingsRow } from "@/lib/wsp/database";

type Numbers = Pick<
  WspSettingsRow,
  | "invite_valid_days"
  | "reminder_after_days"
  | "reuse_months"
  | "permission_request_days"
  | "candidate_retention_days"
  | "talent_pool_retention_days"
  | "developer_retention_days"
>;

const terms: { key: keyof Numbers; label: string; hint: string }[] = [
  { key: "invite_valid_days", label: "Link valid (days)", hint: "Standard 14." },
  { key: "reminder_after_days", label: "Reminder after (days)", hint: "One reminder when not started. Standard 3." },
  { key: "reuse_months", label: "Reuse a completed profile (months)", hint: "No new invitation within this time. Standard 12." },
  {
    key: "permission_request_days",
    label: "Ask for permission at most every (days)",
    hint: "One general permission per person, not per client. Also the wait before the portal asks once more after Not now. Standard 7.",
  },
  { key: "candidate_retention_days", label: "Candidates: delete after the application ends (days)", hint: "Standard 28." },
  { key: "talent_pool_retention_days", label: "Talent pool consent: delete after the questionnaire (days)", hint: "Standard 365." },
  { key: "developer_retention_days", label: "Developers: delete after the placement ends (days)", hint: "Standard 28." },
];

/** System settings of the Working Style Profile (admin only; the database checks it again and logs every change). */
export function WspSettingsForm({ settings, stages }: { settings: WspSettingsRow; stages: { value: string; label: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<WspStaffResult | null>(null);
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const number = (key: string) => Number(form.get(key));
        startTransition(async () => {
          const r = await saveWspSettings({
            enabled: form.get("enabled") === "on",
            trigger_stage_id: String(form.get("trigger_stage_id")) as Parameters<typeof saveWspSettings>[0]["trigger_stage_id"],
            default_for_new_vacancies: form.get("default_for_new_vacancies") === "on",
            auto_invite_developers_on_placement: form.get("auto_invite_developers_on_placement") === "on",
            invite_valid_days: number("invite_valid_days"),
            reminder_after_days: number("reminder_after_days"),
            reuse_months: number("reuse_months"),
            permission_request_days: number("permission_request_days"),
            candidate_retention_days: number("candidate_retention_days"),
            talent_pool_retention_days: number("talent_pool_retention_days"),
            developer_retention_days: number("developer_retention_days"),
            retention_enabled: form.get("retention_enabled") === "on",
          });
          setResult(r);
          router.refresh();
        });
      }}
    >
      <label className="flex items-start gap-3 text-sm text-ink">
        <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="mt-0.5 size-4 accent-brand-700" />
        <span>
          <span className="font-medium">Working style profile on</span>
          <span className="block text-xs text-muted">Off: the feature is hidden everywhere and nothing is sent.</span>
        </span>
      </label>
      <Field label="Trigger stage" htmlFor="wsp-trigger" hint="A candidate entering this stage gets an invitation automatically (if the vacancy and person settings allow it).">
        <Select id="wsp-trigger" name="trigger_stage_id" defaultValue={settings.trigger_stage_id}>
          {stages.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input type="checkbox" name="default_for_new_vacancies" defaultChecked={settings.default_for_new_vacancies} className="mt-0.5 size-4 accent-brand-700" />
        <span className="font-medium">On by default for new vacancies</span>
      </label>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input
          type="checkbox"
          name="auto_invite_developers_on_placement"
          defaultChecked={settings.auto_invite_developers_on_placement}
          className="mt-0.5 size-4 accent-brand-700"
        />
        <span>
          <span className="font-medium">Invite developers automatically when a placement starts</span>
          <span className="block text-xs text-muted">Voluntary for developers. Off: developers only by hand.</span>
        </span>
      </label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {terms.map((t) => (
          <Field key={t.key} label={t.label} htmlFor={`wsp-${t.key}`} hint={t.hint}>
            <Input id={`wsp-${t.key}`} name={t.key} type="number" inputMode="numeric" min={0} defaultValue={settings[t.key]} required />
          </Field>
        ))}
      </div>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input type="checkbox" name="retention_enabled" defaultChecked={settings.retention_enabled} className="mt-0.5 size-4 accent-brand-700" />
        <span>
          <span className="font-medium">Delete profiles after the terms above</span>
          <span className="block text-xs text-muted">
            Off (for now): the data is kept and the daily job deletes nothing. People and staff can still delete a profile by hand.
          </span>
        </span>
      </label>
      {result && (result.ok ? <p role="status" className="text-sm text-emerald-700">{result.message}</p> : <p role="alert" className="text-sm text-danger">{result.error}</p>)}
      <Button type="submit" disabled={pending}>
        {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        Save
      </Button>
    </form>
  );
}
