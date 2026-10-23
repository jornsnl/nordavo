import type { ApplicationStage } from "@/lib/database.types";

/** Stages that count as "presented to the client" for the 3 candidates promise. */
export const PRESENTED_STAGES: ApplicationStage[] = ["presented", "final_interview", "placed"];

/** Nordavo promises three presented candidates per vacancy. */
export const PRESENTED_TARGET = 3;

/**
 * Fractional index for the card at `index`: the midpoint between its
 * neighbours, or a step of 1024 past the edge of the column.
 */
export function positionAt(positions: number[], index: number): number {
  const prev = positions[index - 1];
  const next = positions[index + 1];
  if (prev === undefined && next === undefined) return 1024;
  if (prev === undefined) return next - 1024;
  if (next === undefined) return prev + 1024;
  return (prev + next) / 2;
}
