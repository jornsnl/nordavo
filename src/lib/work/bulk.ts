/** The message after completing a selection of tasks: "3 tasks done, 1 sent to review." */
export function bulkDoneText({ done, review, failed }: { done: number; review: number; failed: number }): string {
  const tasks = (n: number) => `${n} task${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (done) parts.push(`${tasks(done)} done`);
  if (review) parts.push(`${done ? review : tasks(review)} sent to review`);
  if (failed) parts.push(`${done || review ? failed : tasks(failed)} could not be changed`);
  if (parts.length === 0) return "Nothing changed.";
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
