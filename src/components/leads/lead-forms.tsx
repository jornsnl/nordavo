"use client";

import { useState } from "react";
import { Ban, Building2, Pencil, Plus, Send } from "lucide-react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import type { CompanyStatus, Segment } from "@/lib/database.types";
import { todayIso } from "@/lib/format";
import {
  activityChannels,
  activityOutcomes,
  companyStatuses,
  segments,
  suppressionReasons,
  suppressionScopes,
} from "@/lib/labels";
import { ActionModal, invalidProps, type FormAction } from "./action-modal";

type ContactOption = { id: string; name: string };

// ---------------------------------------------------------------------------
// Edit company basics
// ---------------------------------------------------------------------------

export type EditableCompany = {
  name: string;
  legalForm: string | null;
  employees: number | null;
  sector: string | null;
  city: string | null;
  segment: Segment | null;
  status: CompanyStatus;
  kvkNumber: string | null;
  linkedinUrl: string | null;
};

export function EditCompanyButton({ company, action }: { company: EditableCompany; action: FormAction }) {
  return (
    <ActionModal
      label="Edit"
      icon={Pencil}
      size="md"
      title="Edit company"
      description="The domain is the key of the company and cannot be changed here."
      action={action}
      modalSize="lg"
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            <Field label="Name" htmlFor="name" required error={e.name}>
              <Input id="name" name="name" required defaultValue={company.name} {...invalidProps(state, "name")} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Segment" htmlFor="segment" error={e.segment}>
                <Select id="segment" name="segment" defaultValue={company.segment ?? ""}>
                  <option value="">No segment</option>
                  {segments.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status" htmlFor="status" required error={e.status}>
                <Select id="status" name="status" defaultValue={company.status}>
                  {companyStatuses.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Legal form"
                htmlFor="legal_form"
                hint="An eenmanszaak or vof never goes on a call list."
                error={e.legal_form}
              >
                <Input
                  id="legal_form"
                  name="legal_form"
                  placeholder="For example bv"
                  defaultValue={company.legalForm ?? ""}
                  {...invalidProps(state, "legal_form")}
                />
              </Field>
              <Field label="Employees" htmlFor="employees" error={e.employees}>
                <Input
                  id="employees"
                  name="employees"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  defaultValue={company.employees ?? ""}
                  {...invalidProps(state, "employees")}
                />
              </Field>
              <Field label="Sector" htmlFor="sector" error={e.sector}>
                <Input id="sector" name="sector" defaultValue={company.sector ?? ""} {...invalidProps(state, "sector")} />
              </Field>
              <Field label="City" htmlFor="city" error={e.city}>
                <Input id="city" name="city" defaultValue={company.city ?? ""} {...invalidProps(state, "city")} />
              </Field>
              <Field label="KvK number" htmlFor="kvk_number" error={e.kvk_number}>
                <Input
                  id="kvk_number"
                  name="kvk_number"
                  inputMode="numeric"
                  maxLength={8}
                  defaultValue={company.kvkNumber ?? ""}
                  {...invalidProps(state, "kvk_number")}
                />
              </Field>
              <Field label="LinkedIn company page" htmlFor="linkedin_url" error={e.linkedin_url}>
                <Input
                  id="linkedin_url"
                  name="linkedin_url"
                  type="url"
                  defaultValue={company.linkedinUrl ?? ""}
                  {...invalidProps(state, "linkedin_url")}
                />
              </Field>
            </div>
          </>
        );
      }}
    </ActionModal>
  );
}

// ---------------------------------------------------------------------------
// Log an activity
// ---------------------------------------------------------------------------

