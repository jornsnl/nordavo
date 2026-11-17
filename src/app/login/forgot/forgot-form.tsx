"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { PendingSubmit } from "@/components/placements/form-utils";
import { requestPasswordReset, type ForgotState } from "./actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestPasswordReset, {});
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage error={state.error} success={state.sent} />
      <Field label="E-mail address" htmlFor="forgot_email">
        <Input
          id="forgot_email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          defaultValue={state.email}
          placeholder="name@company.com"
        />
      </Field>
      <PendingSubmit pending={pending} className="w-full" pendingLabel="Sending">
        <Mail aria-hidden="true" />
        Email me a link
      </PendingSubmit>
      <Link
        href="/login"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 underline-offset-4 hover:underline pointer-coarse:min-h-11"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to sign in
      </Link>
    </form>
  );
}
