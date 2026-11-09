import type { Metadata } from "next";
import { Suspense } from "react";
import { MfaSection } from "@/components/settings/security/mfa-section";
import { PasskeySection } from "@/components/settings/security/passkey-section";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Security" };

/**
 * Account security for Academy users (developers and candidates have no
 * other page): two-step verification and passkeys, same as the portal.
 */
export default function Page() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-academy-blue-900">Security</h1>
        <p className="mt-1 text-muted">Protect your account with two-step verification, or sign in with a passkey from now on.</p>
      </div>
      <div className="space-y-6">
        <Suspense fallback={<ListSkeleton rows={2} />}>
          <MfaSection />
        </Suspense>
        <Suspense fallback={<ListSkeleton rows={2} />}>
          <PasskeySection />
        </Suspense>
      </div>
    </div>
  );
}
