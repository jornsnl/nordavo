"use client";

import { startTransition, useActionState, useState } from "react";
import { LoaderCircle, Mail, Pencil, Phone, Plus, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { ConfirmDeleteButton } from "./confirm-delete-button";

export type ContactItem = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  is_primary: boolean;
};

type SaveAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type DeleteAction = (
  contactId: string,
  prev: ActionState,
  formData: FormData,
) => Promise<ActionState>;

export function ContactsCard({
  contacts,
  saveAction,
  deleteAction,
}: {
  contacts: ContactItem[];
  saveAction: SaveAction;
  deleteAction: DeleteAction;
}) {
  // undefined: closed, null: new contact, otherwise the contact being edited.
  const [editing, setEditing] = useState<ContactItem | null | undefined>(undefined);

  return (
    <Card>
      <CardHeader
        title="Contactpersonen"
        description="Wie je bij deze klant spreekt."
        actions={
          <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
            <Plus aria-hidden="true" />
            Toevoegen
          </Button>
        }
      />
      {contacts.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">Nog geen contactpersonen. Voeg de eerste toe.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  {contact.full_name}
                  {contact.is_primary && (
                    <Badge tone="accent">
                      <Star className="size-3" aria-hidden="true" />
                      Eerste contact
                    </Badge>
                  )}
                </p>
                {contact.job_title && <p className="text-sm text-muted">{contact.job_title}</p>}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="inline-flex min-w-0 items-center gap-1.5 break-all text-brand-700 hover:underline"
                    >
                      <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                      {contact.email}
                    </a>
                  )}
                  {contact.phone && (
                    <a
                      href={`tel:${contact.phone.replace(/\s+/g, "")}`}
                      className="inline-flex items-center gap-1.5 text-brand-700 hover:underline"
                    >
                      <Phone className="size-3.5 shrink-0" aria-hidden="true" />
                      {contact.phone}
                    </a>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(contact)}
                  aria-label={`${contact.full_name} bewerken`}
                  title="Bewerken"
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <ConfirmDeleteButton
                  iconOnly
                  label={`${contact.full_name} verwijderen`}
                  title="Contactpersoon verwijderen"
                  description={`Weet je zeker dat je ${contact.full_name} wilt verwijderen? Dit kun je niet ongedaan maken.`}
                  action={deleteAction.bind(null, contact.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? "Contactpersoon bewerken" : "Nieuwe contactpersoon"}
      >
        {editing !== undefined && (
          <ContactForm
            key={editing?.id ?? "new"}
            contact={editing}
            saveAction={saveAction}
            onDone={() => setEditing(undefined)}
          />
        )}
      </Modal>
    </Card>
  );
}

function ContactForm({
  contact,
  saveAction,
  onDone,
}: {
  contact: ContactItem | null;
  saveAction: SaveAction;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await saveAction(prev, formData);
      if (result?.ok) onDone();
      return result ?? prev;
    },
    initialActionState,
  );
  const errors = state.fieldErrors ?? {};
  const invalid = (name: string) =>
    errors[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {};

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      {contact && <input type="hidden" name="contact_id" value={contact.id} />}
      <FormMessage error={state.error} />
      <Field label="Naam" htmlFor="contact-full_name" required error={errors.full_name}>
        <Input
          id="contact-full_name"
          name="full_name"
          required
          autoComplete="name"
          defaultValue={contact?.full_name}
          {...invalid("full_name")}
        />
      </Field>
      <Field label="Functie" htmlFor="contact-job_title" error={errors.job_title}>
        <Input
          id="contact-job_title"
          name="job_title"
          placeholder="Bijvoorbeeld CTO"
          defaultValue={contact?.job_title ?? ""}
          {...invalid("job_title")}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="E-mailadres" htmlFor="contact-email" error={errors.email}>
          <Input
            id="contact-email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={contact?.email ?? ""}
            {...invalid("email")}
          />
        </Field>
        <Field label="Telefoon" htmlFor="contact-phone" error={errors.phone}>
          <Input
            id="contact-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            defaultValue={contact?.phone ?? ""}
            {...invalid("phone")}
          />
        </Field>
      </div>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input
          type="checkbox"
          name="is_primary"
          defaultChecked={contact?.is_primary ?? false}
          className="mt-0.5 size-4 rounded border-border accent-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        />
        <span>
          Eerste contactpersoon
          <span className="block text-xs text-muted">
            Er is maar één eerste contact per klant. Een eventuele andere vervalt.
          </span>
        </span>
      </label>
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onDone}>
          Annuleren
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {pending ? "Bezig met opslaan" : "Opslaan"}
        </Button>
      </div>
    </form>
  );
}
