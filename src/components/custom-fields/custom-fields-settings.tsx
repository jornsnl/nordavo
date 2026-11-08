import { Suspense } from "react";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { listCustomFieldDefinitions } from "@/lib/custom-fields/data";
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
  const definitions = await listCustomFieldDefinitions({ includeArchived: true });
  return (
    <div id="custom-fields" className="scroll-mt-24">
      <Card>
        <CardHeader
          title="Fields"
          description="Extra fields on candidates, vacancies and pipeline cards, like extra columns in Airtable."
        />
        <CardBody className="py-5">
          <CustomFieldsManager definitions={definitions} isAdmin={user.role === "admin"} />
        </CardBody>
      </Card>
    </div>
  );
}
