import { Fragment, type ReactNode } from "react";
import { MENTION_RE } from "@/lib/work/mentions";

/**
 * Small, safe Markdown for task descriptions and comments: headings, lists
 * (nested by indenting, and - [ ] checklists), quotes, code, rules, bold,
 * italic, strikethrough, links and @mentions. Builds React elements, so
 * nothing in the text is ever treated as HTML. Links only open http(s) and
 * mailto addresses.
 */
export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  return <div className={`space-y-2 text-sm leading-relaxed break-words text-ink ${className}`}>{blocks(text)}</div>;
}

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(
        <pre key={key++} className="relative overflow-x-auto rounded-lg bg-surface px-3 py-2 font-mono text-xs">
          {code.join("\n")}
        </pre>,
      );
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={key++} className="border-border" />);
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const size = heading[1].length === 1 ? "text-base" : "text-sm";
      out.push(
        <p key={key++} className={`font-display font-semibold text-brand-900 ${size}`}>
          {inline(heading[2])}
        </p>,
      );
      i++;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const items: ListLine[] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i])) {
        const [, indent, marker, text] = LIST_ITEM.exec(lines[i++])!;
        items.push({ indent: indent.replace(/\t/g, "  ").length, ordered: /\d/.test(marker), text });
      }
      // A switch between - and 1. at the same depth starts a new list.
      for (let at = 0; at < items.length; ) {
        const [list, next] = buildList(items, at, items[at].indent);
        out.push(<Fragment key={key++}>{list}</Fragment>);
        at = next;
      }
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
      out.push(
        <blockquote key={key++} className="border-l-2 border-brand-200 pl-3 text-muted">
          {withBreaks(quote)}
        </blockquote>,
      );
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```|^#{1,6}\s|^>/.test(lines[i]) &&
      !LIST_ITEM.test(lines[i])
    ) {
      paragraph.push(lines[i++]);
    }
    out.push(<p key={key++}>{withBreaks(paragraph)}</p>);
  }
  return out;
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

type ListLine = { indent: number; ordered: boolean; text: string };

/** One list and the lists nested under its items (indented by two spaces or more), from items[start]. */
function buildList(items: ListLine[], start: number, indent: number): [ReactNode, number] {
  const ordered = items[start].ordered;
  const entries: { text: string; children: ReactNode[] }[] = [];
  let i = start;
  while (i < items.length && items[i].indent >= indent) {
    if (items[i].indent === indent && items[i].ordered !== ordered && entries.length > 0) break;
    if (items[i].indent > indent && entries.length > 0) {
      const [child, next] = buildList(items, i, items[i].indent);
      entries[entries.length - 1].children.push(child);
      i = next;
      continue;
    }
    entries.push({ text: items[i].text, children: [] });
    i++;
  }
  const List = ordered ? "ol" : "ul";
  const list = (
    <List key={start} className={`space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
      {entries.map((entry, n) => {
        const check = /^\[([ xX])\]\s+(.*)$/.exec(entry.text);
        return (
          <li key={n} className={check ? "-ml-5 list-none" : undefined}>
            {check ? (
              <span className="inline-flex items-start gap-2">
                <input type="checkbox" checked={check[1] !== " "} readOnly disabled className="mt-1 size-3.5 rounded border-border" />
                <span className={check[1] !== " " ? "text-muted line-through" : undefined}>{inline(check[2])}</span>
              </span>
            ) : (
              inline(entry.text)
            )}
            {entry.children.length > 0 && <div className="mt-1 space-y-1">{entry.children}</div>}
          </li>
        );
      })}
    </List>
  );
  return [list, i];
}

function withBreaks(lines: string[]): ReactNode {
  return lines.map((line, n) => (
    <Fragment key={n}>
      {n > 0 && <br />}
      {inline(line)}
    </Fragment>
  ));
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

// Order matters: code first, so nothing inside backticks is formatted.
const TOKEN = new RegExp(
  [
    "`([^`]+)`",
    MENTION_RE.source,
    "\\[([^\\]]+)\\]\\(([^)\\s]+)\\)",
    "\\*\\*\\*([^*]+)\\*\\*\\*",
    "\\*\\*([^*]+)\\*\\*",
    "(?<!\\w)__([^_\\n]+)__(?!\\w)",
    "~~([^~\\n]+)~~",
    "(?<![\\w*])\\*([^*\\n]+)\\*(?![\\w*])",
    "(?<!\\w)_([^_\\n]+)_(?!\\w)",
    "(https?:\\/\\/[^\\s<>()]+[^\\s<>().,;:!?'\"])",
  ].join("|"),
  "gi",
);

export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(TOKEN)) {
    const index = m.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const [, code, mentionName, , linkText, linkUrl, boldItalic, bold, boldUnderscored, strike, italic, underscored, bare] = m;
    if (code !== undefined) {
      out.push(
        <code key={key++} className="rounded bg-surface px-1 py-0.5 font-mono text-[0.85em]">
          {code}
        </code>,
      );
    } else if (mentionName !== undefined) {
      out.push(
        <span key={key++} className="rounded bg-brand-50 px-1 font-medium text-brand-700">
          @{mentionName}
        </span>,
      );
    } else if (linkText !== undefined) {
      out.push(
        SAFE_URL.test(linkUrl) ? (
          <a key={key++} href={linkUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-700 underline">
            {linkText}
          </a>
        ) : (
          linkText
        ),
      );
    } else if (boldItalic !== undefined) {
      out.push(
        <strong key={key++}>
          <em>{inline(boldItalic)}</em>
        </strong>,
      );
    } else if (bold !== undefined || boldUnderscored !== undefined) {
      out.push(<strong key={key++}>{inline(bold ?? boldUnderscored)}</strong>);
    } else if (strike !== undefined) {
      out.push(<s key={key++}>{inline(strike)}</s>);
    } else if (italic !== undefined || underscored !== undefined) {
      out.push(<em key={key++}>{inline(italic ?? underscored)}</em>);
    } else if (bare !== undefined) {
      out.push(
        <a key={key++} href={bare} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-700 underline">
          {bare}
        </a>,
      );
    }
    last = index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
