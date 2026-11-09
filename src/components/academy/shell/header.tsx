import Link from "next/link";
import { Bell, LayoutDashboard, LogOut, Settings, ShieldCheck } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAcademyUser } from "@/lib/academy/auth";
import { countUnreadNotifications } from "@/lib/academy/data";
import { t } from "@/lib/academy/i18n";
import { LocaleSwitch } from "./locale-switch";

const iconLink =
  "flex size-9 items-center justify-center rounded-lg text-academy-blue-800 transition hover:bg-academy-blue-100 focus-visible:outline-2 focus-visible:outline-academy-orange-600 pointer-coarse:size-11";

/** The right side of the Academy header: language, notifications, settings, sign out. */
export async function AcademyHeaderMenu() {
  const user = await requireAcademyUser();
  const unread = user.member ? await countUnreadNotifications() : 0;
  const tr = (key: Parameters<typeof t>[1]) => t(user.locale, key);
  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      <LocaleSwitch locale={user.locale} label={tr("shell.language")} disabled={!user.member} />
      {user.role === "client" && (
        <Link href="/portal" className={`${iconLink} max-sm:hidden w-auto px-2.5 text-sm font-medium`}>
          {tr("shell.backToPortal")}
        </Link>
      )}
      {user.isManager && (
        <Link href="/dashboard/academy" className={iconLink} aria-label={tr("shell.backToDashboard")} title={tr("shell.backToDashboard")}>
          <LayoutDashboard className="size-[18px]" aria-hidden="true" />
        </Link>
      )}
      <span className={`${iconLink} relative`} title={tr("shell.notifications")} aria-label={`${tr("shell.notifications")}: ${unread}`}>
        <Bell className="size-[18px]" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-academy-orange-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </span>
      <Link href="/academy/settings" className={iconLink} aria-label={tr("shell.settings")} title={tr("shell.settings")}>
        <Settings className="size-[18px]" aria-hidden="true" />
      </Link>
      <Link href="/academy/security" className={`${iconLink} max-sm:hidden`} aria-label={tr("shell.security")} title={tr("shell.security")}>
        <ShieldCheck className="size-[18px]" aria-hidden="true" />
      </Link>
      <span className="hidden md:block">
        <Avatar name={user.name} size="sm" />
      </span>
      <form action="/auth/signout" method="post">
        <button type="submit" className={iconLink} aria-label={tr("shell.signOut")} title={tr("shell.signOut")}>
          <LogOut className="size-[18px]" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

export function AcademyHeaderMenuSkeleton() {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="size-8" />
    </div>
  );
}

export function AcademyBrand() {
  return (
    <Link href="/academy" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-academy-orange-600">
      <LogoMark className="size-8" />
      <span className="font-display text-base font-bold tracking-tight text-academy-blue-900">
        <span className="max-sm:hidden">Nordavo </span>
        <span className="text-academy-orange-600">Academy</span>
      </span>
    </Link>
  );
}
