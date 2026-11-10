import { listMyContentWorkspaces } from "@/lib/content/data";
import { loadReviewerCounts, parseMonth, toCsv } from "@/lib/content/results";

/** CSV of the reviewer count for one month (never several months added up). */
export async function GET(request: Request) {
  const month = parseMonth(new URL(request.url).searchParams.get("month") ?? undefined);
  const workspaces = (await listMyContentWorkspaces()).filter(
    (w) => (w.role === "admin" || w.role === "reviewer") && w.modules.reviewer_count,
  );
  if (workspaces.length === 0) return new Response("Not found", { status: 404 });
  const rows = await loadReviewerCounts(month, workspaces);
  const csv = toCsv([
    ["month", "workspace", "reviewer", "reviewed", "published"],
    ...rows.map((r) => [month, r.workspaceName, r.reviewerName, r.reviewed, r.published]),
  ]);
  return new Response(`${csv}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reviewer-count-${month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
