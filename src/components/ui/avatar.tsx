import { initials } from "@/lib/format";

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-100 font-display font-bold text-brand-700 ${
        size === "sm" ? "size-7 text-[11px]" : "size-9 text-sm"
      }`}
    >
      {initials(name)}
    </span>
  );
}
