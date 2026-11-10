import { diffWords } from "@/lib/content/diff";
import { textFields } from "@/lib/content/rules";
import type { ContentTextField } from "@/lib/content/database";

type VersionText = Record<ContentTextField, string>;

/** Two versions side by side as one text: removed words struck through, added words highlighted. */
export function VersionCompare({ before, after }: { before: VersionText; after: VersionText }) {
  return (
    <div className="space-y-4">
      {textFields.map(({ value: field, label }) => {
        const ops = diffWords(before[field], after[field]);
        const changed = ops.some((o) => o.type !== "equal");
        if (!before[field] && !after[field]) return null;
        return (
          <section key={field} className="rounded-2xl border border-border bg-white p-4">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
              {label}
              {!changed && <span className="font-medium normal-case">unchanged</span>}
            </h3>
            <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">
              {ops.map((op, i) =>
                op.type === "equal" ? (
                  <span key={i}>{op.text}</span>
                ) : op.type === "delete" ? (
                  <del key={i} className="bg-danger-bg text-danger">
                    {op.text}
                  </del>
                ) : (
                  <ins key={i} className="bg-emerald-50 text-emerald-800 no-underline">
                    {op.text}
                  </ins>
                ),
              )}
            </p>
          </section>
        );
      })}
    </div>
  );
}
