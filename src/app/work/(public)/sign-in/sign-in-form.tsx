"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { PendingSubmit } from "@/components/placements/form-utils";
import { sendSignInLink, signInWithGoogle, type SignInState } from "./actions";

export function GoogleButton({ next }: { next: string }) {
  return (
    <form action={signInWithGoogle.bind(null, next)}>
      <button
        type="submit"
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold text-ink shadow-xs transition hover:bg-brand-50 pointer-coarse:min-h-11"
      >
        <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
          <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z" />
          <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3z" />
          <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
        </svg>
        Continue with Google
      </button>
    </form>
  );
}

export function EmailLinkForm({ next, email }: { next: string; email?: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(sendSignInLink, {});
  return (
    <form action={action} className="space-y-3">
      <FormMessage error={state.error} success={state.sent} />
      <input type="hidden" name="next" value={next} />
      <Field label="E-mail" htmlFor="signin_email">
        <Input
          id="signin_email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          defaultValue={email}
          readOnly={Boolean(email)}
          required
          placeholder="name@company.com"
        />
      </Field>
      <PendingSubmit pending={pending} variant="secondary" className="w-full" pendingLabel="Sending">
        <Mail aria-hidden="true" />
        Email me a sign-in link
      </PendingSubmit>
    </form>
  );
}
