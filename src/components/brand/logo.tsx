type LogoProps = {
  /** "dark" for light backgrounds, "light" for the navy brand panels. */
  tone?: "dark" | "light";
  className?: string;
  showWordmark?: boolean;
};

export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill="var(--brand-700)" />
      {/* Compass needle pointing north: Nordavo, the northern bridge */}
      <path d="M16 5.5 21 16h-10z" fill="var(--accent-500)" />
      <path d="M16 26.5 11 16h10z" fill="#ffffff" fillOpacity="0.9" />
      <circle cx="16" cy="16" r="1.6" fill="var(--brand-700)" />
    </svg>
  );
}

export function Logo({
  tone = "dark",
  className = "",
  showWordmark = true,
}: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      {showWordmark && (
        <span
          aria-hidden="true"
          className={`font-display text-xl font-bold tracking-tight ${
            tone === "light" ? "text-white" : "text-brand-900"
          }`}
        >
          nordavo
        </span>
      )}
      <span className="sr-only">Nordavo</span>
    </span>
  );
}
