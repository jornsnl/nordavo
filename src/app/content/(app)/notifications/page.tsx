import type { Metadata } from "next";
import { Suspense } from "react";
import { Bell } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/skeleton";
import { NotificationList } from "@/components/content/notifications/notification-list";
import { listMyNotifications } from "@/lib/content/settings";
import { notificationLabel } from "@/lib/content/rules";
import type { ContentNotificationKind } from "@/lib/content/database";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/content/actions/notifications";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <>
      <PageHeader
        title="Notifications"
        description="What needs you in Content. The same arrive by email unless you switch them off."
        actions={
          <ButtonLink href="/content/settings" variant="secondary">
            Preferences
          </ButtonLink>
        }
      />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Notifications />
      </Suspense>
    </>
  );
}

const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function Notifications() {
  const items = await listMyNotifications();
  if (items.length === 0) {
    return <EmptyState icon={Bell} title="Nothing yet" description="You get a notification when a post needs you: a review, approval, a missing URL or results that are due." />;
  }
  return (
    <NotificationList
      items={items.map((i) => ({
        id: i.id,
        label: notificationLabel(i.kind as ContentNotificationKind),
        message: i.message,
        read: i.read,
        when: when.format(new Date(i.createdAt)),
        href: i.href,
        workspaceName: i.workspaceName,
      }))}
      markRead={markNotificationReadAction}
      markAll={markAllNotificationsReadAction}
    />
  );
}
