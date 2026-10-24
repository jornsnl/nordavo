/** Match score 0 to 100: green from 70, amber from 50, red below. */
export function ScoreBar({ score }: { score: number | null }) {
  const value = score ?? 0;
  const color = value >= 70 ? "bg-emerald-500" : value >= 50 ? "bg-amber-500" : "bg-danger";
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2.5 w-28 overflow-hidden rounded-full bg-brand-50 sm:w-36"
        role="meter"
        aria-label="Matchscore"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="font-display text-lg font-bold text-brand-900 tabular-nums">{score ?? "?"}</span>
    </div>
  );
}
