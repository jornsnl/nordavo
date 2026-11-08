import type { StageNote } from "@/lib/data/recruitment";
import type { ApplicationStage } from "@/lib/database.types";
import { formatDateTime } from "@/lib/format";
import { applicationStages, noteKinds, optionFor } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";

/** Notes grouped by the stage they were written in, newest group first; each labelled by kind. */
export function groupNotesByStage(notes: StageNote[]) {
  const groups = new Map<ApplicationStage | "general", StageNote[]>();
  for (const note of notes) {
    const key = note.stage ?? "general";
    groups.set(key, [...(groups.get(key) ?? []), note]);
  }
  return [...groups.entries()].map(([stage, items]) => ({
    stage,
    label: stage === "general" ? "General" : optionFor(applicationStages, stage).label,
    notes: items,
  }));
}

export function StageNoteList({ notes, showVacancy = false }: { notes: StageNote[]; showVacancy?: boolean }) {
  if (notes.length === 0) {
    return <p className="text-sm text-muted">No notes yet. Calls, screenings and reviews you note here are kept per stage.</p>;
  }
  return (
    <div className="space-y-5">
      {groupNotesByStage(notes).map((group) => (
        <section key={group.stage} aria-label={`Notes in ${group.label}`}>
          <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
            {group.label} <span className="font-normal">({group.notes.length})</span>
          </h4>
          <ul className="space-y-2">
            {group.notes.map((note) => {
              const kind = optionFor(noteKinds, note.kind);
              return (
                <li key={note.id} className="rounded-xl border border-border bg-white p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <Badge tone={kind.tone}>{kind.label}</Badge>
                    {showVacancy && note.vacancyTitle && <span className="font-medium text-ink">{note.vacancyTitle}</span>}
                    <span>{note.authorName}</span>
                    <time dateTime={note.createdAt}>{formatDateTime(note.createdAt)}</time>
                  </div>
                  <p className="text-sm whitespace-pre-line text-ink">{note.body}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
