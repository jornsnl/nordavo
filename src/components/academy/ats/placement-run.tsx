"use client";

import { RefreshCw } from "lucide-react";
import { runPlacementAcademy } from "@/app/dashboard/candidates/academy-actions";
import { useAction } from "@/components/academy/admin/use-action";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";

export function RunPlacementAcademyButton({ placementId, again }: { placementId: string; again: boolean }) {
  const { pending, result, run } = useAction();
  return (
    <div className="space-y-2">
      <FormMessage error={result.error} success={result.message} />
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => runPlacementAcademy(placementId))}>
        <RefreshCw aria-hidden="true" className={pending ? "animate-spin" : ""} />
        {again ? "Run again" : "Run now"}
      </Button>
    </div>
  );
}
