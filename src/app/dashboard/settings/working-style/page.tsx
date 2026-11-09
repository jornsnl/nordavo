import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { WspSettingsForm } from "@/components/wsp/settings-form";
import { requireAdmin } from "@/lib/auth";
import { applicationStages, exitStages } from "@/lib/labels";
import { getWspSettings } from "@/lib/wsp/data";
import { formatWspDate } from "@/lib/wsp/text";

export const metadata: Metadata = { title: "Working style profile settings" };

/** System settings of the Working Style Profile (admins only). docs/working-style-profile.md */
export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Admin" title="Settings" description="Your own account and, as an admin, who has access to the portal." />
      <SettingsTabs active="working-style" isAdmin />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <SettingsCard />
      </Suspense>
    </>
  );
}

async function SettingsCard() {
  await requireAdmin();
  const settings = await getWspSettings();
  if (!settings) return <p className="text-sm text-muted">The settings could not be loaded.</p>;
  const stages = [
    { value: "shortlist", label: "Shortlist (the shortlist mark on the board)" },
    ...applicationStages
      .filter((s) => !(exitStages as readonly string[]).includes(s.value))
      .map((s) => ({ value: s.value, label: s.label })),
  ];
  return (
    <Card>
      <CardHeader
        title="Working style profile"
        description={`Big Five questionnaire for candidates and developers (nordavo-wsp-v1). The person setting wins over the vacancy, the vacancy over these settings. Last changed ${formatWspDate(settings.updated_at)}.`}
      />
      <CardBody>
        <WspSettingsForm settings={settings} stages={stages} />
      </CardBody>
    </Card>
  );
}