export function LogActivityButton({ contacts, action }: { contacts: ContactOption[]; action: FormAction }) {
  return (
    <ActionModal
      label="Log activity"
      icon={Plus}
      title="Log activity"
      description="A call, email, LinkedIn message or meeting. This counts towards the 30 day rule."
      action={action}
      modalSize="lg"
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            <Field label="Contact" htmlFor="contact_id" error={e.contact_id}>
              <Select id="contact_id" name="contact_id" defaultValue={contacts[0]?.id ?? ""}>
                <option value="">The company, no specific contact</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Channel" htmlFor="channel" required error={e.channel}>
                <Select id="channel" name="channel" defaultValue="bellen">
                  {activityChannels.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Outcome" htmlFor="outcome" required error={e.outcome}>
                <Select id="outcome" name="outcome" defaultValue="bereikt">
                  {activityOutcomes.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Date" htmlFor="date" error={e.date}>
                <Input id="date" name="date" type="date" defaultValue={todayIso()} max={todayIso()} />
              </Field>
            </div>
            <Field label="Notes" htmlFor="notes" error={e.notes}>
              <Textarea id="notes" name="notes" rows={3} {...invalidProps(state, "notes")} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_180px]">
              <Field label="Next action" htmlFor="next_action" error={e.next_action}>
                <Input
                  id="next_action"
                  name="next_action"
                  placeholder="For example call back about profiles"
                  {...invalidProps(state, "next_action")}
                />
              </Field>
              <Field label="Next action date" htmlFor="next_action_date" error={e.next_action_date}>
                <Input
                  id="next_action_date"
                  name="next_action_date"
                  type="date"
                  min={todayIso()}
                  {...invalidProps(state, "next_action_date")}
                />
              </Field>
            </div>
          </>
        );
      }}
    </ActionModal>
  );
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

export function SuppressButton({
  contacts,
  action,
  defaultTarget = "company",
}: {
  contacts: ContactOption[];
  action: FormAction;
  defaultTarget?: string;
}) {
  return (
    <ActionModal
      label="Suppress"
      icon={Ban}
      title="Suppress"
      description="Whoever is suppressed no longer goes on a call list or into a mail campaign."
      action={action}
      submitLabel="Suppress"
      pendingLabel="Suppressing"
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            <Field label="Who" htmlFor="target" required error={e.target}>
              <Select id="target" name="target" defaultValue={defaultTarget}>
                <option value="company">The whole company, all contacts</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Reason" htmlFor="reason" required error={e.reason}>
                <Select id="reason" name="reason" defaultValue="bezwaar">
                  {suppressionReasons.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Channels" htmlFor="scope" required error={e.scope}>
                <Select id="scope" name="scope" defaultValue="alle_kanalen">
                  {suppressionScopes.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Explanation" htmlFor="suppress-notes" error={e.notes}>
              <Textarea id="suppress-notes" name="notes" rows={2} />
            </Field>
          </>
        );
      }}
    </ActionModal>
  );
}

// ---------------------------------------------------------------------------
// Link to a client
// ---------------------------------------------------------------------------

export function LinkClientButton({
  clients,
  defaultName,
  action,
}: {
  clients: { id: string; label: string }[];
  defaultName: string;
  action: FormAction;
}) {
  return (
    <ActionModal
      label="Became a client"
      icon={Building2}
      title="Link to a client"
      description="The company becomes a client and gets a client record for vacancies and placements."
      action={action}
      submitLabel="Link"
      pendingLabel="Linking"
    >
      {(state) => <LinkClientFields clients={clients} defaultName={defaultName} errors={state.fieldErrors ?? {}} />}
    </ActionModal>
  );
}

function LinkClientFields({
  clients,
  defaultName,
  errors,
}: {
  clients: { id: string; label: string }[];
  defaultName: string;
  errors: Record<string, string>;
}) {
  const match = clients.find((c) => c.label.trim().toLowerCase() === defaultName.trim().toLowerCase());
  const [mode, setMode] = useState<"new" | "existing">(match ? "existing" : "new");
  return (
    <>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">Client</legend>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="radio"
            name="mode"
            value="new"
            checked={mode === "new"}
            onChange={() => setMode("new")}
            className="size-4 accent-brand-700"
          />
          Create new client
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="radio"
            name="mode"
            value="existing"
            checked={mode === "existing"}
            onChange={() => setMode("existing")}
            disabled={clients.length === 0}
            className="size-4 accent-brand-700"
          />
          Choose existing client
        </label>
      </fieldset>
      {mode === "new" ? (
        <Field label="Client name" htmlFor="client-name" required error={errors.name}>
          <Input id="client-name" name="name" required defaultValue={defaultName} />
        </Field>
      ) : (
        <Field label="Existing client" htmlFor="client-id" required error={errors.client_id}>
          <Select id="client-id" name="client_id" defaultValue={match?.id ?? ""}>
            <option value="" disabled>
              Pick a client
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </>
  );
}
