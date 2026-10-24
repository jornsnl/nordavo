import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import Form from "next/form";
import { ChevronRight, Contact, Mail, Phone, Search } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { ContactStatusBadge, EmailStatusBadge, TierBadge } from "@/components/leads/badges";
import { ChipStrip, hrefWith } from "@/components/leads/chip-strip";
import { FilterSheet } from "@/components/leads/filter-sheet";
import { Pagination } from "@/components/leads/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { MobileList } from "@/components/ui/mobile-list";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  CONTACTS_PAGE_SIZE,
  isContactStatus,
  isEmailStatus,
  listGtmContacts,
  type ContactFilters,
} from "@/lib/data/gtm-contacts";
import { formatDate } from "@/lib/format";
import { contactStatuses, contactTiers, emailStatuses } from "@/lib/labels";
import type { ContactListItem } from "@/lib/data/gtm-contacts";

export const metadata: Metadata = {
  title: "Contacten",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

function yesNo(value: string | undefined): boolean | undefined {
  if (value === "ja") return true;
  if (value === "nee") return false;
  return undefined;
}

function readFilters(params: Record<string, string | string[] | undefined>): ContactFilters {
  const status = first(params.status);
  const emailStatus = first(params.email_status);
  const tier = Number(first(params.tier));
  const page = Number(first(params.page));
  return {
    q: first(params.q),
    status: isContactStatus(status) ? status : undefined,
    tier: tier === 1 || tier === 2 || tier === 3 ? tier : undefined,
    hasEmail: yesNo(first(params.email)),
    emailStatus: isEmailStatus(emailStatus) ? emailStatus : undefined,
    hasMobile: yesNo(first(params.mobiel)),
    inOnePage: yesNo(first(params.onepage)),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

const yn = (value: boolean | undefined) => (value === true ? "ja" : value === false ? "nee" : undefined);

function toParams(f: ContactFilters): Record<string, string | undefined> {
  return {
    q: f.q,
    status: f.status,
    tier: f.tier ? String(f.tier) : undefined,
    email: yn(f.hasEmail),
    email_status: f.emailStatus,
    mobiel: yn(f.hasMobile),
    onepage: yn(f.inOnePage),
  };
}

export default function Page({ searchParams }: PageProps<"/dashboard/contacten">) {
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Contacten"
        description="Alle beslissers bij leads, met hun mail, telefoon en wanneer we ze voor het laatst benaderden."
      />
      <Suspense fallback={<Skeleton className="mb-6 h-24 w-full" />}>
        <Filters searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <ContactTable searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function YesNoSelect({ id, name, label, value }: { id: string; name: string; label: string; value?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select id={id} name={name} defaultValue={yn(value) ?? ""}>
        <option value="">{label}: maakt niet uit</option>
        <option value="ja">{label}: ja</option>
        <option value="nee">{label}: nee</option>
      </Select>
    </div>
  );
}

async function Filters({ searchParams }: { searchParams: SearchParams }) {
  const f = readFilters(await searchParams);
  const params = toParams(f);
  const active = Object.entries(params).filter(([key, value]) => key !== "q" && value).length;
  // Quick filters on phones: the tiers and "has a mobile number", keeping the other filters.
  const chips = [
    ...contactTiers.map((o) => ({
      label: `Tier ${o.value}`,
      href: hrefWith("/dashboard/contacten", { ...params, tier: f.tier === Number(o.value) ? undefined : o.value }),
      active: f.tier === Number(o.value),
    })),
    {
      label: "Met mobiel",
      href: hrefWith("/dashboard/contacten", { ...params, mobiel: f.hasMobile === true ? undefined : "ja" }),
      active: f.hasMobile === true,
    },
    {
      label: "Met mailadres",
      href: hrefWith("/dashboard/contacten", { ...params, email: f.hasEmail === true ? undefined : "ja" }),
      active: f.hasEmail === true,
    },
    {
      label: "Niet in OnePage",
      href: hrefWith("/dashboard/contacten", { ...params, onepage: f.inOnePage === false ? undefined : "nee" }),
      active: f.inOnePage === false,
    },
  ];
  return (
    <Form action="/dashboard/contacten" role="search" className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <label htmlFor="contact-q" className="sr-only">
            Zoek op naam, mail of bedrijf
          </label>
          <Input
            id="contact-q"
            name="q"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            defaultValue={f.q ?? ""}
            placeholder="Zoek op naam, mail of bedrijf"
            className="pl-10"
          />
        </div>
        <FilterSheet activeCount={active} resetHref="/dashboard/contacten" title="Contacten filteren" className="md:basis-full">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(6,minmax(0,1fr))_auto]">
            <div>
              <label htmlFor="contact-status" className="sr-only">
                Status
              </label>
              <Select id="contact-status" name="status" defaultValue={f.status ?? ""}>
                <option value="">Alle statussen</option>
                {contactStatuses.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="contact-tier" className="sr-only">
                Tier
              </label>
              <Select id="contact-tier" name="tier" defaultValue={f.tier ? String(f.tier) : ""}>
                <option value="">Alle tiers</option>
                {contactTiers.map((o) => (
                  <option key={o.value} value={o.value}>
                    Tier {o.value}
                  </option>
                ))}
              </Select>
            </div>
            <YesNoSelect id="contact-email" name="email" label="Mailadres" value={f.hasEmail} />
            <div>
              <label htmlFor="contact-email-status" className="sr-only">
                Mailstatus
              </label>
              <Select id="contact-email-status" name="email_status" defaultValue={f.emailStatus ?? ""}>
                <option value="">Elke mailstatus</option>
                {emailStatuses.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <YesNoSelect id="contact-mobiel" name="mobiel" label="Mobiel" value={f.hasMobile} />
            <YesNoSelect id="contact-onepage" name="onepage" label="In OnePage" value={f.inOnePage} />
              <Button type="submit" variant="secondary" className="max-md:hidden">
                Filteren
              </Button>
            </div>
        </FilterSheet>
      </div>
      <ChipStrip label="Snelfilters" chips={chips} className="md:hidden" />
    </Form>
  );
}

async function ContactTable({ searchParams }: { searchParams: SearchParams }) {
  const f = readFilters(await searchParams);
  const { items, total } = await listGtmContacts(f);

  if (items.length === 0) {
    const params = toParams(f);
    const filtered = Object.values(params).some(Boolean);
    return (
      <EmptyState
        icon={Contact}
        title={filtered ? "Geen contacten gevonden" : "Nog geen contacten"}
        description={
          filtered
            ? "Niets gevonden met deze filters. Pas ze aan of wis de zoekterm."
            : "Contacten komen binnen via het zoeken naar beslissers (S3) of via een import van een oude lijst."
        }
      />
    );
  }

  return (
    <>
      <MobileList label="Contacten" className="md:hidden">
        {items.map((c) => (
          <ContactRow key={c.id} contact={c} />
        ))}
      </MobileList>
      <Table className="hidden md:block">
        <THead>
          <tr>
            <TH>Naam</TH>
            <TH>Bedrijf</TH>
            <TH>Tier</TH>
            <TH>Status</TH>
            <TH>Mail</TH>
            <TH>Telefoon</TH>
            <TH>Laatst benaderd</TH>
          </tr>
        </THead>
        <TBody>
          {items.map((c) => (
            <TR key={c.id}>
              <TD>
                {c.company ? (
                  <Link
                    href={`/dashboard/leads/${c.company.id}`}
                    className="font-medium text-brand-800 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
                  >
                    {c.name}
                  </Link>
                ) : (
                  <span className="font-medium">{c.name}</span>
                )}
                {c.title && <p className="text-xs text-muted">{c.title}</p>}
                {c.onepageId && (
                  <p className="mt-1">
                    <Badge tone="accent">In OnePage</Badge>
                  </p>
                )}
              </TD>
              <TD>
                {c.company ? (
                  <Link href={`/dashboard/leads/${c.company.id}`} className="text-brand-700 hover:underline">
                    {c.company.name}
                  </Link>
                ) : (
                  <span className="text-muted">Onbekend</span>
                )}
              </TD>
              <TD>
                <TierBadge tier={c.tier} />
              </TD>
              <TD>
                <ContactStatusBadge status={c.status} />
              </TD>
              <TD className="max-w-[16rem]">
                {c.email ? (
                  <div className="space-y-1">
                    <p className="truncate text-sm" title={c.email}>
                      {c.email}
                    </p>
                    <EmailStatusBadge status={c.emailStatus} />
                  </div>
                ) : (
                  <span className="text-muted">Geen</span>
                )}
              </TD>
              <TD>
                {c.phone ? (
                  <div className="space-y-1">
                    <p className="text-sm whitespace-nowrap">{c.phone}</p>
                    {c.phoneType && (
                      <Badge tone={c.phoneType === "mobiel" ? "brand" : "neutral"}>
                        {c.phoneType === "mobiel" ? "Mobiel" : "Vast"}
                      </Badge>
                    )}
                  </div>
                ) : (
                  <span className="text-muted">Geen</span>
                )}
              </TD>
              <TD className="whitespace-nowrap text-muted">{formatDate(c.lastContactedAt, "Nooit")}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Pagination
        basePath="/dashboard/contacten"
        params={toParams(f)}
        page={f.page ?? 1}
        pageSize={CONTACTS_PAGE_SIZE}
        total={total}
      />
    </>
  );
}

/**
 * Phone row: name, role and company open the lead; call and mail buttons sit
 * on the right, so you can ring someone straight from the list.
 */
function ContactRow({ contact: c }: { contact: ContactListItem }) {
  const body = (
    <>
      <p className="line-clamp-2 font-medium break-words text-ink">{c.name}</p>
      <p className="truncate text-sm text-muted">
        {[c.title, c.company?.name].filter(Boolean).join(" bij ") || "Functie onbekend"}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <TierBadge tier={c.tier} />
        <ContactStatusBadge status={c.status} />
        {c.onepageId && <Badge tone="accent">In OnePage</Badge>}
        <span>Benaderd: {formatDate(c.lastContactedAt, "nooit")}</span>
      </div>
    </>
  );
  const action =
    "flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-white text-brand-700 transition active:scale-95 active:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500";
  return (
    <li className="flex items-center gap-2 pr-3">
      {c.company ? (
        <Link
          href={`/dashboard/leads/${c.company.id}`}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-2 py-3 pl-4 transition active:bg-brand-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500"
        >
          <div className="min-w-0 flex-1">{body}</div>
          <ChevronRight className="size-5 shrink-0 text-muted/60" aria-hidden="true" />
        </Link>
      ) : (
        <div className="min-h-14 min-w-0 flex-1 py-3 pl-4">{body}</div>
      )}
      {c.phone && (
        <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className={action} aria-label={`${c.name} bellen, ${c.phone}`}>
          <Phone className="size-5" aria-hidden="true" />
        </a>
      )}
      {c.email && (
        <a href={`mailto:${c.email}`} className={action} aria-label={`${c.name} mailen, ${c.email}`}>
          <Mail className="size-5" aria-hidden="true" />
        </a>
      )}
    </li>
  );
}
