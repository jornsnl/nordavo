"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { ArrowRight, Filter, LoaderCircle, Sparkles } from "lucide-react";
import { ActionFeedback } from "@/components/talent/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SubmitButton } from "@/components/ui/submit-button";
import type { TechstackRow } from "@/lib/data/screening";
import type { TechstackResult } from "@/lib/database.types";
import { planTechstackMoves } from "@/lib/screening/techstack";
import type { TalentActionState } from "@/lib/talent/types";
import { applyTechstackAction, runTechstackAction, saveTechstackRulesAction } from "@/app/dashboard/vacancies/screening-actions";

const RESULT: Record<TechstackResult, { label: string; tone: "success" | "danger" | "warning" }> = {
  pass: { label: "Pass", tone: "success" },
  fail: { label: "Fail", tone: "danger" },
  unclear: { label: "Unclear", tone: "warning" },
};

type Filter = "all" | TechstackResult | "unchecked";

export function TechstackPanel({
  vacancyId,
  rows,
  rules,
  claude,
}: {
  vacancyId: string;
  rows: TechstackRow[];
  rules: { stack: string[]; excluded_profiles: string[]; techstack_min_hits: number | null; requiredHits: number };
  claude: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rulesState, rulesAction] = useActionState(saveTechstackRulesAction.bind(null, vacancyId), {} as TalentActionState);
  const [runState, runAction, running] = useActionState(runTechstackAction.bind(null, vacancyId), {} as TalentActionState);
  const [applyState, applyAction, applying] = useActionState(
    async (prev: TalentActionState, formData: FormData) => {
      const result = await applyTechstackAction(vacancyId, prev, formData);
      if (result.ok) {
        setConfirmOpen(false);
        setSelected(new Set());
      }
      return result;
    },
    {} as TalentActionState,
  );

  const visible = rows.filter((r) => (filter === "all" ? true : filter === "unchecked" ? !r.check : r.check?.result === filter));
  const scope = selected.size > 0 ? rows.filter((r) => selected.has(r.applicationId)) : rows;
  const plan = useMemo(
    () => planTechstackMoves(scope.flatMap((r) => (r.check ? [{ applicationId: r.applicationId, result: r.check.result, reason: r.check.reason }] : []))),
    [scope],
  );
  const unclearInSourced = scope.filter((r) => r.check?.result === "unclear" && r.stage === "sourced").length;
  const counts = {
    pass: rows.filter((r) => r.check?.result === "pass").length,
    fail: rows.filter((r) => r.check?.result === "fail").length,
    unclear: rows.filter((r) => r.check?.result === "unclear").length,
    unchecked: rows.filter((r) => !r.check).length,
  };
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.applicationId));
  const idInputs = [...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />);
  const failCount = plan.fail.reduce((n, g) => n + g.ids.length, 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Rules"
          description={
            rules.stack.length > 0
              ? `Stack: ${rules.stack.join(", ")}. A candidate passes with ${rules.requiredHits} or more of these. Edit the stack and must haves on the vacancy.`
              : "This vacancy has no stack yet. Fill it in on the vacancy (Requirements) for a useful check."
          }
        />
        <CardBody>
          <form action={rulesAction} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Field label="Excluded profiles" htmlFor="excluded_profiles" hint="One per line or comma separated, for example: Frontend only, QA, Mobile. A matching job title without stack skills fails.">
              <Textarea id="excluded_profiles" name="excluded_profiles" rows={3} defaultValue={rules.excluded_profiles.join("\n")} />
            </Field>
            <Field label="Stack skills needed" htmlFor="techstack_min_hits" hint={`Empty: ${rules.requiredHits} (about half the stack, at most 3).`}>
              <Input id="techstack_min_hits" name="techstack_min_hits" type="number" min={1} max={50} inputMode="numeric" defaultValue={rules.techstack_min_hits ?? ""} />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton variant="secondary" size="sm" pendingLabel="Saving">
                Save rules
              </SubmitButton>
              <ActionFeedback state={rulesState} className="mt-2" />
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Candidates in Sourced and Techstack check (${rows.length})`}
          description={`${counts.pass} pass, ${counts.fail} fail, ${counts.unclear} unclear, ${counts.unchecked} not checked yet. Running the check moves nobody.`}
        />
        <CardBody className="space-y-4">
          <form action={runAction} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {idInputs}
            <Button type="submit" disabled={running || rows.length === 0} aria-busy={running}>
              {running ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Filter aria-hidden="true" />}
              {selected.size > 0 ? `Check ${selected.size} selected` : `Check all ${rows.length}`}
            </Button>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="use_claude" className="size-4 accent-brand-700" defaultChecked />
              <Sparkles className="size-4 text-accent-600" aria-hidden="true" />
              Let Claude judge the unclear ones {claude ? "(Haiku, low cost)" : "(through the MCP, in its next run)"}
            </label>
            <Button type="button" variant="secondary" className="sm:ml-auto" disabled={plan.pass.length + failCount === 0} onClick={() => setConfirmOpen(true)}>
              Review moves
              <ArrowRight aria-hidden="true" />
            </Button>
          </form>
          <ActionFeedback state={runState} />
          <ActionFeedback state={applyState} />

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter on result">
            {(["all", "pass", "fail", "unclear", "unchecked"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${filter === f ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-brand-900 ring-border hover:bg-brand-50"}`}
              >
                {f === "all" ? `All (${rows.length})` : f === "unchecked" ? `Not checked (${counts.unchecked})` : `${RESULT[f].label} (${counts[f]})`}
              </button>
            ))}
          </div>
        </CardBody>
        {visible.length > 0 && (
          <ul className="divide-y divide-border border-t border-border">
            <li className="flex items-center gap-3 bg-surface/50 px-5 py-2 text-xs text-muted">
              <input
                type="checkbox"
                aria-label="Select all shown"
                className="size-4 accent-brand-700"
                checked={allVisibleSelected}
                onChange={(e) =>
                  setSelected((s) => {
                    const next = new Set(s);
                    for (const r of visible) {
                      if (e.target.checked) next.add(r.applicationId);
                      else next.delete(r.applicationId);
                    }
                    return next;
                  })
                }
              />
              {selected.size > 0 ? `${selected.size} selected: actions apply to these` : "Select candidates, or leave empty for all"}
            </li>
            {visible.map((r) => (
              <li key={r.applicationId} className="flex items-start gap-3 px-5 py-3 text-sm">
                <input
                  type="checkbox"
                  aria-label={`Select ${r.name}`}
                  className="mt-1 size-4 accent-brand-700"
                  checked={selected.has(r.applicationId)}
                  onChange={(e) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(r.applicationId);
                      else next.delete(r.applicationId);
                      return next;
                    })
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/dashboard/candidates/${r.candidateId}`} className="font-medium text-brand-900 hover:underline">
                      {r.name}
                    </Link>
                    {r.title && <span className="text-muted">{r.title}</span>}
                    {r.stage === "techstack_check" && <Badge>In Techstack check</Badge>}
                  </div>
                  {r.check ? (
                    <p className="mt-1 text-muted">
                      {r.check.reason}
                      {r.check.method === "ai" && <span className="ml-1 text-xs text-accent-600">(Claude)</span>}
                    </p>
                  ) : (
                    <p className="mt-1 text-muted">{r.skills.slice(0, 8).join(", ") || "No skills yet"}</p>
                  )}
                </div>
                {r.check ? <Badge tone={RESULT[r.check.result].tone}>{RESULT[r.check.result].label}</Badge> : <Badge>Not checked</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm the moves"
        description={selected.size > 0 ? `For the ${selected.size} selected candidates.` : "For every checked candidate in this list."}
        size="lg"
      >
        <form action={applyAction} className="space-y-4">
          {scope.map((r) => (
            <input key={r.applicationId} type="hidden" name="ids" value={r.applicationId} />
          ))}
          <div className="rounded-xl border border-emerald-600/20 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <strong>{plan.pass.length}</strong> pass and move to <strong>Fill out</strong>.
          </div>
          <div className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
            <p>
              <strong>{failCount}</strong> fail and move to <strong>Rejected</strong> with this reason:
            </p>
            {plan.fail.length > 0 && (
              <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-y-auto pl-5">
                {plan.fail.map((g) => (
                  <li key={g.reason}>
                    {g.reason} ({g.ids.length})
                  </li>
                ))}
              </ul>
            )}
          </div>
          {unclearInSourced > 0 && (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="unclear_to_check" defaultChecked className="size-4 accent-brand-700" />
              Move the {unclearInSourced} unclear ones from Sourced to Techstack check, for a person to look at
            </label>
          )}
          <p className="text-sm text-muted">Rejected candidates can be sent back with Resume on the pipeline. Unclear candidates are never rejected here.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={applying} aria-busy={applying}>
              {applying && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Move {plan.pass.length + failCount} candidates
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
