import { Smartphone } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { verifiedTotpFactors } from "@/lib/security/mfa";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmButton } from "@/components/candidates/confirm-button";
import { removeMfaFactor } from "@/app/dashboard/settings/mfa-actions";
import { MfaEnroll } from "./mfa-enroll";

/**
 * Two-step verification with an authenticator app. Rendered inside a <Suspense>
 * boundary on /dashboard/settings and /portal/security, for staff and clients.
 */
export async function MfaSection() {
  await getCurrentUser();
  const supabase = await createClient();
  // listFactors asks Supabase Auth for the user, so the list is always current.
  const { data } = await supabase.auth.mfa.listFactors();
  const factors = verifiedTotpFactors(data?.all);
  const enabled = factors.length > 0;

  return (
    <Card>
      <CardHeader
        title="Two-step verification"
        description="After your password we ask for a code from an app on your phone. That way nobody gets in with just your password."
        actions={<Badge tone={enabled ? "success" : "neutral"}>{enabled ? "On" : "Off"}</Badge>}
      />
      <CardBody className="space-y-5 py-5">
        {enabled ? (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {factors.map((factor, index) => {
              const name = factor.friendly_name || `Authenticator app ${index + 1}`;
              return (
                <li
                  key={factor.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 pointer-coarse:[&_button]:min-h-11"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <Smartphone className="size-[18px]" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{name}</p>
                      <p className="text-xs text-muted">Added on {formatDate(factor.created_at)}</p>
                    </div>
                  </div>
                  <ConfirmButton
                    size="sm"
                    title="Remove app?"
                    description={
                      factors.length > 1
                        ? `After removing it, codes from "${name}" no longer work. Your other app keeps working.`
                        : `After removing it, codes from "${name}" no longer work and you sign in with just your password again.`
                    }
                    confirmLabel="Remove"
                    action={removeMfaFactor.bind(null, factor.id)}
                  >
                    Remove
                  </ConfirmButton>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            Two-step verification is off. You now sign in with just your password.
          </p>
        )}

        <div className="space-y-1.5 rounded-xl bg-surface px-4 py-3 text-sm text-muted">
          <p>
            Works with any authenticator app, such as Google Authenticator, Microsoft Authenticator,
            1Password or Authy.
          </p>
          <p>
            Once it is on, you enter a 6 digit code from the app after your password.
            When you sign in with a passkey, that is not needed.
          </p>
          <p>Lost your phone or got a new one? Ask an admin to reset your two-step verification.</p>
        </div>

        <MfaEnroll hasFactors={enabled} />
      </CardBody>
    </Card>
  );
}
