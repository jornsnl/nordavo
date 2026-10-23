import type { ComponentProps, ReactNode } from "react";

/** Horizontally scrollable table inside a card. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-xs">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-border bg-surface/60 text-xs font-semibold tracking-wide text-muted uppercase">
      {children}
    </thead>
  );
}

export function TH({ className = "", ...props }: ComponentProps<"th">) {
  return <th scope="col" className={`px-4 py-3 font-semibold ${className}`} {...props} />;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function TR({ className = "", ...props }: ComponentProps<"tr">) {
  return <tr className={`transition hover:bg-brand-50/40 ${className}`} {...props} />;
}

export function TD({ className = "", ...props }: ComponentProps<"td">) {
  return <td className={`px-4 py-3 align-middle text-ink ${className}`} {...props} />;
}
