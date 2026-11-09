"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Trash2 } from "lucide-react";
import { deleteMyWsp, setWspShare } from "@/app/working-style/actions";
import { DELETE_MY_PROFILE_BUTTON } from "@/lib/wsp/content";
import type { WspAccess } from "@/lib/wsp/data";
import type { ClientShare } from "@/lib/wsp/report";
import { SHARE_STATUS_LABELS, consentText, formatWspDate, shareChecked } from "@/lib/wsp/text";

/**
 * Permission per linked client (part 4): a box per client with the exact
 * text, never ticked by default, the status and the date of consent. Only
 * the person, signed in to their own account, can tick or untick it; the
 * database checks that too (RLS on wsp_shares).
 */
export function WspSharePanel({
  assessmentId,
  clients,
  canShare,
  signInHref,
}: {
  assessmentId: string;
  clients: ClientShare[];
  canShare: boolean;
  signInHref: string;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-5 shadow-xs sm:px-6" aria-labelledby={`wsp-share-${assessmentId}`}>
      <h2 id={`wsp-share-${assessmentId}`} className="font-display text-base font-semibold text-brand-900">
        Sharing with companies
      </h2>
      {clients.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Your profile is not linked to a client company. Nothing is shared.</p>
      ) : !canShare ? (
        <div className="mt-2 space-y-3 text-sm text-ink">
          <p>Your profile is not shared with any company unless you tick the box for that company yourself. To do that, sign in to your Nordavo account.</p>
          <ul className="space-y-1">
            {clients.map((client) => (
              <li key={client.clientId} className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{client.name}</span>
                <span className="text-muted">{SHARE_STATUS_LABELS[client.status]}</span>
              </li>
            ))}
          </ul>
          <a href={signInHref} className="inline-flex font-medium text-brand-700 underline hover:no-underline">
            Sign in to manage sharing
          </a>
          <p className="text-xs text-muted">No account yet? Ask your contact at Nordavo for one.</p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {clients.map((client) => (
            <ShareRow key={client.clientId} assessmentId={assessmentId} client={client} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ShareRow({ assessmentId, client }: { assessmentId: string; client: ClientShare }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const checked = shareChecked(client.status);
  const id = `wsp-share-${assessmentId}-${client.clientId}`;
  return (
    <li className="py-3">
      <label htmlFor={id} className="flex items-start gap-3 text-sm text-ink">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={pending}
          onChange={(event) => {
            const share = event.target.checked;
            setError(undefined);
            startTransition(async () => {
              const result = await setWspShare({ assessmentId, clientId: client.clientId, share });
              if (!result.ok) setError(result.error);
              router.refresh();
            });
          }}
          className="mt-0.5 size-5 shrink-0 rounded border-border accent-brand-700"
        />
        <span>{consentText(client.name)}</span>
        {pending && <LoaderCircle className="size-4 shrink-0 animate-spin text-muted" aria-hidden="true" />}
      </label>
      <p className="mt-1 pl-8 text-xs text-muted">
        {SHARE_STATUS_LABELS[client.status]}
        {client.status === "shared" && client.consentedAt && ` since ${formatWspDate(client.consentedAt)}`}
        {client.status === "withdrawn" && client.revokedAt && ` on ${formatWspDate(client.revokedAt)}`}
      </p>
      {error && (
        <p role="alert" className="mt-1 pl-8 text-xs text-danger">
          {error}
        </p>
      )}
    </li>
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
