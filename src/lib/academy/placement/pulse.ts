// Pulse (Academy: pulse): every two weeks a score from 1 to 10, what goes
// well and what chafes, from the client contacts and the developer. Only
// Nordavo sees the scores. Pure, mirrors academy_pulse_flag() in SQL, tested
// in tests/academy-placement.test.ts.

export type PulseFlag = "low" | "drop" | null;

/** Low: 5 or lower. Dropping: at least 2 lower than the previous answer. */
export function pulseFlag(score: number, previous: number | null | undefined): PulseFlag {
  if (score <= 5) return "low";
  if (previous !== null && previous !== undefined && previous - score >= 2) return "drop";
  return null;
}

/** The start of the round a day is in: every 14 days from the start date; null before day 14. */
export function pulseRoundStart(startDate: string, today: string): string | null {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(sy, sm - 1, sd)) / 86_400_000);
  if (days < 14) return null;
  const start = new Date(Date.UTC(sy, sm - 1, sd + 14 * Math.floor(days / 14)));
  return start.toISOString().slice(0, 10);
}

export type PulsePoint = { periodStart: string; score: number; flagged: boolean };

export type PulseSeries = {
  profileId: string;
  name: string;
  role: string;
  points: PulsePoint[];
  latest: number | null;
  /** Latest minus the one before. */
  change: number | null;
  average: number | null;
};

/** One series per person, oldest first. */
export function pulseSeries(
  rows: { profile_id: string; name: string; role: string; period_start: string; score: number | null; flagged: boolean }[],
): PulseSeries[] {
  const map = new Map<string, PulseSeries>();
  for (const row of [...rows].sort((a, b) => a.period_start.localeCompare(b.period_start))) {
    const series = map.get(row.profile_id) ?? {
      profileId: row.profile_id,
      name: row.name,
      role: row.role,
      points: [],
      latest: null,
      change: null,
      average: null,
    };
    if (row.score !== null) series.points.push({ periodStart: row.period_start, score: row.score, flagged: row.flagged });
    map.set(row.profile_id, series);
  }
  for (const series of map.values()) {
    const scores = series.points.map((p) => p.score);
    series.latest = scores.at(-1) ?? null;
    series.change = scores.length >= 2 ? scores[scores.length - 1] - scores[scores.length - 2] : null;
    series.average = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
  }
  return [...map.values()].sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
}
