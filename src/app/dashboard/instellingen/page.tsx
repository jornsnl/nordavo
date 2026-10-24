import type { Metadata } from "next";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getOwnProfile, listClientOptions, listProfiles } from "@/lib/data/users";
import { formatDate } from "@/lib/format";
import { optionFor, profileRoles } from "@/lib/labels";
import { verifiedTotpFactors } from "@/lib/security/mfa";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/dashboard/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ConfirmButton } from "@/components/candidates/confirm-button";
import { InviteForm } from "@/components/settings/invite-form";
import { PasswordForm } from "@/components/settings/password-form";
import { ProfileForm } from "@/components/settings/profile-form";
import { RoleEditor } from "@/components/settings/role-editor";
import { McpSection } from "@/components/settings/security/mcp-section";
import { MfaSection } from "@/components/settings/security/mfa-section";
import { PasskeySection } from "@/components/settings/security/passkey-section";
import { changePassword, inviteUser, updateOwnProfile, updateUserRole } from "./actions";
import { resetUserMfa } from "./mfa-actions";

export const metadata: Metadata = {
  title: "Instellingen",
};

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Beheer"
        title="Instellingen"
        description="Je eigen account en, als beheerder, wie er toegang heeft tot het portaal."
      />

      <div className="space-y-6">
        <Card>
          <CardHeader title="Profiel" description="Zo zien je collega's je in het portaal." />
          <CardBody className="py-5">
            <Suspense fallback={<FormSkeleton />}>
              <Profile />
            </Suspense>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Wachtwoord wijzigen"
            description="Kies een sterk wachtwoord dat je nergens anders gebruikt."
          />
          <CardBody className="py-5">
            <PasswordForm action={changePassword} />
          </CardBody>
        </Card>

        <Suspense fallback={<ListSkeleton rows={2} />}>
          <MfaSection />
        </Suspense>

        <Suspense fallback={<ListSkeleton rows={2} />}>
          <PasskeySection />
        </Suspense>

        <Suspense fallback={<ListSkeleton rows={2} />}>
          <McpSection />
        </Suspense>

        <Suspense fallback={<ListSkeleton rows={4} />}>
          <UsersSection />
        </Suspense>
      </div>
    </>
  );
}

async function Profile() {
  const profile = await getOwnProfile();
  return <ProfileForm action={updateOwnProfile} fullName={profile.fullName} email={profile.email} />;
}

/** Only rendered for admins. */
async function UsersSection() {
  const user = await getCurrentUser();
  if (user.role !== "admin") return null;

  const [profiles, clients] = await Promise.all([listProfiles(), listClientOptions()]);
  const canInvite = hasAdminClient();

  // Who has two-step verification on. Needs the secret key; missing means unknown.
  const admin = canInvite ? createAdminClient() : null;
  const mfaByUser = new Map<string, boolean>();
  if (admin) {
    const results = await Promise.all(
      profiles.map((profile) => admin.auth.admin.mfa.listFactors({ userId: profile.id })),
    );
    results.forEach(({ data, error }, i) => {
      if (error) console.error("UsersSection mfa", error.code, error.message);
      else mfaByUser.set(profiles[i].id, verifiedTotpFactors(data?.factors).length > 0);
    });
  }

  return (
    <>
      <section aria-labelledby="users-heading">
        <div className="mb-3 mt-4">
          <h2 id="users-heading" className="font-display text-lg font-semibold text-brand-900">
            Gebruikers
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Teamleden zien alles. Klantaccounts zien alleen hun eigen vacatures en voorgestelde
            kandidaten in het klantportaal.
          </p>
        </div>
        <Table>
          <THead>
            <tr>
              <TH>Naam</TH>
              <TH>Rol</TH>
              <TH>Klant</TH>
              <TH>2FA</TH>
              <TH>Rol en klant aanpassen</TH>
            </tr>
          </THead>
          <TBody>
            {profiles.map((profile) => {
              const name = profile.full_name || profile.email || "Naamloos";
              const role = optionFor(profileRoles, profile.role);
              const isSelf = profile.id === user.id;
              const mfaOn = mfaByUser.get(profile.id);
              return (
                <TR key={profile.id}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Avatar name={name} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">
                          {name}
                          {isSelf && <span className="ml-1.5 text-xs text-muted">(jij)</span>}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {profile.email ?? "Geen e-mailadres"}
                          <span className="hidden sm:inline">
                            {" "}
                            · sinds {formatDate(profile.created_at)}
                          </span>
                        </p>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <Badge tone={role.tone}>{role.label}</Badge>
                  </TD>
                  <TD className="text-muted">
                    {profile.role === "client"
                      ? (profile.client?.name ?? <span className="text-danger">Niet gekoppeld</span>)
                      : "Nordavo"}
                  </TD>
                  <TD>
                    {mfaOn === undefined ? (
                      <span className="text-xs text-muted">Onbekend</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={mfaOn ? "success" : "neutral"}>{mfaOn ? "Aan" : "Uit"}</Badge>
                        {mfaOn && !isSelf && (
                          <ConfirmButton
                            size="sm"
                            variant="ghost"
                            title="Tweestapsverificatie resetten?"
                            description={`Alle authenticator apps van ${name} worden verwijderd. ${name} logt daarna in met alleen een wachtwoord en kan in het profiel een nieuwe app toevoegen. Doe dit alleen als je zeker weet dat het verzoek van ${name} zelf komt.`}
                            confirmLabel="2FA resetten"
                            action={resetUserMfa.bind(null, profile.id)}
                          >
                            2FA resetten
                          </ConfirmButton>
                        )}
                      </div>
                    )}
                  </TD>
                  <TD>
                    {isSelf ? (
                      <span className="text-xs text-muted">
                        Je eigen beheerdersrol kun je niet aanpassen.
                      </span>
                    ) : (
                      <RoleEditor
                        action={updateUserRole}
                        userId={profile.id}
                        userName={name}
                        role={profile.role}
                        clientId={profile.client_id}
                        clients={clients}
                      />
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </section>

      <Card>
        <CardHeader
          title="Gebruiker uitnodigen"
          description="De gebruiker krijgt een e-mail met een link om een wachtwoord in te stellen."
        />
        <CardBody className="py-5">
          <InviteForm action={inviteUser} clients={clients} enabled={canInvite} />
        </CardBody>
      </Card>
    </>
  );
}

function FormSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2" aria-hidden="true">
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
    </div>
  );
}
