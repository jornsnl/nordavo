import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { deleteSuppressionAction } from "@/app/dashboard/uitsluitingen/actions";
import { ConfirmDeleteButton } from "@/components/clients/confirm-delete-button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { SuppressionItem } from "@/lib/data/suppression";
import { formatDate } from "@/lib/format";
import { optionFor, suppressionReasons, suppressionScopes } from "@/lib/labels";

function Target({ item }: { item: SuppressionItem }) {
  if (item.contact) {
    return (
      <div>
        <Link href={`/dashboard/contacten/${item.contact.id}`} className="font-medium text-brand-800 hover:underline">
          {item.contact.name}
        </Link>
        <div className="text-xs text-muted">{[item.contact.companyName, item.contact.email].filter(Boolean).join(", ") || "Contact"}</div>
      </div>
    );
  }
  if (item.company) {
    return (
      <div>
        <Link href={`/dashboard/leads/${item.company.id}`} className="font-medium text-brand-800 hover:underline">
          {item.company.name}
        </Link>
        <div className="text-xs text-muted">Heel het bedrijf, {item.company.domain}</div>
      </div>
    );
  }
  return (
    <div>
      <div className="font-medium break-all text-ink">{item.email}</div>
      <div className="text-xs text-muted">Alleen dit mailadres</div>
    </div>
  );
}

export function SuppressionTable({ items, filtered }: { items: SuppressionItem[]; filtered: boolean }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={ShieldOff}
        title={filtered ? "Niets gevonden" : "Nog niemand uitgesloten"}
        description={
          filtered
            ? "Geen uitsluitingen met deze zoekterm of dit filter."
            : "Afmeldingen uit Instantly komen hier vanzelf. Voeg zelf iemand toe die niet benaderd wil of mag worden."
        }
      />
    );
  }
  return (
    <>
      <MobileList label="Uitsluitingen" className="md:hidden">
        {items.map((item) => {
          const reason = optionFor(suppressionReasons, item.reason);
          const scope = optionFor(suppressionScopes, item.scope);
          const name = item.contact?.name ?? item.company?.name ?? item.email ?? "deze uitsluiting";
          return (
            <MobileListItem
              key={item.id}
              title={
                item.company ? (
                  <Link href={`/dashboard/leads/${item.company.id}`} className="text-brand-800 active:underline">
                    {item.company.name}
                  </Link>
                ) : (
                  <span className={item.contact ? undefined : "break-all whitespace-normal"}>{name}</span>
                )
              }
              subtitle={
                item.contact
                  ? [item.contact.companyName, item.contact.email].filter(Boolean).join(", ") || "Contact"
                  : item.company
                    ? `Heel het bedrijf, ${item.company.domain}`
                    : "Alleen dit mailadres"
              }
              meta={`Sinds ${formatDate(item.createdAt)}${item.createdBy ? `, door ${item.createdBy}` : ""}`}
              trailing={
                <div className="-mr-2 [&>button]:size-11">
                  <ConfirmDeleteButton
                    action={deleteSuppressionAction.bind(null, item.id)}
                    title="Uitsluiting opheffen?"
                    description={`${name} kan daarna weer op bel en maillijsten komen, als de 30 dagen regel het toelaat. Doe dit alleen als je zeker weet dat het mag.`}
                    label={`Uitsluiting van ${name} opheffen`}
                    confirmLabel="Ja, opheffen"
                    iconOnly
                  />
                </div>
              }
            >
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={reason.tone}>{reason.label}</Badge>
                <Badge tone={scope.tone}>{scope.label}</Badge>
              </div>
              {item.notes && <p className="mt-1.5 line-clamp-3 text-sm text-muted">{item.notes}</p>}
            </MobileListItem>
          );
        })}
      </MobileList>
      <Table className="hidden md:block">
        <THead>
          <tr>
            <TH>Wie</TH>
            <TH>Reden</TH>
            <TH>Kanalen</TH>
            <TH>Notitie</TH>
            <TH>Sinds</TH>
            <TH>
              <span className="sr-only">Acties</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {items.map((item) => {
            const reason = optionFor(suppressionReasons, item.reason);
            const scope = optionFor(suppressionScopes, item.scope);
            const name = item.contact?.name ?? item.company?.name ?? item.email ?? "deze uitsluiting";
            return (
              <TR key={item.id}>
                <TD>
                  <Target item={item} />
                </TD>
                <TD>
                  <Badge tone={reason.tone}>{reason.label}</Badge>
                </TD>
                <TD>
                  <Badge tone={scope.tone}>{scope.label}</Badge>
                </TD>
                <TD className="max-w-72 text-muted">
                  <span className="line-clamp-2">{item.notes ?? ""}</span>
                </TD>
                <TD className="whitespace-nowrap text-muted">
                  {formatDate(item.createdAt)}
                  {item.createdBy && <div className="text-xs">door {item.createdBy}</div>}
                </TD>
                <TD className="text-right">
                  <ConfirmDeleteButton
                    action={deleteSuppressionAction.bind(null, item.id)}
                    title="Uitsluiting opheffen?"
                    description={`${name} kan daarna weer op bel en maillijsten komen, als de 30 dagen regel het toelaat. Doe dit alleen als je zeker weet dat het mag.`}
                    label={`Uitsluiting van ${name} opheffen`}
                    confirmLabel="Ja, opheffen"
                    iconOnly
                  />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </>
  );
}
