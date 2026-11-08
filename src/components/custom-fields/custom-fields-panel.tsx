"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { LoaderCircle } from "lucide-react";
import { loadCustomFields, type CustomFieldsBundle } from "@/lib/custom-fields/actions";
import type { CustomFieldEntity } from "@/lib/custom-fields";
import { CustomFieldsEditor } from "./custom-fields-editor";

/**
 * Self loading custom fields for use inside client components, such as the
 * pipeline card modal: <CustomFieldsPanel entity="application" recordId={card.id} />
 */
export function CustomFieldsPanel({ entity, recordId }: { entity: CustomFieldEntity; recordId: string }) {
  const [bundle, setBundle] = useState<CustomFieldsBundle | null | undefined>(undefined);
  const [, startLoading] = useTransition();

  const load = useCallback(() => {
    startLoading(async () => {
      try {
        setBundle(await loadCustomFields(entity, recordId));
      } catch {
        setBundle(null);
      }
    });
  }, [entity, recordId]);

  useEffect(() => {
    load();
  }, [load]);

  if (bundle === undefined) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        Loading custom fields
      </p>
    );
  }
  if (bundle === null) return null;
  return (
    <CustomFieldsEditor
      entity={entity}
      recordId={recordId}
      definitions={bundle.definitions}
      values={bundle.values}
      onFieldAdded={load}
      headingLevel="h3"
      framed={false}
    />
  );
}
