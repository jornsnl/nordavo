import type { ComponentProps, ReactNode } from "react";
import { ChevronDown } from "lucide-react";

const control =
  "block w-full rounded-xl border border-border bg-white px-3.5 py-2.5 text-sm text-ink shadow-xs outline-none transition placeholder:text-muted/60 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 disabled:bg-surface aria-invalid:border-danger";

/** Label, control, hint and error message for one form field. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className = "",
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={`${control} ${className}`} {...props} />;
}

export function Textarea({ className = "", rows = 4, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={`${control} resize-y ${className}`} {...props} />;
}

export function Select({ className = "", children, ...props }: ComponentProps<"select">) {
  // Width classes size the wrapper; everything else styles the select itself.
  const classes = className.split(/\s+/).filter(Boolean);
  const widths = classes.filter((c) => /(^|:)w-/.test(c)).join(" ");
  const rest = classes.filter((c) => !/(^|:)w-/.test(c)).join(" ");
  return (
    <div className={`relative ${widths}`}>
      <select className={`${control} appearance-none pr-10 ${rest}`} {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
      />
    </div>
  );
}

/** Form-level error or success message from a server action. */
export function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (error) {
    return (
      <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
        {error}
      </p>
    );
  }
  if (success) {
    return (
      <p role="status" className="rounded-xl border border-emerald-600/20 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        {success}
      </p>
    );
  }
  return null;
}
