"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListOrdered } from "lucide-react";
import { applyContactOrderAction } from "@/app/dashboard/leads/edit-actions";
import { Button } from "@/components/ui/button";
import { contactOrderRule } from "@/lib/sales/labels";

/** Puts contact 1 and 2 back in the default order (leadregels, deel 4). */
export function UseDefaultOrderButton({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        size="sm"
        variant="ghost"
        title={contactOrderRule}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await applyContactOrderAction(companyId);
            setError(result.error ?? null);
            if (!result.error) router.refresh();
          })
        }
      >
        <ListOrdered aria-hidden="true" />
        Use default order
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
