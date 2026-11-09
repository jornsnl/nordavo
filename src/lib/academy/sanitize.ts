// HTML of the explanation block (Academy: lesblokken, Uitleg): headings,
// paragraphs, lists, emphasis, links, images, quotes and code. Everything
// else is removed. Runs on save (server action) and again before rendering,
// so stored HTML from any source is safe to show. Pure, no DOM needed;
// tested in tests/academy-sanitize.test.ts.

const ALLOWED_TAGS = new Set([
  "h2", "h3", "h4", "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "sub", "sup",
  "ul", "ol", "li", "a", "img", "blockquote", "code", "pre", "figure", "figcaption", "span", "div",
]);

const VOID_TAGS = new Set(["br", "hr", "img"]);

/** Tags removed together with their content. */
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "object", "embed", "noscript", "template", "textarea", "select",
  "svg", "math", "title", "head", "frame", "frameset", "applet", "audio", "video", "canvas", "form", "button",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", colon: ":", tab: "\t", newline: "\n",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

/** A link or image address that cannot run script: http(s), mailto, tel or a relative path. */
export function isSafeUrl(raw: string, kind: "href" | "src" = "href"): boolean {
  // Control characters and spaces can hide a scheme ("java script:"), so they go first.
  const value = decodeEntities(raw).replace(/[\u0000- \u007f-\u009f]/g, "");
  if (value === "") return false;
  if (/^https?:/i.test(value)) return true;
  if (kind === "href" && /^(mailto|tel):/i.test(value)) return true;
  if (value.startsWith("//")) return true;
  if (/^[/#?]/.test(value)) return true;
  // Relative without a scheme ("page", "images/a.png").
  return !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

const TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Allowed attributes, or null when the tag must go (an image without a safe source). */
function cleanAttributes(tag: string, raw: string): string | null {
  const allowed = ALLOWED_ATTRS[tag];
  if (!allowed) return "";
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of raw.matchAll(ATTR)) {
    const name = match[1].toLowerCase();
    if (!allowed.has(name) || seen.has(name)) continue;
    const value = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    if ((name === "href" || name === "src") && !isSafeUrl(value, name)) continue;
    if ((name === "width" || name === "height") && !/^\d{1,4}$/.test(value)) continue;
    seen.add(name);
    out.push(`${name}="${escapeAttr(value)}"`);
  }
  if (tag === "a" && seen.has("href")) {
    out.push('rel="noopener noreferrer"', 'target="_blank"');
  }
  if (tag === "img") {
    if (!seen.has("src")) return null;
    out.push('loading="lazy"');
  }
  return out.length > 0 ? ` ${out.join(" ")}` : "";
}

/** Sanitize rich text HTML to the explanation block's allow list. */
export function sanitizeHtml(input: string | null | undefined): string {
  if (!input) return "";
  const html = String(input).slice(0, 500_000);
  let out = "";
  const stack: string[] = [];
  let i = 0;

  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      if (html.startsWith("<!--", i)) {
        const end = html.indexOf("-->", i + 4);
        i = end === -1 ? html.length : end + 3;
        continue;
      }
      if (html.startsWith("<!", i) || html.startsWith("<?", i)) {
        const end = html.indexOf(">", i);
        i = end === -1 ? html.length : end + 1;
        continue;
      }
      const match = TAG.exec(html.slice(i));
      if (!match) {
        out += "&lt;";
        i += 1;
        continue;
      }
      i += match[0].length;
      const closing = match[1] === "/";
      const tag = match[2].toLowerCase();

      if (DROP_WITH_CONTENT.has(tag)) {
        if (!closing && match[4] !== "/") {
          const close = new RegExp(`</${tag}\\s*>`, "i").exec(html.slice(i));
          i = close ? i + close.index + close[0].length : html.length;
        }
        continue;
      }
      if (!ALLOWED_TAGS.has(tag)) continue;

      if (closing) {
        if (VOID_TAGS.has(tag)) continue;
        const at = stack.lastIndexOf(tag);
        if (at === -1) continue;
        while (stack.length > at) out += `</${stack.pop()}>`;
        continue;
      }
      const attrs = cleanAttributes(tag, match[3] ?? "");
      if (attrs === null) continue;
      if (VOID_TAGS.has(tag)) {
        out += `<${tag}${attrs}>`;
      } else {
        out += `<${tag}${attrs}>`;
        stack.push(tag);
      }
      continue;
    }
    if (ch === ">") {
      out += "&gt;";
      i += 1;
      continue;
    }
    if (ch === "&") {
      const entity = /^&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/i.exec(html.slice(i, i + 12));
      if (entity) {
        out += entity[0];
        i += entity[0].length;
      } else {
        out += "&amp;";
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  while (stack.length > 0) out += `</${stack.pop()}>`;
  return out;
}

/** Plain text of sanitized HTML (search, previews, the AI prompt later). */
export function htmlToText(html: string): string {
  return decodeEntities(
    sanitizeHtml(html)
      .replace(/<(br|\/p|\/h[2-4]|\/li|\/blockquote|\/pre|hr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
