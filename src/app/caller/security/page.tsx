import type { Metadata } from "next";
import { Suspense } from "react";
import { ShieldCheck, Smartphone } from "lucide-react";
import { MfaEnroll } from "@/components/settings/security/mfa-enroll";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { requireCaller } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { verifiedTotpFactors } from "@/lib/security/mfa";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Security",
};

export default function Page() {
  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900">Security</h1>
        <p className="mt-1 text-muted">
          You call for Nordavo with company data, so an authenticator app is required. Without it the other pages stay closed.
        </p>
      </div>
      <Suspense fallback={<ListSkeleton rows={2} />}>
        <Security />
      </Suspense>
    </>
  );
}

/** The only caller page that opens without an authenticator app (requireCaller with allowWithoutMfa). */
async function Security() {
  await requireCaller({ allowWithoutMfa: true });
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const factors = verifiedTotpFactors(data?.all);
  const enabled = factors.length > 0;

  return (
    <Card>
      <CardHeader
        title="Two-step verification"
        description="After your password we ask for a 6 digit code from an app on your phone."
        actions={<Badge tone={enabled ? "success" : "danger"}>{enabled ? "On" : "Required"}</Badge>}
      />
      <CardBody className="space-y-5 py-5">
        {enabled ? (
          <>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {factors.map((factor, index) => (
                <li key={factor.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                    <Smartphone className="size-[18px]" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{factor.friendly_name || `Authenticator app ${index + 1}`}</p>
                    <p className="text-xs text-muted">Added on {formatDate(factor.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="size-4" aria-hidden="true" />
                You are all set. Lost your phone? Ask Nordavo to reset your app.
              </span>
              <ButtonLink href="/caller" size="sm">
                Continue
              </ButtonLink>
            </div>
          </>
        ) : (
          <div className="space-y-1.5 rounded-xl bg-surface px-4 py-3 text-sm text-muted">
            <p>
              Install an authenticator app, such as Google Authenticator, Microsoft Authenticator, 1Password or Authy.
              Then tap the button below, scan the QR code and enter the first code.
            </p>
          </div>
        )}
        <MfaEnroll hasFactors={enabled} />
      </CardBody>
    </Card>
  );
}
