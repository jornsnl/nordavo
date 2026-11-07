"use client";

import { UserPlus } from "lucide-react";
import { Field, Input, Select } from "@/components/ui/field";
import { ActionModal, invalidProps, type FormAction } from "./action-modal";

// Same tiers as contactTiers in lib/labels, worded for this form.
const TIERS = [
  { value: "1", label: "Tier 1: CTO, Head of Engineering or Data" },
  { value: "2", label: "Tier 2: owner or director" },
  { value: "3", label: "Tier 3: recruiter or HR" },
];

/** "Add contact" on a lead: a decision maker entered by hand. */
export function AddContactButton({ companyName, action }: { companyName: string; action: FormAction }) {
  return (
    <ActionModal
      label="Add contact"
      icon={UserPlus}
      title="Add contact"
      description={`A person at ${companyName}. Fill in what you know; a first or last name is enough.`}
      action={action}
      submitLabel="Add contact"
      pendingLabel="Adding contact"
      cancelLabel="Cancel"
      modalSize="lg"
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="First name" htmlFor="first_name" error={e.first_name}>
                <Input
                  id="first_name"
                  name="first_name"
                  autoComplete="off"
                  autoCapitalize="words"
                  {...invalidProps(state, "first_name")}
                />
              </Field>
              <Field label="Last name" htmlFor="last_name" error={e.last_name}>
                <Input
                  id="last_name"
                  name="last_name"
                  autoComplete="off"
                  autoCapitalize="words"
                  {...invalidProps(state, "last_name")}
                />
              </Field>
              <Field label="Job title" htmlFor="title" error={e.title}>
                <Input id="title" name="title" placeholder="For example CTO" {...invalidProps(state, "title")} />
              </Field>
              <Field label="Tier" htmlFor="tier" error={e.tier}>
                <Select id="tier" name="tier" defaultValue="">
                  <option value="">No tier</option>
                  {TIERS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Email" htmlFor="email" error={e.email}>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  {...invalidProps(state, "email")}
                />
              </Field>
              <Field
                label="Phone"
                htmlFor="phone"
                hint="Only a mobile number puts the contact on a call list."
                error={e.phone}
              >
                <Input id="phone" name="phone" type="tel" autoComplete="off" {...invalidProps(state, "phone")} />
              </Field>
            </div>
            <Field label="LinkedIn profile" htmlFor="linkedin_url" error={e.linkedin_url}>
              <Input
                id="linkedin_url"
                name="linkedin_url"
                type="url"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="linkedin.com/in/jane-doe"
                {...invalidProps(state, "linkedin_url")}
              />
            </Field>
          </>
        );
      }}
    </ActionModal>
  );
}
