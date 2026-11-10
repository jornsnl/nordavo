"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import type { ContentActionState } from "@/lib/content/errors";
import { toast } from "@/components/ui/toaster";

export type ContentFormAction = (state: ContentActionState, formData: FormData) => Promise<ContentActionState>;

/** useActionState plus a toast and a callback when the action succeeded. */
export function useContentForm(action: ContentFormAction, onSuccess?: (state: ContentActionState) => void) {
  const [state, formAction, pending] = useActionState(action, {});
  const done = useRef(onSuccess);
  useEffect(() => {
    done.current = onSuccess;
  });
  useEffect(() => {
    if (state.ok) {
      if (state.message) toast(state.message);
      done.current?.(state);
    }
  }, [state]);
  return { state, formAction, pending, errors: state.fieldErrors ?? {} };
}

/** Run a one-click server action with a toast for the outcome. */
export function useContentButton() {
  const [pending, start] = useTransition();
  const run = (action: () => Promise<ContentActionState>, onDone?: () => void) =>
    start(async () => {
      const result = await action();
      if (result.error) toast(result.error, { tone: "error" });
      else {
        if (result.message) toast(result.message);
        onDone?.();
      }
    });
  return { pending, run };
}
