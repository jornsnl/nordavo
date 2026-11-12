"use client";

import { Combine } from "lucide-react";
import { CompanyPicker } from "@/components/sales/company-picker";
import { Field, Select } from "@/components/ui/field";
import type { CompanyOption } from "@/lib/data/sequences";
import { ActionModal, type FormAction } from "./action-modal";

type Duplicate = { id: string; name: string; domain: string; reason: string };

/**
 * "Merge" on a lead: pick the other company (a possible duplicate or any
 * company by name); it is merged into this one and deleted. Nothing is lost
 * (sales_merge_companies).
 */
export function MergeCompanyButton({
  companyName,
  duplicates,
  search,
  action,
}: {
  companyName: string;
  duplicates: Duplicate[];
  search: (query: string) => Promise<CompanyOption[]>;
  action: FormAction;
}) {
  return (
    <ActionModal
      label="Merge"
      icon={Combine}
      title={`Merge another company into ${companyName}`}
      description={`${companyName} stays. Contacts, activities, vacancies, meetings, sequences, notes, tasks and files of the other company move here, its empty fields fill in the gaps, its domain is kept so it is not added again, and then it is deleted. Its old record stays in the timeline.`}
      action={action}
      submitLabel="Merge"
      pendingLabel="Merging"
      modalSize="lg"
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            {duplicates.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-ink">Possible duplicates</legend>
                {duplicates.map((d) => (
                  <label key={d.id} className="flex items-start gap-2 text-sm">
                    <input type="radio" name="merge_id" value={d.id} className="mt-0.5 size-4" />
                    <span>
                      <span className="font-medium text-ink">{d.name}</span>{" "}
                      <span className="text-muted">
                        {d.domain.startsWith("nodomain:") ? "no website" : d.domain}, {d.reason}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <CompanyPicker search={search} name="merge_id" multiple={false} label={duplicates.length ? "Or search another company" : "Company to merge into this one"} />
            {e.merge_id && <p className="text-sm text-danger">{e.merge_id}</p>}
            <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <input type="checkbox" name="confirm" className="mt-0.5 size-4" />
              <span>Yes, these are the same company. Merge the other one into {companyName} and delete it.</span>
            </label>
            {e.confirm && <p className="text-sm text-danger">{e.confirm}</p>}
          </>
        );
      }}
    </ActionModal>
  );
}

/** "Merge contacts" on a lead: two records of the same person become one (sales_merge_contacts). */
export function MergeContactsButton({ contacts, action }: { contacts: { id: string; name: string }[]; action: FormAction }) {
  if (contacts.length < 2) return null;
  return (
    <ActionModal
      label="Merge"
      icon={Combine}
      ariaLabel="Merge two contacts"
      title="Merge two contacts"
      description="For the same person twice, for example once with an Apify link and once with a normal LinkedIn link. The duplicate's calls, mails, meetings and sequences move to the contact that stays, empty fields fill in the gaps (both LinkedIn links are kept), and the duplicate is deleted. Its old record stays in the timeline."
      action={action}
      submitLabel="Merge contacts"
      pendingLabel="Merging"
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Contact that stays" htmlFor="keep_id" error={e.keep_id}>
              <Select id="keep_id" name="keep_id" defaultValue={contacts[0].id}>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Duplicate to merge into it" htmlFor="merge_id" error={e.merge_id}>
              <Select id="merge_id" name="merge_id" defaultValue={contacts[1].id}>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        );
      }}
    </ActionModal>
  );
}
