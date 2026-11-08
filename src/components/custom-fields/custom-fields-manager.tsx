"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { createCustomField, moveCustomField, setCustomFieldArchived, updateCustomField } from "@/lib/custom-fields/actions";
import {
  customFieldEntities,
  isChoiceType,
  typeLabel,
  type CustomFieldDefinition,
} from "@/lib/custom-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { DefinitionForm } from "./definition-form";

/** Settings > Fields: every custom field per record type, with add, edit, order and archive. */
export function CustomFieldsManager({ definitions, isAdmin }: { definitions: CustomFieldDefinition[]; isAdmin: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CustomFieldDefinition | null>(null);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [pending, startTransition] = useTransition();

  const done = useCallback(() => {
    setAdding(false);
    setEditing(null);
    router.refresh();
  }, [router]);

  function run(action: () => Promise<{ error?: string; message?: string }>) {
    startTransition(async () => {
      const result = await action();
      setMessage({ error: result.error, success: result.error ? undefined : result.message });
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm text-muted">
          Every team member can add and edit fields. Archiving and restoring is for admins: an archived field disappears from the
          pages, its values are kept.
        </p>
        <Button onClick={() => setAdding(true)} className="shrink-0">
          <Plus aria-hidden="true" />
          Add field
        </Button>
      </div>
      <FormMessage error={message.error} success={message.success} />

      {customFieldEntities.map((entity) => {
        const fields = definitions.filter((d) => d.entity === entity.value);
        const active = fields.filter((d) => !d.archivedAt);
        const archived = fields.filter((d) => d.archivedAt);
        return (
          <section key={entity.value} aria-labelledby={`cf-${entity.value}`} className="rounded-xl border border-border">
            <h3 id={`cf-${entity.value}`} className="border-b border-border px-4 py-2.5 font-display text-sm font-semibold text-brand-900">
              {entity.plural}
            </h3>
            {fields.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">No fields yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {[...active, ...archived].map((field) => {
                  const index = active.indexOf(field);
                  return (
                    <li key={field.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${field.archivedAt ? "text-muted line-through" : "text-ink"}`}>{field.label}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          <Badge>{typeLabel(field.fieldType)}</Badge>
                          {field.showInList && <Badge tone="brand">Column on the list</Badge>}
                          {field.archivedAt && <Badge tone="warning">Archived</Badge>}
                          {isChoiceType(field.fieldType) && <span className="truncate">{field.options.join(", ")}</span>}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1">
                        {!field.archivedAt && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Move ${field.label} up`}
                              disabled={pending || index <= 0}
                              onClick={() => run(() => moveCustomField(field.id, "up"))}
                            >
                              <ArrowUp aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Move ${field.label} down`}
                              disabled={pending || index === active.length - 1}
                              onClick={() => run(() => moveCustomField(field.id, "down"))}
                            >
                              <ArrowDown aria-hidden="true" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setEditing(field)}>
                              <Pencil aria-hidden="true" />
                              Edit
                            </Button>
                          </>
                        )}
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => run(() => setCustomFieldArchived(field.id, !field.archivedAt))}
                          >
                            {field.archivedAt ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                            {field.archivedAt ? "Restore" : "Archive"}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a field">
        {adding && <DefinitionForm action={createCustomField} onDone={done} />}
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit field" description={editing?.label}>
        {editing && <DefinitionForm key={editing.id} action={updateCustomField.bind(null, editing.id)} field={editing} onDone={done} />}
      </Modal>
    </div>
  );
}
