import "server-only";

/**
 * All rows, with the pages after the first fetched at the same time: the
 * count comes with the first page, so 5,000 rows take two round trips
 * instead of five (docs/sales.md, Snelheid). The query must have a stable
 * order (created_at, id).
 */
export async function allParallel<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null; count?: number | null }>,
  max = 50000,
): Promise<T[]> {
  const first = await page(0, 999);
  if (first.error) throw new Error(first.error.message);
  const rows = [...(first.data ?? [])];
  const total = Math.min(first.count ?? rows.length, max);
  if (rows.length < 1000 || total <= 1000) return rows;
  const pages = [];
  for (let from = 1000; from < total; from += 1000) pages.push(page(from, from + 999));
  for (const result of await Promise.all(pages)) {
    if (result.error) throw new Error(result.error.message);
    rows.push(...(result.data ?? []));
  }
  return rows;
}
