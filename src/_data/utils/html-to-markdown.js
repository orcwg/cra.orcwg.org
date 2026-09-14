/**
 * HTML to Markdown conversion for FAQ content fetched from external web pages
 *
 * The link resolver inserts Markdown links (e.g. for CRA articles or EU
 * regulations) into answers before they are rendered with markdown-it.
 * markdown-it leaves the content of raw HTML blocks untouched, so answers
 * fetched as HTML must be converted to Markdown first, otherwise those links
 * show up as literal text.
 */

const TurndownService = require("turndown");

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  emDelimiter: "_",
  strongDelimiter: "**",
  br: "\\"
});

turndown.addRule("strikethrough", {
  filter: ["s", "del"],
  replacement: (content) => `~~${content}~~`
});

// Convert an HTML fragment to Markdown
function htmlToMarkdown(html) {
  return turndown.turndown(html || "")
    .replace(/ /g, " ")     // non-breaking spaces
    .replace(/[ \t]+$/gm, "")    // trailing whitespace
    // A line break ending a block (e.g. "<br>&nbsp;</li>") is not a valid Markdown
    // hard break and would render as a literal backslash: drop it
    .replace(/(?<!\\)\\(?=\n[ \t]*(?:\n|[-*+][ \t]|\d+\.[ \t])|\s*$)/g, "")
    .trim();
}

// Convert an HTML fragment to single-line plain text
function htmlToText(html) {
  return htmlToMarkdown(html)
    .replace(/\\([\\`*_{}\[\]()#+\-.!])/g, "$1")  // unescape Markdown escapes
    .replace(/\s+/g, " ")
    .trim();
}

// Make root-relative links absolute so they keep working on our site
function absolutizeLinks(html, baseUrl) {
  const origin = new URL(baseUrl).origin;
  return html.replace(/href="(\/[^"]*)"/g, (match, href) => `href="${origin}${href}"`);
}

module.exports = {
  htmlToMarkdown,
  htmlToText,
  absolutizeLinks
};
