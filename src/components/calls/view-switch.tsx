import Link from "next/link";
import { Phone, Sheet } from "lucide-react";

/** Call screen or call sheet for the same list (feedback Julius, 896704e2: both views stay). */
export function ViewSwitch({ screenHref, sheetHref, active }: { screenHref: string; sheetHref: string; active: "screen" | "sheet" }) {
  const item = (href: string, key: "screen" | "sheet", label: string, Icon: typeof Phone) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium ${active === key ? "bg-brand-700 text-white" : "text-brand-800 hover:bg-brand-50"}`}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
  return (
    <nav aria-label="View" className="flex items-center gap-1 rounded-xl border border-border bg-white p-0.5">
      {item(screenHref, "screen", "Call screen", Phone)}
      {item(sheetHref, "sheet", "Sheet", Sheet)}
    </nav>
  );
}
