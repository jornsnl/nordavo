import type { ReactNode } from "react";
import { CircleCheck, CircleX, ExternalLink, Link2, Mail, Phone } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { ContactStatusBadge, EmailStatusBadge, TierBadge } from "@/components/leads/badges";
import { PushToCrmButton } from "@/components/leads/lead-forms";
import type { FormAction } from "@/components/leads/action-modal";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { CompanyContact, Contactability } from "@/lib/data/gtm-contacts";
import { formatDate } from "@/lib/format";

/** Assumption: OnePageCRM web app URL for a contact. Check with a real account. */
export function onePageContactUrl(id: string) {
  return `https://app.onepagecrm.com/contact/${encodeURIComponent(id)}`;
}

function linkedinHref(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function ChannelState({ label, state }: { label: string; state: Contactability }) {
  return (
    <li className="flex items-start gap-1.5">
      {state.ok ? (
        <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
      ) : (
        <CircleX className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden="true" />
      )}
      <span>
        <span className="font-medium text-ink">{label}:</span>{" "}
        {state.ok ? "reachable" : (state.reason ?? "not reachable")}
      </span>
    </li>
  );
}

export function ContactsPanel({
  contacts,
  crmActionFor,
  crmBlockedReason,
  actions,
}: {
  contacts: CompanyContact[];
  crmActionFor: (contactId: string) => FormAction;
  crmBlockedReason: string | null;
  /** Header buttons, e.g. "Add contact". */
  actions?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title="Contacts"
        description={
          contacts.length === 0
            ? "Decision makers come in through S3 or an import."
            : `${contacts.length} ${contacts.length === 1 ? "decision maker" : "decision makers"}, the goal is 2 per company.`
        }
        actions={actions}
      />
      {contacts.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">No contacts at this company yet.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {contacts.map((c) => (
            <li key={c.id} className="space-y-3 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                    {c.name}
                    <TierBadge tier={c.tier} />
                  </p>
                  {c.title && <p className="text-sm text-muted">{c.title}</p>}
                </div>
                <ContactStatusBadge status={c.status} />
              </div>

              <dl className="space-y-1.5 text-sm">
                {c.linkedinUrl && (
                  <div className="flex items-center gap-1.5">
                    <dt className="sr-only">LinkedIn</dt>
                    <Link2 className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                    <dd className="min-w-0">
                      <a
                        href={linkedinHref(c.linkedinUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-brand-700 hover:underline"
                      >
                        {c.linkedinUrl.replace(/^linkedin\.com/, "")}
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    </dd>
                  </div>
                )}
                <div className="flex items-start gap-1.5">
                  <dt className="sr-only">Email</dt>
                  <Mail className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden="true" />
                  <dd className="min-w-0 space-y-0.5">
                    {c.email ? (
                      <>
                        <span className="flex flex-wrap items-center gap-2">
                          <a href={`mailto:${c.email}`} className="break-all text-brand-700 hover:underline">
                            {c.email}
                          </a>
                          <EmailStatusBadge status={c.emailStatus} />
                        </span>
                        <span className="block text-xs text-muted">
                          Source {c.emailSource ?? "unknown"}, {formatDate(c.emailFoundAt, "date unknown")}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">No email address</span>
                    )}
                  </dd>
                </div>
                <div className="flex items-start gap-1.5">
                  <dt className="sr-only">Phone</dt>
                  <Phone className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden="true" />
                  <dd className="min-w-0 space-y-0.5">
                    {c.phone ? (
                      <>
                        <span className="flex flex-wrap items-center gap-2">
                          <a href={`tel:${c.phone}`} className="text-brand-700 hover:underline">
                            {c.phone}
                          </a>
                          {c.phoneType && (
                            <Badge tone={c.phoneType === "mobiel" ? "brand" : "neutral"}>
                              {c.phoneType === "mobiel" ? "Mobile" : "Landline"}
                            </Badge>
                          )}
                        </span>
                        <span className="block text-xs text-muted">
                          Source {c.phoneSource ?? "unknown"}, {formatDate(c.phoneFoundAt, "date unknown")}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">No phone number</span>
                    )}
                  </dd>
                </div>
              </dl>

              {/* Phones: call or mail straight from the list, with big buttons. */}
              {(c.phone || c.email) && (
                <div className="flex gap-2 md:hidden">
                  {c.phone && (
                    <a
                      href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}
                      className={buttonClasses({ variant: c.bellen.ok ? "primary" : "secondary", className: "flex-1" })}
                      aria-label={`Call ${c.name}`}
                    >
                      <Phone aria-hidden="true" />
                      Call
                    </a>
                  )}
                  {c.email && (
                    <a
                      href={`mailto:${c.email}`}
                      className={buttonClasses({ variant: "secondary", className: "flex-1" })}
                      aria-label={`Email ${c.name}`}
                    >
                      <Mail aria-hidden="true" />
                      Email
                    </a>
                  )}
                </div>
              )}

              <ul className="space-y-1 rounded-xl bg-surface/70 px-3 py-2 text-xs text-muted" aria-label="Reachable now">
                <ChannelState label="Call" state={c.bellen} />
                <ChannelState label="Mail" state={c.mail} />
              </ul>

              <div className="flex flex-wrap items-center gap-2">
                {c.onepageId ? (
                  <a
                    href={onePageContactUrl(c.onepageId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
                  >
                    In OnePageCRM
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : (
                  <PushToCrmButton
                    contactName={c.name}
                    action={crmActionFor(c.id)}
                    blockedReason={crmBlockedReason}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
