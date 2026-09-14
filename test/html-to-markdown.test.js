const { test } = require("node:test");
const assert = require("node:assert/strict");
const { htmlToMarkdown, htmlToText, absolutizeLinks } = require("../src/_data/utils/html-to-markdown.js");

test("htmlToMarkdown converts paragraphs, emphasis and links", () => {
  const html = '<p>See <strong>Art. 14</strong> and the <a href="https://example.org/glossary">SRP Glossary</a>.</p>\n<p>Second <em>paragraph</em>.</p>';
  assert.equal(
    htmlToMarkdown(html),
    "See **Art. 14** and the [SRP Glossary](https://example.org/glossary).\n\nSecond _paragraph_."
  );
});

test("htmlToMarkdown converts non-breaking spaces to regular spaces", () => {
  assert.equal(htmlToMarkdown("<p>in accordance with&nbsp;Art. 14(7)&nbsp;</p>"), "in accordance with Art. 14(7)");
});

test("htmlToMarkdown keeps line breaks as Markdown hard breaks", () => {
  assert.equal(htmlToMarkdown("<p>First line<br>Second line</p>"), "First line\\\nSecond line");
});

test("htmlToMarkdown converts nested lists", () => {
  const html = "<ul><li>Final Report:<ul><li>For vulnerabilities</li><li>For incidents</li></ul></li></ul>";
  const markdown = htmlToMarkdown(html);
  assert.match(markdown, /^-\s+Final Report:/);
  assert.match(markdown, /\n\s+-\s+For vulnerabilities\n\s+-\s+For incidents$/);
});

test("htmlToMarkdown drops line breaks that end a block", () => {
  assert.match(htmlToMarkdown("<ul><li>First<br>&nbsp;</li><li>Second</li></ul>"), /^-\s+First\n+-\s+Second$/);
  assert.equal(htmlToMarkdown("<p>Last line<br></p><p>Next</p>"), "Last line\n\nNext");
  assert.equal(htmlToMarkdown("<p>Ends with a break<br>&nbsp;</p>"), "Ends with a break");
});

test("htmlToMarkdown keeps literal backslashes", () => {
  assert.equal(htmlToMarkdown("<p>C:\\</p>"), "C:\\\\");
});

test("htmlToMarkdown converts strikethrough", () => {
  assert.equal(htmlToMarkdown("<p>Art. 14(<s>3</s>1)</p>"), "Art. 14(~~3~~1)");
});

test("htmlToMarkdown handles empty input", () => {
  assert.equal(htmlToMarkdown(""), "");
  assert.equal(htmlToMarkdown(undefined), "");
});

test("htmlToText returns single-line text without Markdown escapes", () => {
  assert.equal(
    htmlToText("4. &nbsp;[UPDATED] When will the *platform*\n be operational?"),
    "4. [UPDATED] When will the *platform* be operational?"
  );
});

test("absolutizeLinks makes root-relative links absolute", () => {
  const html = '<a href="/topics/manual">Manual</a> <a href="https://other.org/x">Other</a> <a href="#top">Top</a>';
  assert.equal(
    absolutizeLinks(html, "https://www.enisa.europa.eu/topics/faq"),
    '<a href="https://www.enisa.europa.eu/topics/manual">Manual</a> <a href="https://other.org/x">Other</a> <a href="#top">Top</a>'
  );
});
