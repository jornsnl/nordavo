import { Download } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

/** "Export CSV" on a list page: every record with every custom field as a column. */
export function ExportCsvLink({ href, label = "Export CSV" }: { href: string; label?: string }) {
  return (
    // A plain link: the route answers with a file, not a page.
    <a href={href} download className={buttonClasses({ variant: "secondary" })}>
      <Download aria-hidden="true" />
      {label}
    </a>
  );
}
