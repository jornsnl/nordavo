import { Smartphone } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { verifiedTotpFactors } from "@/lib/security/mfa";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmButton } from "@/components/candidates/confirm-button";
import { removeMfaFactor } from "@/app/dashboard/instellingen/mfa-actions";
import { MfaEnroll } from "./mfa-enroll";

/**
 * Two-step verification with an authenticator app. Rendered inside a <Suspense>
 * boundary on /dashboard/instellingen and /portaal/beveiliging, for staff and clients.
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
        title="Tweestapsverificatie"
        description="Na je wachtwoord vragen we om een code uit een app op je telefoon. Zo komt niemand binnen met alleen je wachtwoord."
        actions={<Badge tone={enabled ? "success" : "neutral"}>{enabled ? "Aan" : "Uit"}</Badge>}
      />
      <CardBody className="space-y-5 py-5">
        {enabled ? (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {factors.map((factor, index) => {
              const name = factor.friendly_name || `Authenticator app ${index + 1}`;
              return (
                <li key={factor.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <Smartphone className="size-[18px]" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{name}</p>
                      <p className="text-xs text-muted">Toegevoegd op {formatDate(factor.created_at)}</p>
                    </div>
                  </div>
                  <ConfirmButton
                    size="sm"
                    title="App verwijderen?"
                    description={
                      factors.length > 1
                        ? `Na het verwijderen werken codes uit "${name}" niet meer. Je andere app blijft werken.`
                        : `Na het verwijderen werken codes uit "${name}" niet meer en log je weer in met alleen je wachtwoord.`
                    }
                    confirmLabel="Verwijderen"
                    action={removeMfaFactor.bind(null, factor.id)}
                  >
                    Verwijderen
                  </ConfirmButton>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            Tweestapsverificatie staat uit. Je logt nu in met alleen je wachtwoord.
          </p>
        )}

        <div className="space-y-1.5 rounded-xl bg-surface px-4 py-3 text-sm text-muted">
          <p>
            Werkt met elke authenticator app, zoals Google Authenticator, Microsoft Authenticator,
            1Password of Authy.
          </p>
          <p>
            Staat het aan, dan vul je na je wachtwoord voortaan een code van 6 cijfers uit de app in.
            Log je in met een passkey, dan is dat niet nodig.
          </p>
          <p>Telefoon kwijt of nieuw? Vraag een beheerder om je tweestapsverificatie te resetten.</p>
        </div>

        <MfaEnroll hasFactors={enabled} />
      </CardBody>
    </Card>
  );
}
