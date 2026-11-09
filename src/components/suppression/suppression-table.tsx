import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { deleteSuppressionAction } from "@/app/dashboard/suppressions/actions";
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
        <Link href={`/dashboard/contacts/${item.contact.id}`} className="font-medium text-brand-800 hover:underline">
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
        <div className="text-xs text-muted">The whole company, {item.company.domain}</div>
      </div>
    );
  }
  return (
    <div>
      <div className="font-medium break-all text-ink">{item.email}</div>
      <div className="text-xs text-muted">Only this email address</div>
    </div>
  );
}

export function SuppressionTable({ items, filtered }: { items: SuppressionItem[]; filtered: boolean }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={ShieldOff}
        title={filtered ? "Nothing found" : "Nobody suppressed yet"}
        description={
          filtered
            ? "No suppressions match this search or filter."
            : "Unsubscribes from Instantly show up here by themselves. Add anyone yourself who does not want to be, or may not be, contacted."
        }
      />
    );
  }
  return (
    <>
      <MobileList label="Suppressions" className="md:hidden">
        {items.map((item) => {
          const reason = optionFor(suppressionReasons, item.reason);
          const scope = optionFor(suppressionScopes, item.scope);
          const name = item.contact?.name ?? item.company?.name ?? item.email ?? "this entry";
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
                    ? `The whole company, ${item.company.domain}`
                    : "Only this email address"
              }
              meta={`Since ${formatDate(item.createdAt)}${item.createdBy ? `, by ${item.createdBy}` : ""}`}
              trailing={
                <div className="-mr-2 [&>button]:size-11">
                  <ConfirmDeleteButton
                    action={deleteSuppressionAction.bind(null, item.id)}
                    title="Lift suppression?"
                    description={`${name} can then be called and mailed again. Only do this if you are sure it is allowed.`}
                    label={`Lift suppression for ${name}`}
                    confirmLabel="Yes, lift it"
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
            <TH>Who</TH>
            <TH>Reason</TH>
            <TH>Channels</TH>
            <TH>Note</TH>
            <TH>Since</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {items.map((item) => {
            const reason = optionFor(suppressionReasons, item.reason);
            const scope = optionFor(suppressionScopes, item.scope);
            const name = item.contact?.name ?? item.company?.name ?? item.email ?? "this entry";
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
                  {item.createdBy && <div className="text-xs">by {item.createdBy}</div>}
                </TD>
                <TD className="text-right">
                  <ConfirmDeleteButton
                    action={deleteSuppressionAction.bind(null, item.id)}
                    title="Lift suppression?"
                    description={`${name} can then be called and mailed again. Only do this if you are sure it is allowed.`}
                    label={`Lift suppression for ${name}`}
                    confirmLabel="Yes, lift it"
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
