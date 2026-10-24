/** A simple 0 to 100 meter for assessment scores. */
export function ScoreMeter({ id, label, value }: { id: string; label: string; value: number | null }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span id={id} className="font-medium text-muted">
          {label}
        </span>
        <span className="font-semibold text-brand-900">{value === null ? "Nog niet getest" : `${value}/100`}</span>
      </div>
      <div
        role="meter"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
        aria-valuetext={value === null ? "Nog niet getest" : `${value} van 100`}
        className="h-2 overflow-hidden rounded-full bg-brand-100"
      >
        <div
          className="h-full rounded-full bg-brand-600"
          style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
        />
      </div>
    </div>
  );
}
