import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { requireAcademyUser } from "@/lib/academy/auth";
import { t } from "@/lib/academy/i18n";
import { listMyNotifications } from "@/lib/academy/media/learner";
import { NotificationsList } from "@/components/academy/notifications-list";
import { Panel } from "@/components/academy/ui";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Notifications" };

export default function Page() {
  return (
    <Suspense fallback={<ListSkeleton rows={4} />}>
      <Notifications />
    </Suspense>
  );
}

async function Notifications() {
  const user = await requireAcademyUser();
  const items = user.member ? await listMyNotifications() : [];
  const digest = user.member?.digest_frequency ?? "off";
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight text-academy-blue-900">{t(user.locale, "notifications.title")}</h1>
      <Panel>
        <NotificationsList
          items={items.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, readAt: n.read_at, createdAt: n.created_at }))}
          locale={user.locale}
          timeZone={user.timeZone}
          canMark={Boolean(user.member)}
        />
      </Panel>
      {user.member && (
        <p className="text-sm text-muted">
          {t(user.locale, `notifications.digest.${digest}`)}{" "}
          <Link href="/academy/settings" className="font-medium text-academy-orange-700 hover:underline">
            {t(user.locale, "notifications.changeDigest")}
          </Link>
        </p>
      )}
    </div>
  );
}
