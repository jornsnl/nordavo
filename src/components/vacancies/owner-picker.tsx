"use client";

import { useState } from "react";
import { Field, Select } from "@/components/ui/field";
import { TALENT_POOL_LABEL, type VacancyOwnerType } from "@/lib/talent/talent-pool";

type Option = { id: string; label: string };

/**
 * Who a vacancy is for: an existing client, a prospect from sales or, when
 * allowed, the talent pool (no client yet, no three-week clock). Posts
 * owner_type plus client_id or company_id.
 */
export function OwnerPicker({
  clients,
  companies,
  defaultOwnerType,
  defaultClientId,
  defaultCompanyId,
  allowTalentPool,
  errors,
  legend = "Who is this vacancy for",
}: {
  clients: Option[];
  companies: Option[];
  defaultOwnerType: VacancyOwnerType;
  defaultClientId?: string;
  defaultCompanyId?: string;
  allowTalentPool: boolean;
  errors: Record<string, string>;
  legend?: string;
}) {
  const [ownerType, setOwnerType] = useState<VacancyOwnerType>(
    defaultOwnerType === "talent_pool" && !allowTalentPool ? "client" : defaultOwnerType,
  );
  const invalid = (name: string) =>
    errors[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {};
  const choices: { value: VacancyOwnerType; label: string }[] = [
    { value: "client", label: "Existing client" },
    { value: "company", label: "Prospect from sales" },
    ...(allowTalentPool ? [{ value: "talent_pool" as const, label: TALENT_POOL_LABEL }] : []),
  ];

  return (
    <fieldset className="space-y-3 sm:col-span-2">
      <legend className="text-sm font-medium text-ink">
        {legend}
        <span className="ml-0.5 text-danger" aria-hidden="true">
          *
        </span>
      </legend>
      <div className="flex flex-wrap gap-4 text-sm">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className="inline-flex cursor-pointer items-center gap-2 pointer-coarse:min-h-11"
          >
            <input
              type="radio"
              name="owner_type"
              value={choice.value}
              checked={ownerType === choice.value}
              onChange={() => setOwnerType(choice.value)}
              className="size-4 accent-brand-700"
            />
            {choice.label}
          </label>
        ))}
      </div>
      {ownerType === "client" && (
        <Field label="Client" htmlFor="client_id" required error={errors.client_id}>
          <Select id="client_id" name="client_id" required defaultValue={defaultClientId ?? ""} {...invalid("client_id")}>
            <option value="" disabled>
              Choose a client
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {ownerType === "company" && (
        <Field
          label="Company"
          htmlFor="company_id"
          required
          error={errors.company_id}
          hint="GO prospects and active companies from sales. Company not listed? Open the vacancy from the lead."
        >
          <Select id="company_id" name="company_id" required defaultValue={defaultCompanyId ?? ""} {...invalid("company_id")}>
            <option value="" disabled>
              Choose a company
            </option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {ownerType === "talent_pool" && (
        <p className="rounded-xl border border-border bg-brand-50/50 px-3 py-2.5 text-sm text-muted">
          A talent pool vacancy has no client yet. There is no three-week clock and it does not count on the
          dashboard or in the report. Link it to a client later from the vacancy page; the clock starts then.
        </p>
      )}
    </fieldset>
  );
}
