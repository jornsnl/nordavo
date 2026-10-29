import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { ConfirmButton } from "@/components/work/people-admin";
import { ApiTokenForm, NotificationPrefsForm, ProfileForm } from "@/components/work/settings-forms";
import {
  createApiTokenAction,
  revokeApiTokenAction,
  saveNotificationPrefsAction,
  updateMySettingsAction,
} from "@/app/work/actions";
import { env } from "@/lib/env";
import { getNotificationPrefs, listApiTokens, requireWorkUser } from "@/lib/work/data";
import { notificationKinds } from "@/lib/work/labels";
import { commonTimeZones, formatDateIn } from "@/lib/work/time";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader eyebrow="Work" title="Settings" description="Your name, time zone, mails and API tokens." />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Settings />
      </Suspense>
    </>
  );
}

async function Settings() {
  const user = await requireWorkUser();
  const [prefs, tokens] = await Promise.all([getNotificationPrefs(), listApiTokens()]);
  const api = `${env.siteUrl().replace(/\/$/, "")}/api/work/v1`;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="You" description={user.email} />
        <CardBody>
          <ProfileForm action={updateMySettingsAction} name={user.name} timeZone={user.timeZone} zones={commonTimeZones} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Mails" description="By default review requests and mentions arrive right away; the rest comes in one daily overview." />
        <CardBody>
          <NotificationPrefsForm
            action={saveNotificationPrefsAction}
            values={prefs}
            kinds={notificationKinds.map((k) => ({ ...k, default: k.value === "review" || k.value === "mention" ? "instant" : "digest" }))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="API tokens"
          description="For Claude and automations. A token acts as you, with exactly your rights, in every workspace you are in."
        />
        <CardBody className="space-y-5">
          <ApiTokenForm action={createApiTokenAction} />
          {tokens.length > 0 && (
            <ul className="divide-y divide-border border-t border-border">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {t.name} <code className="ml-1 font-mono text-xs text-muted">{t.token_prefix}…</code>
                    </p>
                    <p className="text-xs text-muted">
                      {t.access === "write" ? "Read and write" : "Read only"} · made {formatDateIn(t.created_at, user.timeZone)}
                      {t.last_used_at && ` · last used ${formatDateIn(t.last_used_at, user.timeZone)}`}
                      {t.expires_at && ` · expires ${formatDateIn(t.expires_at, user.timeZone)}`}
                    </p>
                  </div>
                  {t.revoked_at ? (
                    <Badge>Revoked</Badge>
                  ) : (
                    <ConfirmButton run={revokeApiTokenAction.bind(null, t.id)} label="Revoke" confirm={`Revoke "${t.name}"? It stops working at once.`} />
                  )}
                </li>
              ))}
            </ul>
          )}
          <details className="rounded-xl bg-surface p-3 text-sm">
            <summary className="cursor-pointer font-medium">How to use the API</summary>
            <div className="mt-3 space-y-2 text-xs">
              <p>Send the token as a bearer token. Examples:</p>
              <pre className="overflow-x-auto rounded-lg bg-white p-3 font-mono">{`curl -H "Authorization: Bearer wrk_…" ${api}/tasks?assignee=me
curl -X POST -H "Authorization: Bearer wrk_…" -H "Content-Type: application/json" \\
  -d '{"status":"review"}' ${api}/tasks/<id>/status`}</pre>
              <p>
                Full reference: <code>GET {api}</code>. Claude Code can also connect over MCP at <code>{api.replace("/v1", "/mcp")}</code>.
              </p>
            </div>
          </details>
        </CardBody>
      </Card>
    </div>
  );
}
