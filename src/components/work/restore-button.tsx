"use client";

import { useState, useTransition } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RestoreButton({ run }: { run: () => Promise<{ error?: string; ok?: boolean }> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await run();
            setError(result.error ?? null);
          })
        }
      >
        <Undo2 aria-hidden="true" />
        Restore
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
