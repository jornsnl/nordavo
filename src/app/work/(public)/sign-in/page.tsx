import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { safeNextPath } from "@/lib/safe-redirect";
import { EmailLinkForm, GoogleButton } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · Work" };

const errors: Record<string, string> = {
  google: "Google sign-in did not work. Use the e-mail you were invited with, or ask for an invite.",
  link: "That link has expired or was already used. Ask for a new one below.",
};

export default function SignInPage({ searchParams }: PageProps<"/work/sign-in">) {
  return (
    <main lang="en" className="flex min-h-dvh items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <LogoMark className="size-11" />
          <h1 className="font-display text-2xl font-bold text-brand-900">Sign in to Work</h1>
          <p className="text-sm text-muted">Nordavo&apos;s task tool. Use the e-mail address you were invited with.</p>
        </div>
        <div className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-xs">
          <Suspense fallback={<GoogleButton next="/work" />}>
            <Forms searchParams={searchParams} />
          </Suspense>
        </div>
        <p className="text-center text-xs text-muted">
          Nordavo team with a password? <Link href="/login" className="text-brand-700 underline">Sign in here</Link>.
        </p>
      </div>
    </main>
  );
}

async function Forms({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const next = safeNextPath(one(params.next), "/work");
  const error = errors[one(params.error) ?? ""];
  return (
    <>
      {error && (
        <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <GoogleButton next={next} />
      <div className="flex items-center gap-3 text-xs text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <EmailLinkForm next={next} />
    </>
  );
}
