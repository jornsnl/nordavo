"use client";

import { useState, useTransition, type ReactNode } from "react";
import { LoaderCircle, PhoneForwarded } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { todayIso } from "@/lib/format";
import {
  assignCompaniesToCallers,
  assignContactsToCallers,
  unassignContacts,
} from "@/app/dashboard/call-lists/actions";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";

export type CallerOption = { id: string; name: string; party?: string | null };

/**
 * Opens loose contacts or whole companies for one or more external callers
 * until a date (feedback Julius, section 2.10). Contacts are spread round
 * robin by company: all contacts of a company go to the same caller. Admins
 * only; the actions check that again.
 *
 * Use it from a table selection:
 *   <AssignCallersDialog contactIds={selected} callers={callers} onDone={clear} />
 *   <AssignCallersDialog companyIds={selected} callers={callers} />
 */
export function AssignCallersDialog({
  contactIds,
  companyIds,
  callers,
  onDone,
  trigger,
  disabled,
}: {
  contactIds?: string[];
  companyIds?: string[];
  /** Active callers to pick from. */
  callers: CallerOption[];
  onDone?: (result: ActionState) => void;
  /** Button content; defaults to "Open for callers". */
  trigger?: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [until, setUntil] = useState("");
  const [result, setResult] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  const forCompanies = Boolean(companyIds && companyIds.length > 0);
  const count = forCompanies ? companyIds!.length : (contactIds?.length ?? 0);
  const what = forCompanies ? (count === 1 ? "company" : "companies") : count === 1 ? "contact" : "contacts";

  function close() {
    if (pending) return;
    setOpen(false);
    setResult({});
  }

  function run(fn: () => Promise<ActionState>) {
    setResult({});
    startTransition(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        onDone?.(r);
        setPicked([]);
      }
    });
  }

  function save() {
    if (picked.length === 0) {
      setResult({ error: "Pick at least one caller." });
      return;
    }
    run(() =>
      forCompanies
        ? assignCompaniesToCallers(companyIds!, picked, until || null)
        : assignContactsToCallers(contactIds ?? [], picked, until || null),
    );
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={disabled || count === 0}>
        {trigger ?? (
          <>
            <PhoneForwarded aria-hidden="true" />
            Open for callers
          </>
        )}
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Open for callers"
        description={`${count} ${what}. With more callers, each company goes to one caller in turn.`}
      >
        <div className="space-y-5">
          {callers.length === 0 ? (
            <p className="text-sm text-muted">There are no active callers. Add one in Settings, Callers.</p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium text-ink">Callers</legend>
              {callers.map((c) => (
                <label key={c.id} className="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-700"
                    checked={picked.includes(c.id)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((id) => id !== c.id))}
                  />
                  <span className="font-medium text-ink">{c.name}</span>
                  {c.party && <span className="text-muted">{c.party}</span>}
                </label>
              ))}
            </fieldset>
          )}
          <Field label="Open until" htmlFor="assign-until" hint="Empty keeps them open until you take them back.">
            <Input id="assign-until" type="date" min={todayIso()} value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
          <FormMessage error={result.error} success={result.ok ? result.message : undefined} />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            {!forCompanies && (contactIds?.length ?? 0) > 0 ? (
              <Button variant="ghost" disabled={pending} onClick={() => run(() => unassignContacts(contactIds ?? []))}>
                Take back from callers
              </Button>
            ) : (
              <span />
            )}
            <Button onClick={save} disabled={pending || callers.length === 0} aria-busy={pending}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Open for {picked.length || ""} {picked.length === 1 ? "caller" : "callers"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
