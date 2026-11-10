import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { NotificationPrefsForm } from "@/components/content/notifications/prefs-form";
import { listMyPrefs } from "@/lib/content/settings";
import { saveNotificationPrefsAction } from "@/app/content/actions/notifications";

export const metadata: Metadata = { title: "Settings" };

export default function ContentSettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Choose per notification whether you see it in the app, get it by email, or both. Your name and time zone are set in Work settings."
      />
      <Card className="max-w-3xl">
        <CardBody>
          <Suspense fallback={<ListSkeleton rows={8} />}>
            <Prefs />
          </Suspense>
        </CardBody>
      </Card>
    </>
  );
}

const groups = [
  { for: "reviewer", title: "As reviewer" },
  { for: "author", title: "As author" },
  { for: "everyone", title: "For everyone" },
] as const;

async function Prefs() {
  const prefs = await listMyPrefs();
  return (
    <NotificationPrefsForm
      action={saveNotificationPrefsAction}
      groups={groups.map((g) => ({
        title: g.title,
        prefs: prefs.filter((p) => p.for === g.for).map((p) => ({ kind: p.kind, label: p.label, inApp: p.inApp, email: p.email })),
      }))}
    />
  );
}
