"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Trash2 } from "lucide-react";
import { declineWspConsent, deleteMyWsp, giveWspConsent, withdrawWspConsent } from "@/app/working-style/actions";
import {
  CONSENT_BENEFIT,
  CONSENT_GIVEN,
  CONSENT_NOT_GIVEN,
  CONSENT_NOT_NOW,
  CONSENT_QUESTION,
  CONSENT_WITHDRAW,
  CONSENT_WITHDRAW_CONFIRM,
  CONSENT_YES,
  DELETE_MY_PROFILE_BUTTON,
} from "@/lib/wsp/content";
import { CHANNEL_LABELS, type WspConsentState } from "@/lib/wsp/consent";
import type { WspAccess } from "@/lib/wsp/data";
import { formatWspDate } from "@/lib/wsp/text";

/**
 * The one general permission (feedback Julius): on the last screen of the
 * questionnaire a short result, the question with what it brings, a big
 * "Yes, share" and a small "Not now"; afterwards (report, Academy) the
 * status with "Withdraw permission" or "Yes, share", and which companies
 * received the profile and when. Nothing is ticked beforehand, and nothing
 * depends on the answer. The database checks the link or account.
 */
export function WspConsentPanel({
  access,
  state,
  via,
  prompt = false,
}: {
  access: WspAccess;
  state: WspConsentState;
  via: "questionnaire" | "report" | "academy";
  /** The question on its own (the last screen, or asked once more). */
  prompt?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  };
  const live = state.recipients.filter((r) => !r.revokedAt);

  if (prompt && !state.consented) {
    return (
      <section className="rounded-2xl border border-brand-200 bg-brand-50/60 px-5 py-5 shadow-xs sm:px-6" aria-labelledby="wsp-consent-question">
        <h2 id="wsp-consent-question" className="font-display text-lg font-semibold text-brand-900">
          {CONSENT_QUESTION}
        </h2>
        <p className="mt-1.5 text-sm text-ink">{CONSENT_BENEFIT}</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => giveWspConsent(access, via))}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-700 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-brand-800 disabled:opacity-60"
          >
            {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {CONSENT_YES}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => declineWspConsent(access))}
            className="self-center text-sm text-muted underline hover:text-ink sm:self-auto"
          >
            {CONSENT_NOT_NOW}
          </button>
        </div>
        <p className="mt-3 text-xs text-muted">You can withdraw this at any time.</p>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-5 shadow-xs sm:px-6" aria-labelledby="wsp-consent-status">
      <h2 id="wsp-consent-status" className="font-display text-base font-semibold text-brand-900">
        Sharing with companies
      </h2>
      {state.consented ? (
        <p className="mt-2 text-sm text-ink">
          {CONSENT_GIVEN}
          {state.consentedAt && <span className="text-muted"> Since {formatWspDate(state.consentedAt)}.</span>}
        </p>
      ) : (
        <div className="mt-2 space-y-3 text-sm text-ink">
          <p>
            {CONSENT_NOT_GIVEN} {CONSENT_QUESTION}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => giveWspConsent(access, via))}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
          >
            {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {CONSENT_YES}
          </button>
        </div>
      )}

      <h3 className="mt-5 text-xs font-semibold tracking-wide text-muted uppercase">Received your profile</h3>
      {state.recipients.length === 0 ? (
        <p className="mt-1 text-sm text-muted">No company has received your profile.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {state.recipients.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
              <span className="font-medium text-ink">{r.name}</span>
              <span className="text-xs text-muted">
                {CHANNEL_LABELS[r.channel]}, {formatWspDate(r.sharedAt)}
                {r.revokedAt && ` · access ended ${formatWspDate(r.revokedAt)}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {state.consented && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(CONSENT_WITHDRAW_CONFIRM)) return;
            run(() => withdrawWspConsent(access));
          }}
          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-danger hover:underline disabled:opacity-60"
        >
          {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {CONSENT_WITHDRAW}
        </button>
      )}
      {!state.consented && live.length > 0 && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(CONSENT_WITHDRAW_CONFIRM)) return;
            run(() => withdrawWspConsent(access));
          }}
          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-danger hover:underline disabled:opacity-60"
        >
          End access for these companies
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/** "Delete my profile": deletes everything at once, after a confirmation. */
export function WspDeleteButton({ access, afterHref }: { access: WspAccess; afterHref: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4 shadow-xs sm:px-6">
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-danger hover:underline"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          {DELETE_MY_PROFILE_BUTTON}
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink">
            This deletes your answers, your report and every permission you gave, right away. Companies you shared it with lose access and are asked to delete their copies. This cannot be undone.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteMyWsp(access);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  router.push(afterHref);
                  router.refresh();
                })
              }
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-danger px-4 py-2.5 text-sm font-semibold text-white hover:bg-danger/90 disabled:opacity-60"
            >
              {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
              Yes, delete my profile
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex items-center justify-center rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold text-brand-900 hover:bg-brand-50"
            >
              Cancel
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
