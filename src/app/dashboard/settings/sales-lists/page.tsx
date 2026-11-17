import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { ChoiceListEditor } from "@/components/settings/choice-list-editor";
import { CheatsheetEditor } from "@/components/settings/cheatsheet-editor";
import { loadCheatsheet } from "@/lib/sales/cheatsheet-data";
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
  const db = await createClient();
  const [lists, cheatsheet] = await Promise.all([loadChoiceLists(db), loadCheatsheet(db)]);
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted">
        The choice lists of Sales: Leads, Contacts, Pipeline, the call lists, the call screen and the lead page all use them.
        Rename an option, explain it, change the order or hide it. Prio, category and the rejection reasons can get extra options; the statuses
        and call outcomes drive the rules, so those keep their options. Pipeline stages and routes stay fixed. Own columns
        are under General, Fields. The call screen shows what you write in the explanation of a prio level next to the
        prio, so that is where you say what P1, P2 and P3 mean. Signal types: the first is the strongest.
      </p>
      {choiceListInfo.map((info) => (
        <Card key={info.key}>
          <CardHeader title={info.label} description={info.help} />
          <CardBody>
            <ChoiceListEditor list={info.key} extra={info.extra} options={lists[info.key]} />
          </CardBody>
        </Card>
      ))}
      <Card>
        <CardHeader
          title="Call cheat sheet"
          description="The foldable cheat sheet on the call screen, for the team and the external callers: USPs, price indication, starter fee, trade-off and the days for meetings. Text in [square brackets] still has to be filled in."
        />
        <CardBody>
          <CheatsheetEditor sections={cheatsheet} />
        </CardBody>
      </Card>
    </div>
  );
}
