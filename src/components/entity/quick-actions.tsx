import type { LucideIcon } from "lucide-react";

export type QuickAction = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Opens in a new tab, e.g. a website or LinkedIn. */
  external?: boolean;
  /** Accessible name when the label alone is too short, e.g. "Bel Sanne". */
  ariaLabel?: string;
};

/**
 * Big tap targets for the most used actions on a record (call, mail, open
 * the website), like the buttons under a contact in a phone's address book.
 * Phones only; desktop shows the same links in the details.
 */
export function QuickActions({ actions, label }: { actions: QuickAction[]; label: string }) {
  if (actions.length === 0) return null;
  return (
    <nav aria-label={label} className="mb-6 sm:hidden">
      <ul className="grid auto-cols-fr grid-flow-col gap-2">
        {actions.map(({ label, href, icon: Icon, external, ariaLabel }) => (
          <li key={href} className="min-w-0">
            <a
              href={href}
              aria-label={ariaLabel}
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-card px-2 py-2.5 text-xs font-semibold text-brand-700 shadow-xs transition active:scale-[0.97] active:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            >
              <Icon className="size-5" aria-hidden="true" />
              <span className="max-w-full truncate">{label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A phone number as a tel: link target, without spaces or dashes. */
export function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
