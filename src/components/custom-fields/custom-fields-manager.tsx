"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  createCustomField,
  deleteCustomField,
  moveCustomField,
  resetRecordLayout,
  saveRecordLayout,
  setCustomFieldArchived,
  updateCustomField,
} from "@/lib/custom-fields/actions";
import {
  customFieldEntities,
  isChoiceType,
  typeLabel,
  type CustomFieldDefinition,
  type CustomFieldEntity,
} from "@/lib/custom-fields";
import {
  addBlock,
  fieldBlocks,
  isLayoutEntity,
  moveBlock,
  moveCoreField,
  removeBlock,
  resolveLayout,
  toStored,
  updateBlock,
  updateCoreField,
  type LayoutEntity,
  type ResolvedBlock,
  type ResolvedLayout,
  type StoredLayout,
} from "@/lib/custom-fields/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { DefinitionForm } from "./definition-form";

type Message = { error?: string; success?: string };

/**
 * Settings > Fields. Per record type: the page layout (blocks with name,
 * order, column, tab, hidden; fixed fields renamed, hidden, moved; blocks
 * of your own) and the custom fields in their blocks, with add, edit,
 * order, archive and (admins) delete.
 */
export function CustomFieldsManager({
  definitions,
  isAdmin,
  layouts = {},
}: {
  definitions: CustomFieldDefinition[];
  isAdmin: boolean;
  /** Stored layouts per record type; missing means the default. */
  layouts?: Partial<Record<LayoutEntity, StoredLayout>>;
}) {
  const router = useRouter();
  const [entity, setEntity] = useState<CustomFieldEntity>("candidate");
  const [stored, setStored] = useState(layouts);
  const [seen, setSeen] = useState(layouts);
  if (seen !== layouts) {
    setSeen(layouts);
    setStored(layouts);
  }
  const [adding, setAdding] = useState<{ entity: CustomFieldEntity; blockKey?: string } | null>(null);
  const [editing, setEditing] = useState<CustomFieldDefinition | null>(null);
  const [message, setMessage] = useState<Message>({});
  const [pending, startTransition] = useTransition();

  const resolved = useMemo(() => {
    const out: Partial<Record<LayoutEntity, ResolvedLayout>> = {};
    for (const e of customFieldEntities) {
      if (isLayoutEntity(e.value)) out[e.value] = resolveLayout(e.value, stored[e.value], definitions.filter((d) => d.entity === e.value));
    }
    return out;
  }, [stored, definitions]);

  const blocksByEntity = useMemo(() => {
    const out: Partial<Record<CustomFieldEntity, { key: string; label: string }[]>> = {};
    for (const [key, layout] of Object.entries(resolved)) if (layout) out[key as LayoutEntity] = fieldBlocks(layout);
    return out;
  }, [resolved]);

  const done = useCallback(() => {
    setAdding(null);
    setEditing(null);
    router.refresh();
  }, [router]);

  function run(action: () => Promise<{ error?: string; message?: string; ok?: boolean }>) {
    startTransition(async () => {
      const result = await action();
      setMessage({ error: result.error, success: result.error ? undefined : result.message });
      router.refresh();
    });
  }

  /** Apply a change to a layout: shown at once, saved in the background. */
  function changeLayout(e: LayoutEntity, next: ResolvedLayout) {
    const nextStored = toStored(next);
    const before = stored[e];
    setStored((s) => ({ ...s, [e]: nextStored }));
    startTransition(async () => {
      const result = await saveRecordLayout(e, nextStored);
      if (result.error) setStored((s) => ({ ...s, [e]: before }));
      setMessage({ error: result.error, success: result.error ? undefined : result.message });
      router.refresh();
    });
  }

  const fields = definitions.filter((d) => d.entity === entity);
  const archived = fields.filter((d) => d.archivedAt);
  const layout = isLayoutEntity(entity) ? resolved[entity] : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm text-muted">
          Set up each record page: rename, hide and move blocks and fields, add blocks of your own and put custom fields in them.
          Everyone in the team can change this. Archiving, deleting fields and resetting a layout is for admins.
        </p>
        <Button onClick={() => setAdding({ entity })} className="shrink-0">
          <Plus aria-hidden="true" />
          Add field
        </Button>
      </div>

      <div role="tablist" aria-label="Record type" className="flex flex-wrap gap-1.5">
        {customFieldEntities.map((e) => (
          <button
            key={e.value}
            type="button"
            role="tab"
            aria-selected={entity === e.value}
            onClick={() => setEntity(e.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition pointer-coarse:min-h-10 ${
              entity === e.value ? "bg-brand-700 text-white" : "bg-surface text-ink hover:bg-brand-50"
            }`}
          >
            {e.plural}
          </button>
        ))}
      </div>

      <FormMessage error={message.error} success={message.success} />

      {layout && isLayoutEntity(entity) ? (
        <LayoutEditor
          key={entity}
          entity={entity}
          layout={layout}
          isAdmin={isAdmin}
          pending={pending}
          onChange={(next) => changeLayout(entity, next)}
          onReset={() => run(() => resetRecordLayout(entity))}
          onAddField={(blockKey) => setAdding({ entity, blockKey })}
          onEditField={setEditing}
          onMoveField={(id, dir) => run(() => moveCustomField(id, dir))}
          onArchiveField={(id) => run(() => setCustomFieldArchived(id, true))}
        />
      ) : (
        <section aria-label="Fields" className="rounded-xl border border-border">
          <FieldList
            fields={fields.filter((d) => !d.archivedAt)}
            isAdmin={isAdmin}
            pending={pending}
            onEdit={setEditing}
            onMove={(id, dir) => run(() => moveCustomField(id, dir))}
            onArchive={(id) => run(() => setCustomFieldArchived(id, true))}
            empty="No fields yet."
          />
        </section>
      )}

      {archived.length > 0 && (
        <section aria-labelledby="cf-archived" className="rounded-xl border border-border">
          <h3 id="cf-archived" className="border-b border-border px-4 py-2.5 font-display text-sm font-semibold text-brand-900">
            Archived fields
          </h3>
          <ul className="divide-y divide-border">
            {archived.map((field) => (
              <li key={field.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted line-through">{field.label}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <Badge>{typeLabel(field.fieldType)}</Badge>
                    <Badge tone="warning">Archived</Badge>
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setCustomFieldArchived(field.id, false))}>
                      <ArchiveRestore aria-hidden="true" />
                      Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(`Delete "${field.label}" for good? Its values on every record are removed too. This cannot be undone.`)) {
                          run(() => deleteCustomField(field.id));
                        }
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal
        open={!!adding}
        onClose={() => setAdding(null)}
        title="Add a field"
        description={adding ? `For every ${customFieldEntities.find((e) => e.value === adding.entity)?.label.toLowerCase() ?? "record"}.` : undefined}
      >
        {adding && (
          <DefinitionForm
            action={createCustomField}
            entity={adding.entity}
            blockKey={adding.blockKey}
            blocksByEntity={blocksByEntity}
            existingFields={definitions}
            onDone={done}
          />
        )}
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit field" description={editing?.label}>
        {editing && (
          <DefinitionForm
            key={editing.id}
            action={updateCustomField.bind(null, editing.id)}
            field={editing}
            blocks={blocksByEntity[editing.entity]}
            existingFields={definitions}
            onDone={done}
          />
        )}
      </Modal>
    </div>
  );
}

function LayoutEditor({
  entity,
  layout,
  isAdmin,
  pending,
  onChange,
  onReset,
  onAddField,
  onEditField,
  onMoveField,
  onArchiveField,
}: {
  entity: LayoutEntity;
  layout: ResolvedLayout;
  isAdmin: boolean;
  pending: boolean;
  onChange: (next: ResolvedLayout) => void;
  onReset: () => void;
  onAddField: (blockKey: string) => void;
  onEditField: (field: CustomFieldDefinition) => void;
  onMoveField: (id: string, direction: "up" | "down") => void;
  onArchiveField: (id: string) => void;
}) {
  const [newBlock, setNewBlock] = useState("");
  const tabLabel = (key: string | null) => layout.tabs.find((t) => t.key === key)?.label ?? key;

  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {layout.blocks.map((block, index) => (
          <li key={block.key}>
            <BlockRow
              block={block}
              layout={layout}
              first={index === 0}
              last={index === layout.blocks.length - 1}
              isAdmin={isAdmin}
              pending={pending}
              tabLabel={tabLabel}
              onChange={onChange}
              onAddField={onAddField}
              onEditField={onEditField}
              onMoveField={onMoveField}
              onArchiveField={onArchiveField}
            />
          </li>
        ))}
      </ol>

      <form
        className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-3 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newBlock.trim()) return;
          onChange(addBlock(layout, newBlock).layout);
          setNewBlock("");
        }}
      >
        <label htmlFor={`new-block-${entity}`} className="sr-only">
          Name of the new block
        </label>
        <Input
          id={`new-block-${entity}`}
          value={newBlock}
          onChange={(e) => setNewBlock(e.target.value)}
          maxLength={80}
          placeholder="New block, e.g. Contract details"
          className="sm:max-w-xs"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={pending || !newBlock.trim()}>
          <Plus aria-hidden="true" />
          Add block
        </Button>
        <span className="text-xs text-muted">A new block appears on the page once it has a field.</span>
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            className="sm:ml-auto"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Reset this page to the default layout? Blocks you added are removed; their fields move to Custom fields.")) {
                onReset();
              }
            }}
          >
            <RotateCcw aria-hidden="true" />
            Reset layout
          </Button>
        )}
      </form>
    </div>
  );
}

function BlockRow({
  block,
  layout,
  first,
  last,
  isAdmin,
  pending,
  tabLabel,
  onChange,
  onAddField,
  onEditField,
  onMoveField,
  onArchiveField,
}: {
  block: ResolvedBlock;
  layout: ResolvedLayout;
  first: boolean;
  last: boolean;
  isAdmin: boolean;
  pending: boolean;
  tabLabel: (key: string | null) => string | null;
  onChange: (next: ResolvedLayout) => void;
  onAddField: (blockKey: string) => void;
  onEditField: (field: CustomFieldDefinition) => void;
  onMoveField: (id: string, direction: "up" | "down") => void;
  onArchiveField: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const hasContent = block.holdsFields || block.coreFields.length > 0;

  return (
    <div className={`rounded-xl border border-border ${block.hidden ? "bg-surface/60" : "bg-card"}`}>
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button variant="ghost" size="sm" aria-label={`Move ${block.label} up`} disabled={pending || first} onClick={() => onChange(moveBlock(layout, block.key, "up"))}>
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" aria-label={`Move ${block.label} down`} disabled={pending || last} onClick={() => onChange(moveBlock(layout, block.key, "down"))}>
            <ArrowDown aria-hidden="true" />
          </Button>
          <div className="min-w-0">
            {renaming ? (
              <RenameInput
                value={block.label}
                placeholder={block.defaultLabel}
                onSave={(label) => {
                  setRenaming(false);
                  onChange(updateBlock(layout, block.key, { label }));
                }}
                onCancel={() => setRenaming(false)}
              />
            ) : (
              <p className={`truncate text-sm font-semibold ${block.hidden ? "text-muted line-through" : "text-brand-900"}`}>{block.label}</p>
            )}
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              {block.added && <Badge tone="brand">Your block</Badge>}
              {block.hidden && <Badge tone="warning">Hidden</Badge>}
              {block.label !== block.defaultLabel && !block.added && <span>was {block.defaultLabel}</span>}
              {block.note && <span>{block.note}</span>}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {layout.tabs.length > 0 && (
            <Select
              aria-label={`Tab of ${block.label}`}
              value={block.tab ?? ""}
              disabled={pending}
              onChange={(e) => onChange(updateBlock(layout, block.key, { tab: e.target.value }))}
              className="w-auto py-1 text-sm"
            >
              {layout.tabs.map((t) => (
                <option key={t.key} value={t.key}>
                  Tab: {tabLabel(t.key)}
                </option>
              ))}
            </Select>
          )}
          <Select
            aria-label={`Column of ${block.label}`}
            value={block.column}
            disabled={pending}
            onChange={(e) => onChange(updateBlock(layout, block.key, { column: e.target.value === "side" ? "side" : "main" }))}
            className="w-auto py-1 text-sm"
          >
            <option value="main">Main column</option>
            <option value="side">Side column</option>
          </Select>
          {block.renamable && (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setRenaming(true)}>
              <Pencil aria-hidden="true" />
              Rename
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => onChange(updateBlock(layout, block.key, { hidden: !block.hidden }))}>
            {block.hidden ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
            {block.hidden ? "Show" : "Hide"}
          </Button>
          {block.added && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                const note = block.customFields.length > 0 ? " Its fields move to Custom fields." : "";
                if (window.confirm(`Delete the block "${block.label}"?${note}`)) onChange(removeBlock(layout, block.key));
              }}
            >
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          )}
        </div>
      </div>

      {hasContent && (
        <div className="border-t border-border">
          {block.coreFields.length > 0 && (
            <ul className="divide-y divide-border">
              {block.coreFields.map((field, i) => (
                <CoreFieldRow
                  key={field.key}
                  label={field.label}
                  defaultLabel={field.defaultLabel}
                  hidden={field.hidden}
                  first={i === 0}
                  last={i === block.coreFields.length - 1}
                  pending={pending}
                  onMove={(dir) => onChange(moveCoreField(layout, block.key, field.key, dir))}
                  onChange={(change) => onChange(updateCoreField(layout, block.key, field.key, change))}
                />
              ))}
            </ul>
          )}
          {block.holdsFields && (
            <>
              <FieldList
                fields={block.customFields}
                isAdmin={isAdmin}
                pending={pending}
                onEdit={onEditField}
                onMove={onMoveField}
                onArchive={onArchiveField}
                empty="No fields in this block yet."
              />
              <div className="border-t border-border px-4 py-2">
                <Button variant="ghost" size="sm" onClick={() => onAddField(block.key)}>
                  <Plus aria-hidden="true" />
                  Add field to {block.label}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CoreFieldRow({
  label,
  defaultLabel,
  hidden,
  first,
  last,
  pending,
  onMove,
  onChange,
}: {
  label: string;
  defaultLabel: string;
  hidden: boolean;
  first: boolean;
  last: boolean;
  pending: boolean;
  onMove: (direction: "up" | "down") => void;
  onChange: (change: { label?: string; hidden?: boolean }) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <li className="flex flex-col gap-2 py-2 pr-4 pl-10 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {renaming ? (
          <RenameInput
            value={label}
            placeholder={defaultLabel}
            onSave={(next) => {
              setRenaming(false);
              onChange({ label: next });
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <p className={`text-sm ${hidden ? "text-muted line-through" : "text-ink"}`}>{label}</p>
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <Badge>Fixed field</Badge>
          {label !== defaultLabel && <span>was {defaultLabel}</span>}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" aria-label={`Move ${label} up`} disabled={pending || first} onClick={() => onMove("up")}>
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="sm" aria-label={`Move ${label} down`} disabled={pending || last} onClick={() => onMove("down")}>
          <ArrowDown aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setRenaming(true)}>
          <Pencil aria-hidden="true" />
          Rename
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => onChange({ hidden: !hidden })}>
          {hidden ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
          {hidden ? "Show" : "Hide"}
        </Button>
      </div>
    </li>
  );
}

function RenameInput({
  value,
  placeholder,
  onSave,
  onCancel,
}: {
  value: string;
  placeholder: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(text);
      }}
    >
      <Input
        aria-label="New name"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={80}
        placeholder={placeholder}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        className="w-56 py-1 text-sm"
      />
      <Button type="submit" size="sm">
        Save
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <span className="w-full text-xs text-muted">Leave it empty for the original name, {placeholder}.</span>
    </form>
  );
}

function FieldList({
  fields,
  isAdmin,
  pending,
  onEdit,
  onMove,
  onArchive,
  empty,
}: {
  fields: CustomFieldDefinition[];
  isAdmin: boolean;
  pending: boolean;
  onEdit: (field: CustomFieldDefinition) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onArchive: (id: string) => void;
  empty: string;
}) {
  if (fields.length === 0) return <p className="px-4 py-3 pl-10 text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {fields.map((field, index) => (
        <li key={field.id} className="flex flex-col gap-2 py-2.5 pr-4 pl-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{field.label}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <Badge tone="accent">Custom field</Badge>
              <Badge>{typeLabel(field.fieldType)}</Badge>
              {field.showInList && <Badge tone="brand">Column on the list</Badge>}
              {isChoiceType(field.fieldType) && <span className="truncate">{field.options.join(", ")}</span>}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" aria-label={`Move ${field.label} up`} disabled={pending || index <= 0} onClick={() => onMove(field.id, "up")}>
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Move ${field.label} down`}
              disabled={pending || index === fields.length - 1}
              onClick={() => onMove(field.id, "down")}
            >
              <ArrowDown aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onEdit(field)}>
              <Pencil aria-hidden="true" />
              Edit
            </Button>
            {isAdmin && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => onArchive(field.id)}>
                <Archive aria-hidden="true" />
                Archive
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
