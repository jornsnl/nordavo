"use client";

import { useState } from "react";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";
import { useWorkAction, type WorkAction } from "@/components/work/forms";

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function NewWorkspaceForm({ action }: { action: WorkAction }) {
  const { state, formAction, pending, errors } = useWorkAction(action);
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-4" noValidate>
      <FormMessage error={state.error} />
      <Field label="Name" htmlFor="ws_name" required error={errors.name}>
        <Input id="ws_name" name="name" required maxLength={80} autoFocus onChange={(e) => !touched && setSlug(slugify(e.target.value))} />
      </Field>
      <Field label="Web address" htmlFor="ws_slug" required hint={`/work/w/${slug || "name"}`} error={errors.slug}>
        <Input
          id="ws_slug"
          name="slug"
          required
          value={slug}
          onChange={(e) => {
            setTouched(true);
            setSlug(slugify(e.target.value));
          }}
        />
      </Field>
      <p className="text-xs text-muted">You become the first admin. Invite the others from Manage.</p>
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} pendingLabel="Creating">
          Create workspace
        </PendingSubmit>
      </div>
    </form>
  );
}
