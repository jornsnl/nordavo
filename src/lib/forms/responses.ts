import type { ApplicationStage } from "@/lib/database.types";
import { answerText } from "./answers";
import type { Question } from "./schema";

/**
 * The Responses view: every question a column, filter and sort on answers
 * (recruitment brief, part 3/3). Pure, so the table logic is unit tested.
 */

export type ResponseRow = {
  /** Application id. */
  id: string;
  candidateId: string;
  candidateName: string;
  stage: ApplicationStage;
  via: "general" | "headhunted" | "personal";
  formVersion: number;
  submittedAt: string;
  answers: Record<string, unknown>;
};

export type TableQuery = {
  /** Question id, or "name" / "submitted". */
  sort?: string;
  dir?: "asc" | "desc";
  /** Question id -> filter text. */
  filters?: Record<string, string>;
};

const NUMERIC: Question["type"][] = ["number", "current_ctc", "expected_ctc", "hourly_rate"];

function numberFilter(filter: string): ((n: number) => boolean) | null {
  const f = filter.replace(/\s+/g, "").replace(/,/g, "");
  let m = /^(>=|<=|>|<|=)?(\d+(?:\.\d+)?)$/.exec(f);
  if (m) {
    const v = Number(m[2]);
    switch (m[1]) {
      case ">=":
        return (n) => n >= v;
      case "<=":
        return (n) => n <= v;
      case ">":
        return (n) => n > v;
      case "<":
        return (n) => n < v;
      default:
        return (n) => n === v;
    }
  }
  m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(f);
  if (m) {
    const [lo, hi] = [Number(m[1]), Number(m[2])];
    return (n) => n >= lo && n <= hi;
  }
  return null;
}

export function matchesFilter(q: Question, value: unknown, filter: string): boolean {
  const wanted = filter.trim().toLowerCase();
  if (!wanted) return true;
  if (wanted === "(empty)") return value === undefined || value === null || value === "";
  if (q.type === "yes_no") {
    if (wanted === "yes") return value === true;
    if (wanted === "no") return value === false;
  }
  if (NUMERIC.includes(q.type)) {
    const test = numberFilter(wanted);
    if (test) return typeof value === "number" && test(value);
  }
  return answerText(value).toLowerCase().includes(wanted);
}

function sortValue(row: ResponseRow, key: string, questions: Map<string, Question>): string | number | null {
  if (key === "name") return row.candidateName.toLowerCase();
  if (key === "submitted") return row.submittedAt;
  const q = questions.get(key);
  const value = row.answers[key];
  if (value === undefined || value === null || value === "") return null;
  if (q && NUMERIC.includes(q.type) && typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return answerText(value).toLowerCase();
}

export function filterAndSort(rows: ResponseRow[], questions: Question[], query: TableQuery): ResponseRow[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const filters = Object.entries(query.filters ?? {}).filter(([id, f]) => byId.has(id) && f.trim() !== "");
  const filtered = rows.filter((row) => filters.every(([id, f]) => matchesFilter(byId.get(id)!, row.answers[id], f)));

  const key = query.sort && (query.sort === "name" || query.sort === "submitted" || byId.has(query.sort)) ? query.sort : "submitted";
  const dir = query.sort ? (query.dir === "desc" ? -1 : 1) : -1;

  return filtered
    .map((row, index) => ({ row, index, value: sortValue(row, key, byId) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      const cmp =
        typeof a.value === "number" && typeof b.value === "number"
          ? a.value - b.value
          : String(a.value).localeCompare(String(b.value));
      return cmp === 0 ? a.index - b.index : cmp * dir;
    })
    .map(({ row }) => row);
}
