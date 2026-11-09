import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToText, isSafeUrl, sanitizeHtml } from "@/lib/academy/sanitize";

test("keeps headings, lists, emphasis, links and images", () => {
  const html =
    '<h2>Start</h2><p>Read <strong>this</strong> and <em>that</em>.</p><ul><li>One</li><li>Two</li></ul>' +
    '<ol><li>A</li></ol><p><a href="https://nordavo.nl/x?a=1&amp;b=2" title="Nordavo">link</a></p>' +
    '<img src="https://cdn.example.com/a.png" alt="Team" width="300">';
  assert.equal(
    sanitizeHtml(html),
    '<h2>Start</h2><p>Read <strong>this</strong> and <em>that</em>.</p><ul><li>One</li><li>Two</li></ul>' +
      '<ol><li>A</li></ol><p><a href="https://nordavo.nl/x?a=1&amp;b=2" title="Nordavo" rel="noopener noreferrer" target="_blank">link</a></p>' +
      '<img src="https://cdn.example.com/a.png" alt="Team" width="300" loading="lazy">',
  );
});

test("removes scripts, styles, frames and event handlers", () => {
  assert.equal(sanitizeHtml('<p onclick="alert(1)">Hi</p><script>alert(1)</script>'), "<p>Hi</p>");
  assert.equal(sanitizeHtml("<style>p{color:red}</style><p style=\"color:red\">x</p>"), "<p>x</p>");
  assert.equal(sanitizeHtml('<iframe src="https://evil"></iframe>ok'), "ok");
  assert.equal(sanitizeHtml('<img src=x onerror="alert(1)">'), '<img src="x" loading="lazy">');
  assert.equal(sanitizeHtml("<svg><script>alert(1)</script></svg>after"), "after");
  assert.equal(sanitizeHtml("<SCRIPT>alert(1)</SCRIPT >x"), "x");
  assert.equal(sanitizeHtml("<!-- secret --><p>a</p>"), "<p>a</p>");
  assert.equal(sanitizeHtml("<form action=x><input></form>y"), "y");
});

test("blocks script URLs, also when hidden", () => {
  for (const href of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "javascript&#58;alert(1)",
    "&#106;avascript:alert(1)",
    "javascript&colon;alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:x",
  ]) {
    assert.ok(!isSafeUrl(href), href);
    assert.equal(sanitizeHtml(`<a href="${href}">x</a>`), "<a>x</a>", href);
  }
  assert.equal(sanitizeHtml('<img src="javascript:alert(1)">'), "");
  for (const href of ["https://nordavo.nl", "http://x.nl", "mailto:a@b.nl", "/academy", "#part", "page.html", "//cdn.nl/a"]) {
    assert.ok(isSafeUrl(href), href);
  }
  assert.ok(!isSafeUrl("mailto:a@b.nl", "src"));
});

test("unknown tags go, their text stays; stray brackets are escaped", () => {
  assert.equal(sanitizeHtml("<marquee>Hello</marquee>"), "Hello");
  assert.equal(sanitizeHtml("a < b > c & d"), "a &lt; b &gt; c &amp; d");
  assert.equal(sanitizeHtml("Tom &amp; Jerry &copy;"), "Tom &amp; Jerry &copy;");
  assert.equal(sanitizeHtml('<p class="x" id="y">a</p>'), "<p>a</p>");
  assert.equal(sanitizeHtml('<a href="https://x.nl" data-x="1" href="javascript:1">x</a>'), '<a href="https://x.nl" rel="noopener noreferrer" target="_blank">x</a>');
});

test("open tags are closed and stray closing tags dropped", () => {
  assert.equal(sanitizeHtml("<ul><li>One<li>Two"), "<ul><li>One<li>Two</li></li></ul>");
  assert.equal(sanitizeHtml("</p>text</strong>"), "text");
  assert.equal(sanitizeHtml("<p><strong>bold</p>"), "<p><strong>bold</strong></p>");
  assert.equal(sanitizeHtml("line<br/>next<br>"), "line<br>next<br>");
  assert.equal(sanitizeHtml(null), "");
});

test("attribute values are escaped", () => {
  assert.equal(sanitizeHtml(`<a href='https://x.nl/"onmouseover="x'>x</a>`), '<a href="https://x.nl/&quot;onmouseover=&quot;x" rel="noopener noreferrer" target="_blank">x</a>');
  assert.equal(sanitizeHtml('<img src="https://x.nl/a.png" width="100%">'), '<img src="https://x.nl/a.png" loading="lazy">');
});

test("plain text for previews", () => {
  assert.equal(htmlToText("<h2>Title</h2><p>One &amp; two</p><ul><li>a</li><li>b</li></ul>"), "Title\nOne & two\na\nb");
});
