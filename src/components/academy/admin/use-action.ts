"use client";

import { useState, useTransition } from "react";
import type { ActionState } from "@/lib/action-state";

/** Run a server action from a button and keep its last result for a message. */
export function useAction() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionState>({});
  function run(action: () => Promise<ActionState>, options: { confirm?: string } = {}) {
    if (options.confirm && !window.confirm(options.confirm)) return;
    startTransition(async () => {
      setResult(await action());
    });
  }
  return { pending, result, run, clear: () => setResult({}) };
}
