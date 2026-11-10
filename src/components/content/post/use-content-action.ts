"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { toast } from "@/components/ui/toaster";
import type { ContentActionState } from "@/lib/content/errors";

export type ContentFormAction = (state: ContentActionState, formData: FormData) => Promise<ContentActionState>;

const empty: ContentActionState = {};

/**
 * useActionState for content forms: a toast for the outcome, a callback on
 * success, and a submit handler that keeps the typed values in the form
 * (React would reset it after the action).
 */
export function useContentAction(action: ContentFormAction, onSuccess?: (state: ContentActionState) => void) {
  const [state, formAction, pending] = useActionState(action, empty);
  const done = useRef(onSuccess);
  useEffect(() => {
    done.current = onSuccess;
  });
  useEffect(() => {
    if (state.ok) {
      if (state.message) toast(state.message);
      done.current?.(state);
    } else if (state.error && !state.fieldErrors) {
      toast(state.error, { tone: "error" });
    }
  }, [state]);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };
  return { state, formAction, onSubmit, pending, errors: state.fieldErrors ?? {} };
}

/** Run a one-off action (a button) and toast its outcome. */
export async function runAction(promise: Promise<ContentActionState>): Promise<boolean> {
  try {
    const result = await promise;
    if (result.error) toast(result.error, { tone: "error" });
    else if (result.message) toast(result.message);
    return !result.error;
  } catch (error) {
    // redirect() throws on purpose; let Next handle it.
    if (error && typeof error === "object" && "digest" in error) throw error;
    toast("Something went wrong. Please try again.", { tone: "error" });
    return false;
  }
}
