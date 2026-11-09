"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import type { AcademyLocale } from "@/lib/academy/database";
import { switchLocale } from "@/app/academy/actions";

/** NL / EN switch in the Academy header. Saved on the person, so it follows them. */
export function LocaleSwitch({ locale, label, disabled }: { locale: AcademyLocale; label: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: AcademyLocale) {
    if (next === locale || disabled) return;
    startTransition(async () => {
      const result = await switchLocale(next);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div role="group" aria-label={label} className="flex items-center gap-1 rounded-xl border border-academy-blue-200 bg-white p-0.5">
      <Languages className="ml-1.5 size-4 max-sm:hidden text-academy-blue-600" aria-hidden="true" />
      {(["nl", "en"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={value === locale}
          disabled={pending || disabled}
          onClick={() => choose(value)}
          className={`rounded-lg px-2 py-1 text-xs font-semibold uppercase transition pointer-coarse:min-h-9 ${
            value === locale ? "bg-academy-blue-700 text-white" : "text-academy-blue-800 hover:bg-academy-blue-100"
          }`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
