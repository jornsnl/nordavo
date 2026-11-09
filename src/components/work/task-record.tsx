import Link from "next/link";
import { ExternalLink, Link2, Mail, Phone, UserRound } from "lucide-react";
import type { PrimaryContact, TaskRecord } from "@/lib/work/records";

// The portal record of a Work task and its primary contact. Only rendered
// with data the server loaded for a team member with that module; guests
// never get a TaskRecord or PrimaryContact at all (see src/lib/work/records.ts).

/** The record a task is on, as a small chip that links to it. */
export function RecordChip({ record, className = "" }: { record: TaskRecord; className?: string }) {
  const content = (
    <>
      <Link2 className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">
        <span className="text-muted">{record.typeLabel}:</span> {record.label ?? "Deleted record"}
      </span>
    </>
  );
  const base = `inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-xs text-brand-800 ring-1 ring-border ${className}`;
  if (!record.href) return <span className={base}>{content}</span>;
  return (
    <Link
      href={record.href}
      className={`${base} relative z-10 transition hover:bg-brand-50 hover:ring-brand-200 active:bg-brand-100 pointer-coarse:py-1 focus-visible:outline-2 focus-visible:outline-brand-500`}
    >
      {content}
    </Link>
  );
}

/** Name, mail, phone and LinkedIn of the primary contact, without clicking through. */
export function PrimaryContactDetails({ contact, compact = false }: { contact: PrimaryContact; compact?: boolean }) {
  const item = "inline-flex min-w-0 items-center gap-1.5";
  const link =
    "relative z-10 truncate text-brand-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500";
  return (
    <div className={compact ? "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" : "space-y-1.5 text-sm"}>
      <p className={`${item} ${compact ? "text-ink" : "font-medium text-ink"}`}>
        <UserRound className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
        <span className="truncate">
          {contact.name}
          {contact.title && <span className="font-normal text-muted">, {contact.title}</span>}
        </span>
      </p>
      {contact.email && (
        <p className={item}>
          <Mail className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
          <a href={`mailto:${contact.email}`} className={link}>
            {contact.email}
          </a>
        </p>
      )}
      {contact.phone && (
        <p className={item}>
          <Phone className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
          <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className={link}>
            {contact.phone}
          </a>
        </p>
      )}
      {contact.linkedinUrl && /^https?:\/\//i.test(contact.linkedinUrl) && (
        <p className={item}>
          <ExternalLink className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
          <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className={link}>
            LinkedIn
          </a>
        </p>
      )}
    </div>
  );
}
