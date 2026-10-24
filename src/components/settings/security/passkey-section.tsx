import { KeyRound } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { hasAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  finishPasskeyRegistration,
  removePasskey,
  renamePasskey,
  startPasskeyRegistration,
} from "@/app/dashboard/instellingen/passkey-actions";
import { PasskeyItem } from "./passkey-item";
import { PasskeyRegister } from "./passkey-register";

/**
 * Passkeys for the signed-in user, staff and client users alike.
 * Rendered inside a <Suspense> boundary on /dashboard/instellingen and /portaal/beveiliging.
 */
export async function PasskeySection() {
  const user = await getCurrentUser();
  const enabled = hasAdminClient();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("passkeys")
    .select("id, name, device_type, backed_up, created_at, last_used_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) console.error("PasskeySection", error);
  const passkeys = data ?? [];

  return (
    <Card>
      <CardHeader
        title="Passkeys"
        description="Inloggen met je vingerafdruk, gezicht of de pincode van je apparaat. Zonder wachtwoord."
      />
      <CardBody className="space-y-5 py-5">
        <div className="space-y-2 text-sm text-muted">
          <p>
            Een passkey is een sleutel die op je apparaat blijft. Je logt ermee in zonder
            wachtwoord, en een nepsite kan hem niet gebruiken: passkeys zijn phishingbestendig.
          </p>
          <p>
            Gesynchroniseerde passkeys (iCloud Keychain, Google Password Manager, 1Password) werken
            op al je apparaten. Inloggen met een passkey telt ook als tweestapsverificatie.
          </p>
        </div>

        {passkeys.length > 0 ? (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {passkeys.map((passkey) => (
              <PasskeyItem
                key={passkey.id}
                id={passkey.id}
                name={passkey.name}
                synced={passkey.device_type === "multiDevice" && passkey.backed_up}
                createdAt={formatDate(passkey.created_at)}
                lastUsedAt={passkey.last_used_at ? formatDateTime(passkey.last_used_at) : null}
                renameAction={renamePasskey}
                removeAction={removePasskey}
              />
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted">
            <KeyRound className="size-4 shrink-0" aria-hidden="true" />
            Je hebt nog geen passkeys.
          </p>
        )}

        {enabled ? (
          <PasskeyRegister
            startAction={startPasskeyRegistration}
            finishAction={finishPasskeyRegistration}
          />
        ) : (
          <p className="rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Passkeys werken pas als <code className="font-mono text-xs">SUPABASE_SECRET_KEY</code>{" "}
            op de server is ingesteld.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
