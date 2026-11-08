import Form from "next/form";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { TD, TH } from "@/components/ui/table";
import { filterParam, formatValue, sortParam, type CustomFieldDefinition } from "@/lib/custom-fields";
import type { CandidateListFields } from "@/lib/custom-fields/list";

/**
 * Custom field columns on the candidates list: a filter row, sortable
 * headers and cells. Renders nothing when no field is set to show in the list.
 */

function placeholderFor(def: CustomFieldDefinition) {
  if (def.fieldType === "number") return "e.g. >=20";
  if (def.fieldType === "date") return "e.g. >=2027-01-01";
  return "Contains";
}

export function CustomFieldFilters({ fields, basePath = "/dashboard/candidates" }: { fields: CandidateListFields; basePath?: string }) {
  if (fields.defs.length === 0) return null;
  const active = new Map(fields.filters.map((f) => [f.def.key, f.value]));
  return (
    <Form
      action={basePath}
      aria-label="Filter on custom fields"
      className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-3 shadow-xs"
    >
      {Object.entries(fields.keep).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      {fields.defs.map((def) => {
        const id = `cf-filter-${def.key}`;
        const value = active.get(def.key) ?? "";
        const choice = def.fieldType === "single_choice" || def.fieldType === "multi_choice" || def.fieldType === "boolean";
        return (
          <div key={def.id} className="min-w-36 flex-1 space-y-1 sm:max-w-56">
            <label htmlFor={id} className="block text-xs font-medium text-muted">
              {def.label}
            </label>
            {choice ? (
              <Select id={id} name={filterParam(def.key)} defaultValue={value} className="py-2">
                <option value="">Any</option>
                {(def.fieldType === "boolean" ? ["yes", "no"] : def.options).map((o) => (
                  <option key={o} value={o}>
                    {def.fieldType === "boolean" ? (o === "yes" ? "Yes" : "No") : o}
                  </option>
                ))}
                <option value="any">Filled in</option>
                <option value="none">Empty</option>
              </Select>
            ) : (
              <Input id={id} name={filterParam(def.key)} defaultValue={value} placeholder={placeholderFor(def)} className="py-2" />
            )}
          </div>
        );
      })}
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" size="sm">
          Apply
        </Button>
        {fields.filters.length > 0 && (
          <ButtonLink
            href={fields.href(Object.fromEntries(fields.filters.map((f) => [filterParam(f.def.key), undefined])))}
            variant="ghost"
            size="sm"
          >
            Clear fields
          </ButtonLink>
        )}
      </div>
    </Form>
  );
}

export function CustomFieldHeaders({ fields }: { fields: CandidateListFields }) {
  return fields.defs.map((def) => {
    const active = fields.sort?.def.key === def.key ? fields.sort.dir : null;
    // asc, then desc, then back to the list's own order.
    const next =
      active === null
        ? { sort: sortParam(def.key), dir: undefined }
        : active === "asc"
          ? { sort: sortParam(def.key), dir: "desc" }
          : { sort: undefined, dir: undefined };
    const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowUpDown;
    return (
      <TH key={def.id} aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : undefined}>
        <Link href={fields.href(next)} scroll={false} className="inline-flex items-center gap-1 hover:text-brand-700">
          {def.label}
          <Icon className="size-3.5" aria-hidden="true" />
          <span className="sr-only">, sort</span>
        </Link>
      </TH>
    );
  });
}

export function CustomFieldCells({ fields, id }: { fields: CandidateListFields; id: string }) {
  const values = fields.values.get(id) ?? {};
  return fields.defs.map((def) => {
    const text = formatValue(def, values[def.key]);
    return (
      <TD key={def.id} className={`max-w-48 truncate ${def.fieldType === "number" ? "text-right tabular-nums" : ""}`}>
        {text ? (
          def.fieldType === "single_choice" || def.fieldType === "boolean" ? <Badge>{text}</Badge> : text
        ) : (
          <span className="text-muted">None</span>
        )}
      </TD>
    );
  });
}

/** Compact "Label: value" line for the phone list. */
export function CustomFieldSummary({ fields, id }: { fields: CandidateListFields; id: string }) {
  const values = fields.values.get(id) ?? {};
  const parts = fields.defs
    .map((def) => ({ def, text: formatValue(def, values[def.key]) }))
    .filter((p) => p.text);
  if (parts.length === 0) return null;
  return (
    <p className="mt-1 truncate text-xs text-muted">
      {parts.map((p) => `${p.def.label}: ${p.text}`).join(" · ")}
    </p>
  );
}
