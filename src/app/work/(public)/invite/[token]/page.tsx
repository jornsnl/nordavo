import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { buttonClasses } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { inviteTokenHash } from "@/lib/work/tokens";
import { workOption, workRoles } from "@/lib/work/labels";
import { acceptInviteAction } from "@/app/work/actions";
import { EmailLinkForm, GoogleButton } from "../../sign-in/sign-in-form";
import { AcceptInviteButton } from "./accept-button";

export const metadata: Metadata = { title: "Invite · Work" };

export default function InvitePage({ params }: PageProps<"/work/invite/[token]">) {
  return (
    <main lang="en" className="flex min-h-dvh items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <LogoMark className="size-11" />
        </div>
        <div className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xs">
          <Suspense fallback={<p className="text-sm text-muted">Loading the invite…</p>}>
            <Invite params={params} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const hash = inviteTokenHash(token);
  const path = `/work/invite/${encodeURIComponent(token)}`;
  const supabase = await createClient();
  const [{ data: preview }, { data: claims }] = await Promise.all([
    supabase.rpc("work_invite_preview", { p_token_hash: hash }),
    supabase.auth.getClaims(),
  ]);
  const invite = preview?.[0];

  if (!invite) {
    return <Message title="Invite not found" text="Check that you used the whole link from the mail, or ask for a new invite." />;
  }
  if (invite.status === "revoked") return <Message title="Invite withdrawn" text="This invite is no longer valid. Ask for a new one." />;
  if (invite.status === "expired") return <Message title="Invite expired" text="Invites work for 14 days. Ask for a new one." />;

  const where = invite.project_name ? `${invite.project_name} in ${invite.workspace_name}` : invite.workspace_name;
  const role = workOption(workRoles, invite.role).label.toLowerCase();
  const signedInEmail = (claims?.claims?.email as string | undefined)?.toLowerCase();

  const heading = (
    <div className="space-y-1 text-center">
      <h1 className="font-display text-xl font-bold text-brand-900">Join {where}</h1>
      <p className="text-sm text-muted">
        {invite.invited_by_name ?? "Someone"} invited <strong className="font-medium text-ink">{invite.email}</strong> as {role}.
      </p>
    </div>
  );

  if (invite.status === "accepted") {
    return (
      <>
        {heading}
        <p className="text-center text-sm text-muted">This invite was already accepted.</p>
        <Link href="/work" className={buttonClasses({ className: "w-full" })}>
          Go to Work
        </Link>
      </>
    );
  }

  if (!claims?.claims) {
    return (
      <>
        {heading}
        <p className="text-center text-sm text-muted">Sign in with that address to accept.</p>
        <GoogleButton next={path} />
        <EmailLinkForm next={path} email={invite.email} />
      </>
    );
  }

  if (signedInEmail !== invite.email) {
    return (
      <>
        {heading}
        <p className="rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You are signed in as {signedInEmail}. This invite is for {invite.email}. Sign out and sign in with that address.
        </p>
        <form action={`/auth/signout?next=/work/sign-in`} method="post">
          <button type="submit" className={buttonClasses({ variant: "secondary", className: "w-full" })}>
            Sign out
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      {heading}
      <AcceptInviteButton action={acceptInviteAction.bind(null, hash)} />
    </>
  );
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="space-y-2 text-center">
      <h1 className="font-display text-xl font-bold text-brand-900">{title}</h1>
      <p className="text-sm text-muted">{text}</p>
    </div>
  );
}
