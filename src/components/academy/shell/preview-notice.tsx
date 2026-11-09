import { Eye } from "lucide-react";
import { requireAcademyUser } from "@/lib/academy/auth";
import { t } from "@/lib/academy/i18n";

/** Nordavo managers without an Academy row see everything, and nothing is recorded. Also the access gate. */
export async function PreviewNotice() {
  const user = await requireAcademyUser();
  if (user.member) return null;
  return (
    <p className="mb-5 flex items-center gap-2 rounded-xl border border-academy-orange-600/20 bg-academy-orange-50 px-4 py-2.5 text-sm text-academy-orange-800">
      <Eye className="size-4 shrink-0" aria-hidden="true" />
      {t(user.locale, "shell.preview")}
    </p>
  );
}
