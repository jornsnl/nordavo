// Dev and data roles for the follow notification (feedback Julius, 9eb8d313).
// Mirrors public.sales_is_dev_data_title() in
// supabase/migrations/20261123440000_follow_vacancies.sql. Pure.

const pattern = new RegExp(
  [
    "develop", "ontwikkel", "engineer", "programm", "software", "\\bcoder\\b", "devops", "\\bsre\\b",
    "front[ -]?end", "back[ -]?end", "full[ -]?stack", "\\bjava\\b", "\\.net", "\\bc#", "python", "\\bphp\\b",
    "golang", "\\bgo\\b developer", "kotlin", "swift", "\\bios\\b", "android", "react", "angular", "\\bvue", "node",
    "typescript", "javascript", "\\bcloud\\b", "architect", "\\btester\\b", "\\btest ?automation", "\\bqa\\b",
    "\\bdata\\b", "\\bbi\\b", "business intelligence", "analist", "analyst", "scientist", "machine learning",
    "\\bml\\b", "\\bai\\b", "power ?bi", "\\bsql\\b", "databricks", "snowflake", "\\betl\\b", "tableau",
  ].join("|"),
  "i",
);

/** Whether a vacancy title is a dev or data role. */
export function isDevDataTitle(title: string | null | undefined): boolean {
  return Boolean(title) && pattern.test(title as string);
}
