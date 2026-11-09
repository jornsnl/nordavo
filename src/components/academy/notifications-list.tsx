"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { markNotificationsRead } from "@/app/academy/media-actions";
import type { AcademyLocale } from "@/lib/academy/database";
import { t } from "@/lib/academy/i18n";
import { formatAcademyDateTime } from "@/lib/academy/time";
import { ActionButton } from "./ui";

export type NotificationItem = { id: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };

/** The notifications page: newest first, unread marked, read on open or with one click. */
export function NotificationsList({ items, locale, timeZone, canMark }: { items: NotificationItem[]; locale: AcademyLocale; timeZone: string; canMark: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const tr = (key: Parameters<typeof t>[1]) => t(locale, key);
  const unread = items.filter((i) => !i.readAt).length;

  function mark(id: string | null) {
    if (!canMark) return;
    start(async () => {
      await markNotificationsRead(id);
      router.refresh();
    });
  }

  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Bell className="size-4" aria-hidden="true" />
        {tr("notifications.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {unread > 0 && canMark && (
        <ActionButton variant="secondary" disabled={pending} onClick={() => mark(null)}>
          <CheckCheck aria-hidden="true" />
          {tr("notifications.markAll")}
        </ActionButton>
      )}
      <ul className="divide-y divide-academy-blue-100">
        {items.map((item) => {
          const content = (
            <>
              <p className="flex items-center gap-2 font-semibold text-academy-blue-900">
                {!item.readAt && <span className="size-2 shrink-0 rounded-full bg-academy-orange-600" aria-label={tr("notifications.unread")} />}
                {item.title}
              </p>
              {item.body && <p className="mt-0.5 text-sm text-ink">{item.body}</p>}
              <p className="mt-1 text-xs text-muted">{formatAcademyDateTime(item.createdAt, locale, timeZone)}</p>
            </>
          );
          return (
            <li key={item.id} className={`flex items-start gap-3 py-3 ${item.readAt ? "" : "bg-academy-orange-50/40"}`}>
              <div className="min-w-0 flex-1 px-1">
                {item.link ? (
                  <Link href={item.link} prefetch={false} onClick={() => !item.readAt && mark(item.id)} className="block rounded-lg hover:bg-academy-blue-50">
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </div>
              {!item.readAt && canMark && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => mark(item.id)}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-academy-orange-700 hover:bg-academy-orange-50 pointer-coarse:min-h-11"
                >
                  {tr("notifications.markRead")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
