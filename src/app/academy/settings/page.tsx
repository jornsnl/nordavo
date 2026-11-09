import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAcademyUser } from "@/lib/academy/auth";
import { t } from "@/lib/academy/i18n";
import { AcademySettingsForm } from "@/components/academy/settings-form";
import { Panel } from "@/components/academy/ui";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <Suspense fallback={<ListSkeleton rows={3} />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  const user = await requireAcademyUser();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight text-academy-blue-900">{t(user.locale, "settings.title")}</h1>
      <Panel>
        <AcademySettingsForm
          locale={user.locale}
          timeZone={user.timeZone}
          digest={user.member?.digest_frequency ?? "weekly"}
          disabled={!user.member}
        />
      </Panel>
    </div>
  );
}
