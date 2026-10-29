"use client";

import { useActionState } from "react";
import type { WorkActionState } from "@/lib/work/errors";
import { FormMessage } from "@/components/ui/field";
import { PendingSubmit } from "@/components/placements/form-utils";

export function AcceptInviteButton({ action }: { action: (state: WorkActionState) => Promise<WorkActionState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <FormMessage error={state.error} />
      <PendingSubmit pending={pending} className="w-full" pendingLabel="Joining">
        Accept invite
      </PendingSubmit>
    </form>
  );
}
