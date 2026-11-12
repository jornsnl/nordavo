/**
 * Forgiving text matching for the global search (pages, and as a second
 * opinion on records): "vacatures", "vacncies" and "vac" all find
 * Vacancies. Pure, so it runs the same on the server and in the browser.
 */

/** Lower case, without accents, only letters and digits separated by single spaces. */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Edit distance with swapped neighbours counting as one edit (optimal string alignment). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** How many typos a word of this length may have. */
function allowedEdits(length: number): number {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  return 2;
}

/** Best match of one query word against the words of the text: 1 exact, lower for prefixes and typos, 0 none. */
function wordScore(word: string, words: string[]): number {
  let best = 0;
  const allowed = allowedEdits(word.length);
  for (const candidate of words) {
    if (candidate === word) return 1;
    if (candidate.startsWith(word)) {
      best = Math.max(best, 0.85 + 0.1 * (word.length / candidate.length));
      continue;
    }
    if (allowed === 0) continue;
    // A typo in the whole word, or in the part typed so far ("vacnc" for "vacancies").
    const whole = editDistance(word, candidate);
    const prefix = editDistance(word, candidate.slice(0, word.length));
    const edits = Math.min(whole, prefix);
    if (edits <= allowed) best = Math.max(best, 0.75 - 0.1 * edits - (whole <= allowed ? 0 : 0.05));
  }
  return best;
}

/** Characters of the query in order inside the text ("cndts" in "candidates"). */
function isSubsequence(query: string, text: string): boolean {
  let i = 0;
  for (const char of text) {
    if (char === query[i]) i++;
    if (i === query.length) return true;
  }
  return i === query.length;
}

/**
 * How well the query matches the text, from 0 (no match) to 1 (the same).
 * Every word of the query has to match a word of the text, as a prefix or
 * with a typo or two (depending on its length).
 */
export function fuzzyScore(query: string, text: string): number {
  const q = normalizeSearch(query);
  const t = normalizeSearch(text);
  if (!q || !t) return 0;
  if (q === t) return 1;
  // A shorter text that starts with the query is the closer match ("cal": Calls before Call lists).
  if (t.startsWith(q)) return 0.9 + 0.09 * (q.length / t.length);
  const words = t.split(" ");
  if (words.some((w) => w.startsWith(q))) return 0.85 + 0.04 * (q.length / t.length);
  if (t.includes(q)) return 0.8;

  const queryWords = q.split(" ");
  const scores = queryWords.map((w) => wordScore(w, words));
  if (scores.every((s) => s > 0)) return Math.min(0.79, scores.reduce((a, b) => a + b, 0) / scores.length);

  const compact = q.replace(/ /g, "");
  if (compact.length >= 3 && isSubsequence(compact, t.replace(/ /g, ""))) return 0.4;
  return 0;
}

/** The items that match, best first; ties keep their order. */
export function fuzzyFilter<T>(query: string, items: T[], text: (item: T) => string | string[], min = 0.35): T[] {
  return items
    .map((item, index) => {
      const texts = text(item);
      const score = Math.max(...(Array.isArray(texts) ? texts : [texts]).map((t) => fuzzyScore(query, t)));
      return { item, index, score };
    })
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.item);
}
