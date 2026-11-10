import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { ArrowLeftRight, Eye, PencilLine, ShieldAlert, ShieldCheck } from "lucide-react";
import { Logo, LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { env } from "@/lib/env";
import { AUTHORIZE_FIELDS, checkAuthorizeRequest, type AuthorizeParams } from "@/lib/mcp/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideAuthorization } from "./actions";

export const metadata: Metadata = {
  title: "Connect an app",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * OAuth consent page of the MCP server (src/lib/mcp/oauth.ts). Claude sends
 * the team member here; they choose read or read and write and go back to
 * the app with a one-time code. Signed out visitors go through /login first,
 * the proxy keeps the query string.
 */
export default function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-surface px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:justify-center sm:py-12">
      <div className="w-full max-w-md">
        <Logo className="mb-8 justify-center" />
        <Suspense fallback={<PanelSkeleton />}>
          <Consent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Consent({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return (
      <Problem title="Only for the Nordavo team">
        Apps can only be connected by team members. You are signed in as {user.email}.
      </Problem>
    );
  }

  const db = createAdminClient();
  if (!db) {
    return (
      <Problem title="Not available yet">
        Connecting apps only works once SUPABASE_SECRET_KEY is set on the server. Ask an admin to add it.
      </Problem>
    );
  }

  const raw = await searchParams;
  const input: Record<string, string | undefined> = {};
  for (const field of AUTHORIZE_FIELDS) {
    const value = raw[field];
    if (typeof value === "string") input[field] = value;
  }

  const check = await checkAuthorizeRequest(input, db, env.siteUrl());
  if (check.kind === "fatal") return <Problem title="This link does not work">{check.message}</Problem>;
  if (check.kind === "redirect") {
    return (
      <Problem title="The app sent an invalid request">
        {check.description} Go back to the app and try to connect again.
      </Problem>
    );
  }

  const { client, params, access } = check;
  const returnHost = hostOf(params.redirect_uri);

  return (
    <section className="rounded-2xl border border-border bg-card shadow-xs">
      <header className="space-y-4 border-b border-border px-5 py-5 text-center sm:px-6">
        <div aria-hidden="true" className="flex items-center justify-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 font-display text-lg font-bold text-brand-700">
            {client.client_name.slice(0, 1).toUpperCase()}
          </span>
          <ArrowLeftRight className="size-4 text-muted" />
          <LogoMark className="size-11" />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-brand-900">
            Connect {client.client_name} to Nordavo
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {client.client_name} wants to use Nordavo on your behalf, with your permissions. Signed in as{" "}
            <span className="font-medium text-ink">{user.name}</span>
            {user.email ? ` (${user.email})` : ""}.
          </p>
        </div>
      </header>

      <form action={decideAuthorization} className="space-y-5 px-5 py-5 sm:px-6">
        <HiddenParams params={params} />

        <fieldset className="space-y-2.5">
          <legend className="mb-2.5 text-sm font-semibold text-brand-900">What may it do?</legend>
          <AccessOption
            value="read"
            defaultChecked={access === "read"}
            icon={<Eye aria-hidden="true" className="size-5" />}
            title="Read"
            text="Look up clients, vacancies, pipelines, candidates, placements, tasks, notes and the sales CRM."
          />
          <AccessOption
            value="write"
            defaultChecked={access === "write"}
            icon={<PencilLine aria-hidden="true" className="size-5" />}
            title="Read and write"
            text="Also create tasks and notes, move candidates and do sales actions. The whole team sees these changes."
          />
        </fieldset>

        <ul className="space-y-2 rounded-xl border border-border bg-surface/60 px-4 py-3 text-sm text-muted">
          <li className="flex gap-2">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-700" />
            <span>
              It only sees the modules you have. Disconnect any time under Settings, Connect Claude (MCP).
            </span>
          </li>
          <li className="flex gap-2">
            <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-700" />
            <span>
              After this you go back to <span className="font-medium break-all text-ink">{returnHost}</span>. Only
              continue if you started connecting from that app yourself.
            </span>
          </li>
        </ul>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="submit" name="decision" value="deny" variant="secondary">
            Cancel
          </Button>
          <SubmitButton name="decision" value="allow" pendingLabel="Connecting">
            Allow access
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}

function AccessOption({
  value,
  defaultChecked,
  icon,
  title,
  text,
}: {
  value: "read" | "write";
  defaultChecked: boolean;
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-xl border border-border bg-white px-4 py-3.5 transition hover:border-brand-200 has-checked:border-brand-600 has-checked:bg-brand-50 has-checked:ring-1 has-checked:ring-brand-600 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand-500">
      <input type="radio" name="access" value={value} defaultChecked={defaultChecked} className="sr-only" />
      <span className="mt-0.5 text-brand-700">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-sm text-muted">{text}</span>
      </span>
    </label>
  );
}

function HiddenParams({ params }: { params: AuthorizeParams }) {
  const fields: Record<string, string | null> = {
    response_type: "code",
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    state: params.state,
    code_challenge: params.code_challenge,
    code_challenge_method: "S256",
    scope: params.scope,
    resource: params.resource,
  };
  return (
    <>
      {Object.entries(fields).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
    </>
  );
}

function Problem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section role="alert" className="rounded-2xl border border-border bg-card px-5 py-6 text-center shadow-xs sm:px-6">
      <ShieldAlert aria-hidden="true" className="mx-auto mb-3 size-8 text-amber-700" />
      <h1 className="font-display text-lg font-bold text-brand-900">{title}</h1>
      <p className="mt-2 text-sm text-muted">{children}</p>
    </section>
  );
}

function PanelSkeleton() {
  return <div aria-hidden="true" className="h-[480px] animate-pulse rounded-2xl border border-border bg-card" />;
}

function hostOf(uri: string): string {
  try {
    const url = new URL(uri);
    return url.host || `${url.protocol}${url.pathname}`;
  } catch {
    return uri;
  }
}
