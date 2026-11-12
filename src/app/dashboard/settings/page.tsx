import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser, hasModule } from "@/lib/auth";
import { getOwnProfile, listClientOptions, listProfiles } from "@/lib/data/users";
import { createClient } from "@/lib/supabase/server";
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
import { TestMailForm } from "@/components/settings/test-mail-form";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { recruitmentFrom } from "@/lib/notify/mail";
import { CustomFieldsSettings } from "@/components/custom-fields/custom-fields-settings";
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
import { sendTestMail } from "./mail-actions";
import { regenerateBccAddress } from "./bcc-actions";
import { CopyButton } from "@/components/talent/copy-button";
import { bccAddressFor } from "@/lib/mail/bcc-inbound";
import type { InboundMailStatus } from "@/lib/database.types";
import { DialSettingCard } from "@/components/calls/dial-setting-card";

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
      <Suspense fallback={null}>
        <Tabs />
      </Suspense>

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

        <Suspense fallback={null}>
          <DialSettingCard />
        </Suspense>

        <Suspense fallback={null}>
          <BccLogging />
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

        <CustomFieldsSettings />

        <Suspense fallback={<ListSkeleton rows={2} />}>
          <MailSection />
        </Suspense>

        <Suspense fallback={<ListSkeleton rows={4} />}>
          <UsersSection />
        </Suspense>
      </div>
    </>
  );
}

