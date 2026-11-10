"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import { generatePassword } from "@/lib/security/generate-password";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Admins set a password for another user: type one or generate a random
 * one, copy it to hand it over, then save.
 */
export function AdminPasswordForm({
  userId,
  action,
}: {
  userId: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const errors = state.fieldErrors ?? {};

  async function copy() {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
      <input type="hidden" name="user_id" value={userId} />
      {/* One field the admin can see, so the confirmation is the same value. */}
      <input type="hidden" name="confirm" value={password} />
      <Field
        label="New password"
        htmlFor="admin_new_password"
        required
        error={errors.password ?? errors.confirm}
        hint="At least 8 characters. Generate one, copy it and share it with the user through a safe channel."
      >
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <Input
              id="admin_new_password"
              name="password"
              type={visible ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setCopied(false);
              }}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              minLength={8}
              maxLength={72}
              className="pr-11 font-mono"
              aria-invalid={Boolean(errors.password ?? errors.confirm)}
              aria-describedby={errors.password ?? errors.confirm ? "admin_new_password-error" : undefined}
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-brand-700"
              aria-label={visible ? "Hide password" : "Show password"}
              title={visible ? "Hide" : "Show"}
            >
              {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            </button>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setPassword(generatePassword(16));
              setVisible(true);
              setCopied(false);
            }}
          >
            <RefreshCw aria-hidden="true" />
            Generate
          </Button>
          <Button
            variant="secondary"
            onClick={copy}
            disabled={!password}
            aria-label={copied ? "Password copied" : "Copy password"}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </Field>
      <div className="flex justify-end max-sm:*:w-full">
        <SubmitButton pendingLabel="Saving">Set password</SubmitButton>
      </div>
    </form>
  );
}
