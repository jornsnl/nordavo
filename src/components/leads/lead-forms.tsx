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
      label="Bewerken"
      icon={Pencil}
      size="md"
      title="Bedrijf bewerken"
      description="Het domein is de sleutel van het bedrijf en kun je hier niet wijzigen."
      action={action}
      modalSize="lg"
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            <Field label="Naam" htmlFor="name" required error={e.name}>
              <Input id="name" name="name" required defaultValue={company.name} {...invalidProps(state, "name")} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Segment" htmlFor="segment" error={e.segment}>
                <Select id="segment" name="segment" defaultValue={company.segment ?? ""}>
                  <option value="">Geen segment</option>
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
                label="Rechtsvorm"
                htmlFor="legal_form"
                hint="Eenmanszaak en vof komen nooit op een bellijst."
                error={e.legal_form}
              >
                <Input
                  id="legal_form"
                  name="legal_form"
                  placeholder="Bijvoorbeeld bv"
                  defaultValue={company.legalForm ?? ""}
                  {...invalidProps(state, "legal_form")}
                />
              </Field>
              <Field label="Medewerkers" htmlFor="employees" error={e.employees}>
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
              <Field label="Plaats" htmlFor="city" error={e.city}>
                <Input id="city" name="city" defaultValue={company.city ?? ""} {...invalidProps(state, "city")} />
              </Field>
              <Field label="KvK-nummer" htmlFor="kvk_number" error={e.kvk_number}>
                <Input
                  id="kvk_number"
                  name="kvk_number"
                  inputMode="numeric"
                  maxLength={8}
                  defaultValue={company.kvkNumber ?? ""}
                  {...invalidProps(state, "kvk_number")}
                />
              </Field>
              <Field label="LinkedIn bedrijfspagina" htmlFor="linkedin_url" error={e.linkedin_url}>
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
      label="Activiteit vastleggen"
      icon={Plus}
      title="Activiteit vastleggen"
      description="Een belletje, mail, LinkedIn bericht of meeting. Dit telt mee voor de 30 dagen regel."
      action={action}
      modalSize="lg"
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            <Field label="Contact" htmlFor="contact_id" error={e.contact_id}>
              <Select id="contact_id" name="contact_id" defaultValue={contacts[0]?.id ?? ""}>
                <option value="">Het bedrijf, geen specifiek contact</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Kanaal" htmlFor="channel" required error={e.channel}>
                <Select id="channel" name="channel" defaultValue="bellen">
                  {activityChannels.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Uitkomst" htmlFor="outcome" required error={e.outcome}>
                <Select id="outcome" name="outcome" defaultValue="bereikt">
                  {activityOutcomes.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Datum" htmlFor="date" error={e.date}>
                <Input id="date" name="date" type="date" defaultValue={todayIso()} max={todayIso()} />
              </Field>
            </div>
            <Field label="Notities" htmlFor="notes" error={e.notes}>
              <Textarea id="notes" name="notes" rows={3} {...invalidProps(state, "notes")} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_180px]">
              <Field label="Volgende actie" htmlFor="next_action" error={e.next_action}>
                <Input
                  id="next_action"
                  name="next_action"
                  placeholder="Bijvoorbeeld terugbellen over profielen"
                  {...invalidProps(state, "next_action")}
                />
              </Field>
              <Field label="Datum volgende actie" htmlFor="next_action_date" error={e.next_action_date}>
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
      label="Uitsluiten"
      icon={Ban}
      title="Uitsluiten"
      description="Wie uitgesloten is, komt niet meer op een bellijst of in een mailcampagne."
      action={action}
      submitLabel="Uitsluiten"
      pendingLabel="Bezig met uitsluiten"
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            <Field label="Wie" htmlFor="target" required error={e.target}>
              <Select id="target" name="target" defaultValue={defaultTarget}>
                <option value="company">Het hele bedrijf, alle contacten</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Reden" htmlFor="reason" required error={e.reason}>
                <Select id="reason" name="reason" defaultValue="bezwaar">
                  {suppressionReasons.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Kanalen" htmlFor="scope" required error={e.scope}>
                <Select id="scope" name="scope" defaultValue="alle_kanalen">
                  {suppressionScopes.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Toelichting" htmlFor="suppress-notes" error={e.notes}>
              <Textarea id="suppress-notes" name="notes" rows={2} />
            </Field>
          </>
        );
      }}
    </ActionModal>
  );
}

// ---------------------------------------------------------------------------
// OnePageCRM
// ---------------------------------------------------------------------------

export function PushToCrmButton({
  contactName,
  action,
  blockedReason,
}: {
  contactName: string;
  action: FormAction;
  /** Shown instead of the form when the push cannot work (no OnePage, not qualified). */
  blockedReason: string | null;
}) {
  return (
    <ActionModal
      label="Naar CRM"
      icon={Send}
      ariaLabel={`${contactName} naar OnePageCRM`}
      title="Naar OnePageCRM"
      description={`${contactName} en het bedrijf komen in OnePageCRM, met een volgende actie.`}
      action={action}
      submitLabel="Naar CRM"
      pendingLabel="Bezig met versturen"
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            {blockedReason && !state.error && (
              <p className="rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {blockedReason}
              </p>
            )}
            <Field
              label="Reden"
              htmlFor="crm-reason"
              required
              hint="Bijvoorbeeld positieve reply of afspraak via Web Partners."
              error={e.reason}
            >
              <Input id="crm-reason" name="reason" required {...invalidProps(state, "reason", "crm-reason")} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_180px]">
              <Field label="Volgende actie" htmlFor="crm-next" error={e.next_action}>
                <Input id="crm-next" name="next_action" placeholder="Bijvoorbeeld intake plannen" />
              </Field>
              <Field label="Datum" htmlFor="crm-next-date" error={e.next_action_date}>
                <Input
                  id="crm-next-date"
                  name="next_action_date"
                  type="date"
                  min={todayIso()}
                  {...invalidProps(state, "next_action_date", "crm-next-date")}
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
      label="Klant geworden"
      icon={Building2}
      title="Koppelen aan een klant"
      description="Het bedrijf gaat op klant en krijgt een klantrecord voor vacatures en plaatsingen."
      action={action}
      submitLabel="Koppelen"
      pendingLabel="Bezig met koppelen"
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
        <legend className="text-sm font-medium text-ink">Klant</legend>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="radio"
            name="mode"
            value="new"
            checked={mode === "new"}
            onChange={() => setMode("new")}
            className="size-4 accent-brand-700"
          />
          Nieuwe klant aanmaken
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
          Bestaande klant kiezen
        </label>
      </fieldset>
      {mode === "new" ? (
        <Field label="Naam van de klant" htmlFor="client-name" required error={errors.name}>
          <Input id="client-name" name="name" required defaultValue={defaultName} />
        </Field>
      ) : (
        <Field label="Bestaande klant" htmlFor="client-id" required error={errors.client_id}>
          <Select id="client-id" name="client_id" defaultValue={match?.id ?? ""}>
            <option value="" disabled>
              Kies een klant
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