async function Tabs() {
  const user = await getCurrentUser();
  return <SettingsTabs active="general" isAdmin={user.role === "admin"} />;
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

const inboundStatus: Record<InboundMailStatus, { label: string; tone: "success" | "neutral" | "warning" | "danger" }> = {
  logged: { label: "Logged", tone: "success" },
  no_match: { label: "No contact", tone: "neutral" },
  duplicate: { label: "Duplicate", tone: "neutral" },
  sender_mismatch: { label: "Not from you", tone: "warning" },
  unknown_address: { label: "Unknown address", tone: "warning" },
  no_address: { label: "No BCC address", tone: "warning" },
  invalid: { label: "Unreadable", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
};

/**
 * BCC logging (docs/mail.md): your own address on MAIL_BCC_DOMAIN. Put it in
 * BCC and the mail is logged as an activity on the contacts and companies it
 * went to. Created on first view; Replace makes the old address stop working.
 */
async function BccLogging() {
  const user = await getCurrentUser();
  if (!hasModule(user, "sales")) return null;
  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc("mail_bcc_token", {});
  const address = bccAddressFor(token);
  let query = supabase
    .from("mail_inbound_log")
    .select("id, received_at, status, reason, subject, from_address, company_count")
    .order("received_at", { ascending: false })
    .limit(10);
  // Admins see every inbound mail (also those for unknown addresses), others their own.
  if (user.role !== "admin") query = query.eq("user_id", user.id);
  const { data: recent } = await query;

  return (
    <Card>
      <CardHeader
        title="BCC logging"
        description="Put this address in BCC when you mail a lead or client from your own mailbox. The mail is logged as an activity on every known contact it went to, one per company. Only mail you send yourself counts."
      />
      <CardBody className="space-y-5 py-5">
        {error ? (
          <p className="text-sm text-danger">Your BCC address could not be loaded.</p>
        ) : !address ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            BCC logging is not set up yet: MAIL_BCC_DOMAIN is missing on the server (docs/mail.md, BCC logging).
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <code className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm break-all text-ink select-all">
              {address}
            </code>
            <CopyButton text={address} label="BCC address" />
            <ConfirmButton
              size="sm"
              variant="ghost"
              title="Replace your BCC address?"
              description="You get a new address right away. Mail to the old address is ignored from now on, so update it wherever you saved it (for example an automatic BCC rule)."
              confirmLabel="Replace address"
              action={regenerateBccAddress}
            >
              Replace
            </ConfirmButton>
          </div>
        )}
        <p className="text-xs text-muted">
          Logged: subject, date, To and Cc, Message-ID and the names of attachments, not the text. Nordavo addresses are skipped; a recipient must be a contact with exactly that address.
        </p>
        {(recent ?? []).length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Recent mail</p>
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              {(recent ?? []).map((row) => {
                const status = inboundStatus[row.status];
                return (
                  <li key={row.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{row.subject || "(no subject)"}</p>
                      <p className="text-xs text-muted">
                        {formatDate(row.received_at)}
                        {user.role === "admin" && row.from_address && <> · {row.from_address}</>}
                        {row.status === "logged" && <> · {row.company_count} {row.company_count === 1 ? "company" : "companies"}</>}
                        {row.status !== "logged" && row.reason && <> · {row.reason}</>}
                      </p>
                    </div>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** Admins check the Resend setup and send a test mail in the house style. */
async function MailSection() {
  const user = await getCurrentUser();
  if (user.role !== "admin") return null;

  const hasKey = Boolean(process.env.RESEND_API_KEY);
  const from = process.env.MAIL_FROM;
  const recruitment = process.env.MAIL_FROM_RECRUITMENT;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const checks: { label: string; value: string | null; hint: string; ok: boolean }[] = [
    { label: "RESEND_API_KEY", value: hasKey ? "Set" : null, hint: "Without it no mail leaves the portal.", ok: hasKey },
    { label: "MAIL_FROM", value: from ?? null, hint: "Sender of system mail, on a domain verified in Resend.", ok: Boolean(from) },
    {
      label: "MAIL_FROM_RECRUITMENT",
      value: recruitment ?? null,
      hint: "Sender for candidates. Empty falls back to MAIL_FROM.",
      ok: true,
    },
    {
      label: "REPORT_EMAIL_TO",
      value: process.env.REPORT_EMAIL_TO ?? null,
      hint: "Gets the weekly report and job failures.",
      ok: Boolean(process.env.REPORT_EMAIL_TO),
    },
    {
      label: "NEXT_PUBLIC_SITE_URL",
      value: siteUrl || null,
      hint: "Links and the logo in mails. Must be the public https address.",
      ok: siteUrl.startsWith("https://"),
    },
  ];
  const senders: { value: "default" | "recruitment"; label: string }[] = [];
  if (from) senders.push({ value: "default", label: from });
  const recruitmentSender = recruitmentFrom();
  if (recruitment && recruitmentSender && recruitmentSender !== from) {
    senders.push({ value: "recruitment", label: recruitmentSender });
  }
  if (senders.length === 0) senders.push({ value: "default", label: "MAIL_FROM is not set" });

  return (
    <Card>
      <CardHeader
        title="Email"
        description="Every mail the portal sends goes through Resend in the Nordavo template. Send a test mail to check the setup; every mail appears in the Mail log tab."
      />
      <CardBody className="space-y-6 py-5">
        <ul className="divide-y divide-border rounded-xl border border-border text-sm">
          {checks.map((c) => (
            <li key={c.label} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0">
                <p className="font-mono text-xs font-medium text-ink">{c.label}</p>
                <p className="text-xs text-muted">{c.hint}</p>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                {c.value && c.label !== "RESEND_API_KEY" && (
                  <span className="truncate text-xs text-muted">{c.value}</span>
                )}
                <Badge tone={c.ok ? (c.value ? "success" : "neutral") : c.value ? "warning" : "danger"}>
                  {c.ok ? (c.value ? "OK" : "Not set") : c.value ? "Check" : "Missing"}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
        <TestMailForm action={sendTestMail} defaultTo={user.email} senders={senders} enabled={hasKey && Boolean(from)} />
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

  const [allProfiles, clients, contentWorkspaces] = await Promise.all([listProfiles(), listClientOptions(), listContentWorkspaceOptions()]);
  // External callers are managed in the Callers tab.
  const profiles = allProfiles.filter((profile) => profile.role !== "caller");
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
            Clients and Report. Every member sees tasks and the task tool. Click a name for the details and connected MCP tokens. Client accounts only see
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
                    <Link href={`/dashboard/settings/users/${profile.id}`} className="hover:text-brand-700 hover:underline">
                      {name}
                    </Link>
                    {isSelf && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}
                  </>
                }
                subtitle={profile.email ?? "No email address"}
                meta={
                  <>
                    {profile.role === "client"
                      ? (profile.client?.name ?? "Not linked")
                      : profile.role === "external"
                        ? "Work and Content only"
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
                          <Link href={`/dashboard/settings/users/${profile.id}`} className="hover:text-brand-700 hover:underline">
                            {name}
                          </Link>
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
                        ? "Work and Content only"
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
          <InviteForm action={inviteUser} clients={clients} contentWorkspaces={contentWorkspaces} enabled={canInvite} />
        </CardBody>
      </Card>
    </>
  );
}

/** Content workspaces for "Content only" invites (admins see them all). */
async function listContentWorkspaceOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("content_workspaces").select("id, name").is("archived_at", null).order("name");
  return data ?? [];
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
