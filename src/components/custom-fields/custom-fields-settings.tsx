import { Suspense } from "react";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { getStoredLayout, listCustomFieldDefinitions } from "@/lib/custom-fields/data";
import { layoutEntities } from "@/lib/custom-fields/layout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { CustomFieldsManager } from "./custom-fields-manager";

/** The "Fields" section of Settings. One line on the page: <CustomFieldsSettings /> */
export function CustomFieldsSettings() {
  return (
    <Suspense fallback={<ListSkeleton rows={3} />}>
      <Loaded />
    </Suspense>
  );
}

async function Loaded() {
  const user = await getCurrentUser();
  if (!isStaff(user)) return null;
  const [definitions, stored] = await Promise.all([
    listCustomFieldDefinitions({ includeArchived: true }),
    Promise.all(layoutEntities.map(async (e) => [e.value, await getStoredLayout(e.value)] as const)),
  ]);
  const layouts = Object.fromEntries(stored);
  return (
    <div id="custom-fields" className="scroll-mt-24">
      <Card>
        <CardHeader
          title="Fields"
          description="The blocks and fields of the candidate, vacancy, client and placement pages, and extra fields of your own, like extra columns in Airtable."
        />
        <CardBody className="py-5">
          <CustomFieldsManager definitions={definitions} isAdmin={user.role === "admin"} layouts={layouts} />
        </CardBody>
      </Card>
    </div>
  );
}
