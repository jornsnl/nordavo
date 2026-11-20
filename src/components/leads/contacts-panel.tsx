import type { ReactNode } from "react";
import { CircleCheck, CircleX, Link2, Mail, Phone, TriangleAlert } from "lucide-react";
import { isLinkedinLinkBroken } from "@/lib/gtm/normalize";
import { buttonClasses } from "@/components/ui/button";
import { ContactStatusBadge, EmailStatusBadge, TierBadge } from "@/components/leads/badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { CompanyContact, Contactability } from "@/lib/data/gtm-contacts";
import { formatDate } from "@/lib/format";
import { contactOrderRule } from "@/lib/sales/labels";
import { UseDefaultOrderButton } from "@/components/leads/use-default-order-button";
import { deleteContactAction, setContactChannelsAction, updateContactAction } from "@/app/dashboard/leads/edit-actions";
import {
  ContactChannelsButton,
  contactFlagLabels,
  DeleteContactButton,
  EditContactButton,
} from "@/components/leads/lead-edit-controls";

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

const roleRank: Record<string, number> = { main: 0, reserve: 1, extra: 2 };

export function ContactsPanel({
  companyId,
  contacts,
  actions,
  orderManual = false,
}: {
  companyId: string;
  contacts: CompanyContact[];
  /** Header buttons, e.g. "Add contact". */
  actions?: ReactNode;
  /** Contact 1 and 2 were picked by hand: the default order leaves them alone. */
  orderManual?: boolean;
}) {
  // Contact 1, contact 2, then the rest (leadregels, deel 4).
  const sorted = [...contacts].sort((a, b) => (roleRank[a.role] ?? 3) - (roleRank[b.role] ?? 3));
  return (
    <Card>
      <CardHeader
        title="Contacts"
        description={
          contacts.length === 0
            ? "Decision makers come in through S3 or an import."
            : `${contacts.length} ${contacts.length === 1 ? "decision maker" : "decision makers"}, the goal is contact 1 and 2 per company. ${contactOrderRule}${orderManual ? " Picked by hand: the default order is off." : ""}`
        }
        actions={
          <>
            {contacts.length > 1 && <UseDefaultOrderButton companyId={companyId} />}
            {actions}
          </>
        }
      />
      {contacts.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">No contacts at this company yet.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {sorted.map((c) => (
            <li key={c.id} className="space-y-3 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p id={`contact-${c.id}`} className="flex scroll-mt-24 flex-wrap items-center gap-2 font-medium text-ink">
                    {c.name}
                    <TierBadge tier={c.tier} />
                    <Badge tone={c.role === "main" ? "brand" : c.role === "reserve" ? "accent" : "neutral"}>
                      {c.role === "main" ? "Contact 1" : c.role === "reserve" ? "Contact 2" : "Extra"}
                    </Badge>
                  </p>
                  {c.title && <p className="text-sm text-muted">{c.title}</p>}
                  {(c.attempts > 0 || c.callbackAt || c.referredTo) && (
                    <p className="mt-1 text-xs text-muted">
                      {c.attempts > 0 && `${c.attempts} ${c.attempts === 1 ? "attempt" : "attempts"}`}
                      {c.lastAttemptAt && `, last ${formatDate(c.lastAttemptAt)}`}
                      {c.callbackAt && `${c.attempts > 0 ? ". " : ""}Call back on ${formatDate(c.callbackAt)}`}
                      {c.referredTo && `${c.attempts > 0 || c.callbackAt ? ". " : ""}Referred to ${c.referredTo}`}
                    </p>
                  )}
                  {c.callerNote && <p className="mt-1 text-xs whitespace-pre-line text-ink">{c.callerNote}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <ContactStatusBadge status={c.status} />
                  {c.contactFlag && <Badge tone="danger">{contactFlagLabels[c.contactFlag]}</Badge>}
                </div>
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
                        {c.linkedinUrl.replace(/^(https?:\/\/)?(www\.)?linkedin\.com/, "")}
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                      {isLinkedinLinkBroken(c.linkedinUrl) && (
                        <span className="mt-0.5 flex items-start gap-1 text-xs text-amber-800">
                          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                          This Apify link was saved in lowercase and may not open. Paste the link again with its capitals, or let Claude fetch it again.
                        </span>
                      )}
                      {c.linkedinMemberUrn && !c.linkedinUrl.includes(c.linkedinMemberUrn) && (
                        <span className="block text-xs text-muted">
                          Also known as{" "}
                          <a
                            href={`https://www.linkedin.com/in/${c.linkedinMemberUrn}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand-700 hover:underline"
                          >
                            {c.linkedinMemberUrn}
                            <span className="sr-only">(Apify link, opens in a new tab)</span>
                          </a>
                        </span>
                      )}
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

              <div className="-mx-2 flex flex-wrap items-center gap-1">
                <EditContactButton
                  contact={{
                    id: c.id,
                    firstName: c.firstName,
                    lastName: c.lastName,
                    title: c.title,
                    tier: c.tier,
                    role: c.role,
                    email: c.email,
                    phone: c.phone,
                    linkedinUrl: c.linkedinUrl,
                  }}
                  action={updateContactAction.bind(null, companyId, c.id)}
                />
                <ContactChannelsButton
                  name={c.name}
                  mail={!c.noMail}
                  call={!c.noCall}
                  linkedin={!c.noLinkedin}
                  flag={c.contactFlag}
                  action={setContactChannelsAction.bind(null, companyId, c.id)}
                />
                <DeleteContactButton name={c.name} action={deleteContactAction.bind(null, companyId, c.id)} />
              </div>

            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
