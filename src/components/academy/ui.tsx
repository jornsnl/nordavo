import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { CheckCircle2, Lock } from "lucide-react";
import type { AcademyModuleState } from "@/lib/academy/database";

// Academy house style (globals.css, --academy-*): orange for buttons and
// actions, light blue for everything else. Server-safe building blocks.

const actionBase =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-academy-orange-600 disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-[18px]";

const actionVariants = {
  primary: "bg-academy-orange-600 text-white shadow-sm hover:bg-academy-orange-700",
  secondary: "border border-academy-orange-600/30 bg-white text-academy-orange-700 hover:bg-academy-orange-50",
  quiet: "text-academy-blue-800 hover:bg-academy-blue-100",
} as const;

export type ActionVariant = keyof typeof actionVariants;

export function actionClasses(variant: ActionVariant = "primary", className = "") {
  return `${actionBase} ${actionVariants[variant]} px-4 py-2.5 text-sm pointer-coarse:min-h-11 ${className}`;
}

export function ActionLink({ variant, className, ...props }: ComponentProps<typeof Link> & { variant?: ActionVariant }) {
  return <Link className={actionClasses(variant, className)} {...props} />;
}

export function ActionButton({
  variant,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ActionVariant }) {
  return <button type={type} className={actionClasses(variant, className)} {...props} />;
}

/** A light blue card. */
export function Panel({ title, action, className = "", children }: { title?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-academy-blue-200 bg-white shadow-xs ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-academy-blue-100 px-4 py-3 sm:px-5">
          <h2 className="font-display text-base font-semibold text-academy-blue-900">{title}</h2>
          {action}
        </header>
      )}
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

export function ProgressBar({ percent, label, size = "md" }: { percent: number; label: string; size?: "sm" | "md" }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`w-full overflow-hidden rounded-full bg-academy-blue-100 ${size === "sm" ? "h-1.5" : "h-2.5"}`}
    >
      <div className="h-full rounded-full bg-academy-blue-600 transition-[width]" style={{ width: `${value}%` }} />
    </div>
  );
}

/** Green check for done, lock for closed, an empty ring for open. */
export function LessonMark({ done, locked, className = "size-5" }: { done: boolean; locked: boolean; className?: string }) {
  if (done) return <CheckCircle2 className={`${className} shrink-0 text-emerald-600`} aria-hidden="true" />;
  if (locked) return <Lock className={`${className} shrink-0 p-0.5 text-academy-blue-500`} aria-hidden="true" />;
  return <span aria-hidden="true" className={`${className} shrink-0 rounded-full border-2 border-academy-blue-300`} />;
}

export function StateBadge({ state, label }: { state: AcademyModuleState; label: string }) {
  const tone =
    state === "completed"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15"
      : state === "open"
        ? "bg-academy-blue-100 text-academy-blue-800 ring-academy-blue-300/40"
        : "bg-slate-100 text-slate-600 ring-slate-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
      {state.startsWith("locked") && <Lock className="size-3" aria-hidden="true" />}
      {label}
    </span>
  );
}
