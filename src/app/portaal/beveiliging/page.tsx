import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/ui/skeleton";
import { MfaSection } from "@/components/settings/security/mfa-section";
import { PasskeySection } from "@/components/settings/security/passkey-section";

export const metadata: Metadata = {
  title: "Beveiliging",
};

/** Account security for client portal users: two-step verification and passkeys. */
export default function Page() {
  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900">Beveiliging</h1>
        <p className="mt-1 text-muted">
          Bescherm je account met tweestapsverificatie of log voortaan in met een passkey.
        </p>
      </div>
      <div className="space-y-6">
        <Suspense fallback={<ListSkeleton rows={2} />}>
          <MfaSection />
        </Suspense>
        <Suspense fallback={<ListSkeleton rows={2} />}>
          <PasskeySection />
        </Suspense>
      </div>
    </>
  );
}
