import type { ComponentProps, ReactNode } from "react";

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
  return (
    <select className={`${control} appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%235b6779%22><path d=%22M5.5 7.5 10 12l4.5-4.5%22 stroke=%22%235b6779%22 stroke-width=%221.5%22 fill=%22none%22/></svg>')] bg-[length:20px] bg-[right_10px_center] bg-no-repeat pr-10 ${className}`} {...props}>
      {children}
    </select>
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
