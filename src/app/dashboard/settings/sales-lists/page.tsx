import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { ChoiceListEditor } from "@/components/settings/choice-list-editor";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/lib/auth";
import { choiceListInfo } from "@/lib/sales/choices";
import { loadChoiceLists } from "@/lib/sales/flow-data";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sales lists",
};

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Admin" title="Settings" description="Your own account and, as an admin, who has access to the portal." />
      <SettingsTabs active="sales-lists" isAdmin />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Lists />
      </Suspense>
    </>
  );
}

async function Lists() {
  await requireAdmin();
  const lists = await loadChoiceLists(await createClient());
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted">
        The choice lists of Sales: Leads, Contacts, Pipeline, the call lists, the call screen and the lead page all use them.
        Rename an option, explain it, change the order or hide it. Prio and category can get extra options; the statuses
        and call outcomes drive the rules, so those keep their options. Pipeline stages and routes stay fixed. Own columns
        are under General, Fields.
      </p>
      {choiceListInfo.map((info) => (
        <Card key={info.key}>
          <CardHeader title={info.label} description={info.help} />
          <CardBody>
            <ChoiceListEditor list={info.key} extra={info.extra} options={lists[info.key]} />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
