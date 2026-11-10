import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/lib/content/rules";

/** A post status with its label from the workspace settings. */
export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <Badge tone={statusTone(status)}>{label}</Badge>;
}
