import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ClipboardList, LayoutDashboard, LogOut } from "lucide-react";
import { installableMetadata } from "@/lib/pwa/manifest";
import { isStaff } from "@/lib/auth";
import { initials } from "@/lib/format";
import { countUnreadNotifications, requireContentUser } from "@/lib/content/data";
import { ContentShell } from "@/components/content/content-shell";
import { ContentWorkspaceNav } from "@/components/content/workspace-nav";
import { WorkspaceNavSkeleton } from "@/components/work/workspace-nav";

export const metadata: Metadata = {
  ...installableMetadata,
  title: { default: "Content", template: "%s · Content" },
};

export default function ContentLayout({ children }: LayoutProps<"/content">) {
  return (
    <div lang="en">
      <ContentShell
        workspaces={
          <Suspense fallback={<WorkspaceNavSkeleton />}>
            <ContentWorkspaceNav />
          </Suspense>
        }
        unread={
          <Suspense fallback={null}>
            <UnreadBadge />
          </Suspense>
        }
        userMenu={
          <Suspense fallback={<div className="h-14 animate-pulse rounded-xl bg-white/5" />}>
            <ContentUserMenu />
          </Suspense>
        }
      >
        {children}
      </ContentShell>
    </div>
  );
}

async function UnreadBadge() {
  const unread = await countUnreadNotifications();
  if (unread === 0) return null;
  return (
    <span className="rounded-full bg-accent-500 px-1.5 text-[11px] font-semibold text-brand-900" aria-label={`${unread} unread`}>
      {unread > 99 ? "99+" : unread}
    </span>
  );
}

async function ContentUserMenu() {
  const user = await requireContentUser();
  return (
    <div className="space-y-2">
      <Link
        href="/work"
        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-brand-200/70 hover:bg-white/5 hover:text-white"
      >
        <ClipboardList className="size-4" aria-hidden="true" />
        Work
      </Link>
      {isStaff(user) && (
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-brand-200/70 hover:bg-white/5 hover:text-white"
        >
          <LayoutDashboard className="size-4" aria-hidden="true" />
          Nordavo portal
        </Link>
      )}
      <div className="flex items-center gap-3 rounded-xl bg-white/5 p-2.5">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-500 font-display text-sm font-bold text-brand-900"
        >
          {initials(user.name) || "C"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{user.name}</p>
          <p className="truncate text-xs text-brand-200/60">{user.isAdmin ? "Admin" : user.email}</p>
        </div>
        <form action="/auth/signout?next=/work/sign-in" method="post">
          <button
            type="submit"
            className="flex size-9 items-center justify-center rounded-lg text-brand-200/70 hover:bg-white/10 hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
  );
}
