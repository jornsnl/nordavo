"use client";

import { useOptimistic, useTransition } from "react";
import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import type { ContentActionState } from "@/lib/content/errors";

type Item = { id: number; label: string; message: string; read: boolean; when: string; href: string; workspaceName: string | null };

/** Notifications, unread first; opening one marks it read. */
export function NotificationList({
  items,
  markRead,
  markAll,
}: {
  items: Item[];
  markRead: (id: number) => Promise<ContentActionState>;
  markAll: () => Promise<ContentActionState>;
}) {
  const [, start] = useTransition();
  const [list, setRead] = useOptimistic(items, (current, id: number | "all") =>
    current.map((item) => (id === "all" || item.id === id ? { ...item, read: true } : item)),
  );
  const unread = list.filter((i) => !i.read).length;

  return (
    <div className="space-y-4">
      {unread > 0 && (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              start(async () => {
                setRead("all");
                const result = await markAll();
                if (result.error) toast(result.error, { tone: "error" });
              })
            }
          >
            <CheckCheck aria-hidden="true" />
            Mark all as read
          </Button>
        </div>
      )}
      <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-xs">
        {list.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              onClick={() => {
                if (item.read) return;
                start(async () => {
                  setRead(item.id);
                  await markRead(item.id);
                });
              }}
              className={`flex gap-3 px-4 py-3 hover:bg-brand-50/50 ${item.read ? "" : "bg-accent-100/30"}`}
            >
              <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${item.read ? "bg-transparent" : "bg-accent-500"}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted">
                  {[item.workspaceName, item.label, item.when].filter(Boolean).join(" · ")}
                </span>
                <span className={`block text-sm ${item.read ? "text-ink" : "font-medium text-brand-900"}`}>{item.message}</span>
              </span>
              {!item.read && <span className="sr-only">Unread</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
