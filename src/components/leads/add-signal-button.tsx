"use client";

import { Plus } from "lucide-react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ActionModal, invalidProps, type FormAction } from "./action-modal";

/**
 * Add a signal by hand (leadregels, deel 4): kind, title, date, source link
 * and until when it counts. The points come from the points table in
 * Settings; the score is computed again at once.
 */
export function AddSignalButton({
  kinds,
  action,
}: {
  kinds: { value: string; label: string; points: number | null }[];
  action: FormAction;
}) {
  return (
    <ActionModal
      label="Add signal"
      icon={Plus}
      variant="secondary"
      title="Add signal"
      description="A vacancy, funding, a team in India or another signal. Several vacancies and a vacancy open 60 days follow from the vacancies themselves."
      action={action}
      modalSize="lg"
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            <Field label="Kind" htmlFor="new-signal-type" required error={e.type}>
              <Select id="new-signal-type" name="type" defaultValue="vacature">
                {kinds.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                    {k.points !== null ? ` (${k.points > 0 ? "+" : ""}${k.points})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Title" htmlFor="new-signal-title" required error={e.title}>
              <Input id="new-signal-title" name="title" {...invalidProps(state, "title", "new-signal-title")} />
            </Field>
            <Field label="Source (link)" htmlFor="new-signal-url" error={e.source_url}>
              <Input id="new-signal-url" name="source_url" type="url" {...invalidProps(state, "source_url", "new-signal-url")} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date" htmlFor="new-signal-date" error={e.posted_at}>
                <Input id="new-signal-date" name="posted_at" type="date" />
              </Field>
              <Field label="Valid until" htmlFor="new-signal-valid" hint="Empty: the default of its kind." error={e.valid_until}>
                <Input id="new-signal-valid" name="valid_until" type="date" />
              </Field>
            </div>
            <Field label="Text" htmlFor="new-signal-text" error={e.description}>
              <Textarea id="new-signal-text" name="description" rows={4} />
            </Field>
          </>
        );
      }}
    </ActionModal>
  );
}
