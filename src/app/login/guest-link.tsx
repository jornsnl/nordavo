import { Mail } from "lucide-react";
import { EmailLinkForm } from "@/app/work/(public)/sign-in/sign-in-form";

/**
 * Work guests and freelancers have no password: they ask for a one-time
 * sign-in link here. Staff and clients keep password, passkey and app code
 * (the link is refused for them, see src/lib/security/sign-in-link.ts).
 */
export function GuestLinkSignIn() {
  return (
    <details className="group mt-6 rounded-xl border border-border bg-white px-4 py-3 shadow-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-brand-900 pointer-coarse:min-h-9">
        <Mail className="size-4 text-brand-600" aria-hidden="true" />
        Invited to Work as a guest? Email me a sign-in link
      </summary>
      <div className="mt-3">
        <EmailLinkForm next="/work" />
      </div>
    </details>
  );
}
