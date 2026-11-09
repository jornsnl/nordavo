"use client";

import { useId, useRef } from "react";
import { Upload } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

/** A file picker that looks like a button (editor, dashboard style). */
export function UploadButton({
  label,
  accept,
  disabled,
  onFile,
  variant = "secondary",
}: {
  label: string;
  accept: string;
  disabled?: boolean;
  onFile: (file: File) => void;
  variant?: "primary" | "secondary";
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <label
      htmlFor={id}
      className={`${buttonClasses({ variant, size: "sm" })} cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-brand-500 ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <Upload aria-hidden="true" />
      {label}
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          if (input.current) input.current.value = "";
        }}
      />
    </label>
  );
}

/** Upload progress, 0 to 1. */
export function UploadProgress({ value, label }: { value: number | null; label: string }) {
  if (value === null) return null;
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="h-2 overflow-hidden rounded-full bg-brand-50" role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-accent-500 transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-muted">
        {label}: {percent}%
      </p>
    </div>
  );
}
