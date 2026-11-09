"use client";

import { useState } from "react";
import type { EntityType } from "@/lib/database.types";
import { FormMessage } from "@/components/ui/field";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";
import { useWorkAction, type WorkAction } from "@/components/work/forms";
import { RecordPicker, type PickedRecord } from "@/components/work/record-picker";

/**
 * Set, change or clear the portal record of a task on the task page. Only
 * rendered for team members who have the module of at least one record type.
 */
export function RecordLinkForm({
  action,
  initial,
  types,
}: {
  action: WorkAction;
  initial: PickedRecord | null;
  types: EntityType[];
}) {
  // A new key after saving resets the picker to what the server has now.
  const [version, setVersion] = useState(0);
  const { state, formAction, pending, errors } = useWorkAction(action, () => setVersion((v) => v + 1));
  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-3" noValidate>
      <FormMessage error={state.error && !state.fieldErrors ? state.error : undefined} success={state.ok ? state.message : undefined} />
      <RecordPicker key={`${version}-${initial?.id ?? "none"}`} initial={initial} types={types} error={errors.entity_id} />
      <div className="flex justify-end max-sm:*:w-full">
        <PendingSubmit pending={pending} size="sm" variant="secondary" pendingLabel="Saving">
          Save link
        </PendingSubmit>
      </div>
    </form>
  );
}
