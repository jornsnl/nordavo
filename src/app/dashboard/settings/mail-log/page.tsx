import type { Metadata } from "next";
import { Suspense } from "react";
import Form from "next/form";
import Link from "next/link";
import { Inbox, MailSearch } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { FilterSheet } from "@/components/leads/filter-sheet";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { ListSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { isMailLogStatus, listMailLog, mailLogStatuses, type MailLogItem } from "@/lib/data/mail-log";
import { formatDateTime } from "@/lib/format";
import { isMailCategory, mailCategories, mailCategoryLabel } from "@/lib/notify/categories";
import { hasAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Mail log",
};

export default function Page({ searchParams }: PageProps<"/dashboard/settings/mail-log">) {
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Your own account and, as an admin, who has access to the portal."
      />
      <SettingsTabs active="mail-log" isAdmin />
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <MailLog searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const option = mailLogStatuses.find((s) => s.value === status);
  return <Badge tone={option?.tone ?? "neutral"}>{option?.label ?? status}</Badge>;
}

function recipients(item: MailLogItem) {
  const to = item.to_addresses.join(", ") || "No recipient";
  return item.cc_addresses.length > 0 ? `${to} (cc ${item.cc_addresses.join(", ")})` : to;
}

async function MailLog({ searchParams }: { searchParams: PageProps<"/dashboard/settings/mail-log">["searchParams"] }) {
  await requireAdmin();
  const params = await searchParams;
  const status = isMailLogStatus(params.status) ? params.status : undefined;
  const category = typeof params.category === "string" && isMailCategory(params.category) ? params.category : undefined;
  const q = typeof params.q === "string" ? params.q.slice(0, 200) : undefined;
  const before = typeof params.before === "string" && !Number.isNaN(Date.parse(params.before)) ? params.before : undefined;
  const { items, hasMore } = await listMailLog({ status, category, q, before });
  const filtered = Boolean(status || category || q);

  const olderHref = (() => {
    const last = items.at(-1);
    if (!hasMore || !last) return null;
    const next = new URLSearchParams();
    if (status) next.set("status", status);
    if (category) next.set("category", category);
    if (q) next.set("q", q);
    next.set("before", last.created_at);
    return `/dashboard/settings/mail-log?${next.toString()}`;
  })();

  return (
    <section aria-labelledby="mail-log-title" className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 id="mail-log-title" className="font-display text-lg font-semibold text-brand-900">
            Mail log
          </h2>
          <p className="text-sm text-muted">
            Every mail the portal sent or tried to send, newest first. Kept for 180 days.
          </p>
        </div>
        <Form action="/dashboard/settings/mail-log" className="flex items-center gap-2 max-md:justify-between">
          <p className="text-sm text-muted md:hidden">
            {[q, category ? mailCategoryLabel(category) : null, status ? mailLogStatuses.find((s) => s.value === status)?.label : null]
              .filter(Boolean)
              .join(", ") || "All mail"}
          </p>
          <FilterSheet
            activeCount={[status, category, q].filter(Boolean).length}
            resetHref="/dashboard/settings/mail-log"
            title="Filter mail"
          >
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <label htmlFor="mail-q" className="sr-only max-md:not-sr-only max-md:text-sm max-md:font-medium max-md:text-ink">
                Search
              </label>
              <Input
                id="mail-q"
                name="q"
                type="search"
                defaultValue={q ?? ""}
                placeholder="Subject or exact address"
                className="md:w-60"
              />
              <label htmlFor="mail-category" className="sr-only max-md:not-sr-only max-md:mt-2 max-md:text-sm max-md:font-medium max-md:text-ink">
                Kind
              </label>
              <Select id="mail-category" name="category" defaultValue={category ?? ""} className="md:w-52">
                <option value="">All kinds</option>
                {mailCategories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
              <label htmlFor="mail-status" className="sr-only max-md:not-sr-only max-md:mt-2 max-md:text-sm max-md:font-medium max-md:text-ink">
                Status
              </label>
              <Select id="mail-status" name="status" defaultValue={status ?? ""} className="md:w-36">
                <option value="">Any status</option>
                {mailLogStatuses.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="secondary" className="max-md:hidden">
                Filter
              </Button>
            </div>
          </FilterSheet>
        </Form>
      </div>

      {!hasAdminClient() && (
        <p className="rounded-2xl border border-amber-600/20 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          SUPABASE_SECRET_KEY is missing on the server, so new mail is not logged. Set it to fill this log.
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={filtered ? MailSearch : Inbox}
          title={filtered ? "No mail found" : before ? "No older mail" : "No mail yet"}
          description={
            filtered
              ? "No mail matches this filter. Addresses are matched exactly."
              : "As soon as the portal sends a mail, for example a test mail from the General tab, it appears here."
          }
        />
      ) : (
        <>
          <MobileList label="Mail" className="md:hidden">
            {items.map((item) => (
              <MobileListItem
                key={item.id}
                href={`/dashboard/settings/mail-log/${item.id}`}
                title={item.subject}
                subtitle={recipients(item)}
                meta={`${formatDateTime(item.created_at)} · ${mailCategoryLabel(item.category)}`}
                trailing={<StatusBadge status={item.status} />}
              />
            ))}
          </MobileList>
          <Table className="hidden md:block">
            <THead>
              <tr>
                <TH>Sent</TH>
                <TH>To</TH>
                <TH>Subject</TH>
                <TH>Kind</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {items.map((item) => (
                <TR key={item.id} className="align-top">
                  <TD className="whitespace-nowrap text-muted">{formatDateTime(item.created_at)}</TD>
                  <TD className="max-w-56">
                    <p className="truncate" title={recipients(item)}>
                      {recipients(item)}
                    </p>
                    {item.from_address && <p className="truncate text-xs text-muted">from {item.from_address}</p>}
                  </TD>
                  <TD className="max-w-md">
                    <Link
                      href={`/dashboard/settings/mail-log/${item.id}`}
                      className="font-medium text-ink hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
                    >
                      {item.subject}
                    </Link>
                    {item.error && <p className="mt-0.5 line-clamp-2 text-xs break-words text-danger">{item.error}</p>}
                  </TD>
                  <TD className="whitespace-nowrap text-muted">{mailCategoryLabel(item.category)}</TD>
                  <TD>
                    <StatusBadge status={item.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {(olderHref || before) && (
            <div className="flex flex-wrap justify-between gap-2">
              {before ? (
                <ButtonLink href="/dashboard/settings/mail-log" variant="ghost">
                  Back to newest
                </ButtonLink>
              ) : (
                <span />
              )}
              {olderHref && (
                <ButtonLink href={olderHref} variant="secondary">
                  Older mail
                </ButtonLink>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
