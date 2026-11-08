import type { Metadata } from "next";
import { Suspense } from "react";
import { getCurrentUser, hasModule } from "@/lib/auth";
import { getOwnProfile, listClientOptions, listProfiles } from "@/lib/data/users";
import { formatDate } from "@/lib/format";
import { optionFor, profileRoles } from "@/lib/labels";
import { effectiveModules, portalModules } from "@/lib/modules";
import { verifiedTotpFactors } from "@/lib/security/mfa";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/dashboard/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ConfirmButton } from "@/components/candidates/confirm-button";
import { BookingLinkForm } from "@/components/settings/booking-link-form";
import { InviteForm } from "@/components/settings/invite-form";
import { ModulesEditor } from "@/components/settings/modules-editor";
import { PasswordForm } from "@/components/settings/password-form";
import { ProfileForm } from "@/components/settings/profile-form";
import { RoleEditor } from "@/components/settings/role-editor";
import { McpSection } from "@/components/settings/security/mcp-section";
import { MfaSection } from "@/components/settings/security/mfa-section";
import { PasskeySection } from "@/components/settings/security/passkey-section";
import {
  changePassword,
  inviteUser,
  updateBookingUrl,
  updateOwnProfile,
  updateUserModules,
  updateUserRole,
} from "./actions";
import { resetUserMfa } from "./mfa-actions";

export const metadata: Metadata = {
  title: "Settings",
};

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Your own account and, as an admin, who has access to the portal."
      />

      <div className="space-y-6">
        <Card>
          <CardHeader title="Profile" description="This is how your colleagues see you in the portal." />
          <CardBody className="py-5">
            <Suspense fallback={<FormSkeleton />}>
              <Profile />
            </Suspense>
          </CardBody>
        </Card>

        <Suspense fallback={null}>
          <Interviews />
        </Suspense>

        <Card>
          <CardHeader
            title="Change password"
            description="Choose a strong password that you do not use anywhere else."
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

/** Interviewers (recruitment module) keep their Cal.com booking link here (2.14). */
async function Interviews() {
  const user = await getCurrentUser();
  if (!hasModule(user, "recruitment")) return null;
  const profile = await getOwnProfile();
  return (
    <Card>
      <CardHeader
        title="Interviews"
        description="Candidates you invite with Plan interview pick a time on this link, from your availability in Cal.com."
      />
      <CardBody className="py-5">
        <BookingLinkForm action={updateBookingUrl} bookingUrl={profile.bookingUrl} />
      </CardBody>
    </Card>
  );
}

/** What a user sees, in words, for the users list. */
function modulesSummary(profile: { role: string; modules: string[] }) {
  if (profile.role === "admin") return "Everything (admin)";
  if (profile.role !== "member") return null;
  const labels = portalModules.filter((m) => profile.modules.includes(m.value)).map((m) => m.label);
  return labels.length > 0 ? labels.join(", ") : "Tasks only";
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
            Users
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Admins see everything. For each member you decide which modules they see: Sales (leads,
            contacts, lists, campaigns), Recruitment (vacancies, candidates, pipelines, placements),
            Clients and Report. Every member sees tasks and the task tool. Client accounts only see
            their own vacancies and proposed candidates in the client portal.
          </p>
        </div>
        <MobileList label="Users" className="md:hidden">
          {profiles.map((profile) => {
            const name = profile.full_name || profile.email || "Unnamed";
            const role = optionFor(profileRoles, profile.role);
            const isSelf = profile.id === user.id;
            const mfaOn = mfaByUser.get(profile.id);
            return (
              <MobileListItem
                key={profile.id}
                leading={<Avatar name={name} />}
                title={
                  <>
                    {name}
                    {isSelf && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}
                  </>
                }
                subtitle={profile.email ?? "No email address"}
                meta={
                  <>
                    {profile.role === "client"
                      ? (profile.client?.name ?? "Not linked")
                      : profile.role === "external"
                        ? "Work only"
                        : "Nordavo"}
                    {" · 2FA "}
                    {mfaOn === undefined ? "unknown" : mfaOn ? "on" : "off"}
                    {modulesSummary(profile) && <> · {modulesSummary(profile)}</>}
                  </>
                }
                // Others get the role picker below, so the badge would only repeat it.
                trailing={isSelf ? <Badge tone={role.tone}>{role.label}</Badge> : undefined}
              >
                {!isSelf && (
                  <div className="space-y-2 pointer-coarse:[&_button]:min-h-11">
                    <RoleEditor
                      action={updateUserRole}
                      userId={profile.id}
                      userName={name}
                      role={profile.role}
                      clientId={profile.client_id}
                      clients={clients}
                      layout="stacked"
                    />
                    {profile.role === "member" && (
                      <ModulesEditor
                        action={updateUserModules}
                        userId={profile.id}
                        userName={name}
                        modules={effectiveModules(profile.role, profile.modules)}
                        layout="stacked"
                      />
                    )}
                    {mfaOn && <ResetMfaButton userId={profile.id} name={name} />}
                  </div>
                )}
              </MobileListItem>
            );
          })}
        </MobileList>

        <Table className="hidden md:block">
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Role</TH>
              <TH>Client</TH>
              <TH>2FA</TH>
              <TH>Change role and what they see</TH>
            </tr>
          </THead>
          <TBody>
            {profiles.map((profile) => {
              const name = profile.full_name || profile.email || "Unnamed";
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
                          {isSelf && <span className="ml-1.5 text-xs text-muted">(you)</span>}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {profile.email ?? "No email address"}
                          <span className="hidden sm:inline">
                            {" "}
                            · since {formatDate(profile.created_at)}
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
                      ? (profile.client?.name ?? <span className="text-danger">Not linked</span>)
                      : profile.role === "external"
                        ? "Work only"
                        : "Nordavo"}
                  </TD>
                  <TD>
                    {mfaOn === undefined ? (
                      <span className="text-xs text-muted">Unknown</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={mfaOn ? "success" : "neutral"}>{mfaOn ? "On" : "Off"}</Badge>
                        {mfaOn && !isSelf && <ResetMfaButton userId={profile.id} name={name} />}
                      </div>
                    )}
                  </TD>
                  <TD>
                    {isSelf ? (
                      <span className="text-xs text-muted">
                        You cannot change your own admin role.
                      </span>
                    ) : (
                      <div className="space-y-2">
                        <RoleEditor
                          action={updateUserRole}
                          userId={profile.id}
                          userName={name}
                          role={profile.role}
                          clientId={profile.client_id}
                          clients={clients}
                        />
                        {profile.role === "member" ? (
                          <ModulesEditor
                            action={updateUserModules}
                            userId={profile.id}
                            userName={name}
                            modules={effectiveModules(profile.role, profile.modules)}
                          />
                        ) : (
                          modulesSummary(profile) && <p className="text-xs text-muted">{modulesSummary(profile)}</p>
                        )}
                      </div>
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
          title="Invite user"
          description="The user gets an email with a link to set a password."
        />
        <CardBody className="py-5">
          <InviteForm action={inviteUser} clients={clients} enabled={canInvite} />
        </CardBody>
      </Card>
    </>
  );
}

function ResetMfaButton({ userId, name }: { userId: string; name: string }) {
  return (
    <ConfirmButton
      size="sm"
      variant="ghost"
      title="Reset two-step verification?"
      description={`All authenticator apps of ${name} are removed. ${name} then signs in with just a password and can add a new app in their profile. Only do this if you are sure the request comes from ${name} themselves.`}
      confirmLabel="Reset 2FA"
      action={resetUserMfa.bind(null, userId)}
    >
      Reset 2FA
    </ConfirmButton>
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
