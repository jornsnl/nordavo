import { Suspense } from "react";
import { ListSkeleton } from "@/components/ui/skeleton";
import type { CustomFieldEntity } from "@/lib/custom-fields";
import { getCustomFieldValues, listCustomFieldDefinitions } from "@/lib/custom-fields/data";
import { CustomFieldsEditor } from "./custom-fields-editor";

/**
 * Custom fields of a candidate or vacancy, for its detail page. Loads by
 * itself inside its own Suspense boundary, so a page needs one line:
 * <CustomFieldsCard entity="candidate" recordId={id} />
 */
export function CustomFieldsCard({ entity, recordId }: { entity: CustomFieldEntity; recordId: string }) {
  return (
    <Suspense fallback={<ListSkeleton rows={2} />}>
      <Loaded entity={entity} recordId={recordId} />
    </Suspense>
  );
}

async function Loaded({ entity, recordId }: { entity: CustomFieldEntity; recordId: string }) {
  const [definitions, values] = await Promise.all([listCustomFieldDefinitions({ entity }), getCustomFieldValues(entity, recordId)]);
  if (values === null) return null;
  return <CustomFieldsEditor entity={entity} recordId={recordId} definitions={definitions} values={values} />;
}
