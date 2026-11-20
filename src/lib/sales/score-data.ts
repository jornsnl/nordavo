import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { signalState, type ScoredSignalInput, type SignalPoint } from "@/lib/sales/score";
import { daysOnline } from "@/lib/sales/vacancies";

type Db = SupabaseClient<Database>;

/** The points table of Settings, Sales lists (sales_signal_points), in order. */
export async function loadSignalPoints(db: Db): Promise<SignalPoint[]> {
  const { data, error } = await db
    .from("sales_signal_points")
    .select("type, label, description, points, active, derived, valid_days, position")
    .order("position")
    .order("type");
  if (error) return [];
  return data ?? [];
}

/** A signal with its date, days open, whether it is active or evergreen and its points. */
export function describeSignal<T extends ScoredSignalInput>(signal: T, points: SignalPoint[]) {
  const state = signalState(signal, points);
  return {
    ...signal,
    online_since: state.date,
    days_open: signal.closed_at ? null : daysOnline(state.date),
    active: state.active,
    evergreen: state.evergreen,
    counts_for_score: state.counts,
    points: state.points,
  };
}
