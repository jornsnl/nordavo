// Word level diff for the content editor: the compare view of versions, and
// turning a reviewer's edit (suggestion mode) into separate suggestions the
// author accepts or rejects one by one. Pure, safe for client components,
// unit tested in tests/content.test.ts.

export type DiffOp = { type: "equal" | "insert" | "delete"; text: string };

/** Words, runs of whitespace and punctuation, so a diff never splits a word. */
export function tokenize(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

/** Longest common subsequence over tokens. Texts here are at most a few thousand words. */
export function diffWords(before: string, after: string): DiffOp[] {
  const a = tokenize(before);
  const b = tokenize(after);

  // Trim the common start and end first: most edits are small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const ops: DiffOp[] = [];
  push(ops, "equal", a.slice(0, start).join(""));

  if (midA.length * midB.length > 4_000_000) {
    // Too large for a table: show it as one replacement.
    push(ops, "delete", midA.join(""));
    push(ops, "insert", midB.join(""));
  } else {
    const n = midA.length;
    const m = midB.length;
    const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        push(ops, "equal", midA[i]);
        i++;
        j++;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        push(ops, "delete", midA[i]);
        i++;
      } else {
        push(ops, "insert", midB[j]);
        j++;
      }
    }
    while (i < n) push(ops, "delete", midA[i++]);
    while (j < m) push(ops, "insert", midB[j++]);
  }

  push(ops, "equal", a.slice(endA).join(""));
  return ops;
}

function push(ops: DiffOp[], type: DiffOp["type"], text: string) {
  if (!text) return;
  const last = ops[ops.length - 1];
  if (last && last.type === type) last.text += text;
  else ops.push({ type, text });
}

export type TextChange = {
  /** Offset in the original text, in UTF-16 code units (JavaScript string index). */
  start: number;
  original: string;
  replacement: string;
};

/**
 * The separate changes between the original and the edited text. Neighbouring
 * deletes and inserts become one replacement; changes separated only by a
 * single space are merged, so "a b c" to "x y z" is one suggestion.
 */
export function changesBetween(original: string, edited: string): TextChange[] {
  const ops = diffWords(original, edited);
  const changes: TextChange[] = [];
  let offset = 0;
  let current: TextChange | null = null;

  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.type === "equal") {
      const next = ops[k + 1];
      if (current && next && next.type !== "equal" && /^\s{1,2}$/.test(op.text)) {
        current.original += op.text;
        current.replacement += op.text;
      } else if (current) {
        changes.push(current);
        current = null;
      }
      offset += op.text.length;
      continue;
    }
    if (!current) current = { start: offset, original: "", replacement: "" };
    if (op.type === "delete") {
      current.original += op.text;
      offset += op.text.length;
    } else {
      current.replacement += op.text;
    }
  }
  if (current) changes.push(current);
  return changes.filter((c) => c.original !== c.replacement);
}

/** Apply one change; null when the original text is no longer at its place. */
export function applyChange(text: string, change: TextChange): string | null {
  if (text.slice(change.start, change.start + change.original.length) !== change.original) return null;
  return text.slice(0, change.start) + change.replacement + text.slice(change.start + change.original.length);
}

/**
 * Converts a JavaScript string offset to a Postgres character offset (code
 * points), which is what substr() in the database counts. They differ only
 * for characters outside the basic plane, such as emoji.
 */
export function toCodePointOffset(text: string, utf16Offset: number): number {
  return Array.from(text.slice(0, utf16Offset)).length;
}

export function fromCodePointOffset(text: string, codePointOffset: number): number {
  return Array.from(text).slice(0, codePointOffset).join("").length;
}
