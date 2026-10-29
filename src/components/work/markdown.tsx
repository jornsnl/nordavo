import { Fragment, type ReactNode } from "react";
import { MENTION_RE } from "@/lib/work/mentions";

/**
 * Small, safe Markdown for task descriptions and comments: headings, lists,
 * quotes, code, bold, italic, links and @mentions. Builds React elements, so
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
        <pre key={key++} className="overflow-x-auto rounded-lg bg-surface px-3 py-2 font-mono text-xs">
          {code.join("\n")}
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
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

    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      const itemRe = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      while (i < lines.length && itemRe.test(lines[i])) items.push(itemRe.exec(lines[i++])![1]);
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={key++} className={`space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((item, n) => (
            <li key={n}>{inline(item)}</li>
          ))}
        </List>,
      );
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
      !/^```|^#{1,3}\s|^\s*[-*]\s+|^\s*\d+[.)]\s+|^>/.test(lines[i])
    ) {
      paragraph.push(lines[i++]);
    }
    out.push(<p key={key++}>{withBreaks(paragraph)}</p>);
  }
  return out;
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
    "\\*\\*([^*]+)\\*\\*",
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
    const [, code, mentionName, , linkText, linkUrl, bold, italic, underscored, bare] = m;
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
    } else if (bold !== undefined) {
      out.push(<strong key={key++}>{inline(bold)}</strong>);
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
