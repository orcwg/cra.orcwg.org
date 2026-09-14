const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const markdownIt = require("markdown-it");
const { resolveLinks, replaceOutsideLinks } = require("../src/_data/utils/link-resolver.js");
const { htmlToMarkdown } = require("../src/_data/utils/html-to-markdown.js");
const craReferences = require("../src/_data/craReferences.json");

const md = markdownIt({ html: true, linkify: true });

// Minimal internal link index, as built by createInternalLinkIndex in data.js
const internalLinks = {
  "srp/faq_21": { permalink: "/faq/srp/faq_21/", _pageTitle: "Can the dissemination of a report be delayed or withheld?" },
  "official/faq_5-1": { permalink: "/faq/official/faq_5-1/", _pageTitle: "How can a manufacturer become aware of an actively exploited vulnerability or a severe incident?" },
  "official/faq_5-3": { permalink: "/faq/official/faq_5-3/", _pageTitle: "Does the reporting obligation apply to products placed on the market before 11 December 2027?" },
  "official/faq_5-4": { permalink: "/faq/official/faq_5-4/", _pageTitle: "Actively exploited vulnerability contained in a third-party component" }
};

const resolve = (markdown, context) => resolveLinks(markdown, context, internalLinks, craReferences);

// Extract [text](url) pairs from Markdown, ignoring link titles
const links = (markdown) => [...markdown.matchAll(/\[([^\]]+)\]\((\S+)(?: "[^"]*")?\)/g)].map(([, text, url]) => ({ text, url }));

describe("replaceOutsideLinks", () => {
  test("replaces matches outside links only", () => {
    const text = "Directive 2014/53 and [the Directive 2014/53 page](https://example.org/a) and Directive 2014/53";
    assert.equal(
      replaceOutsideLinks(text, /Directive 2014\/53/g, "X"),
      "X and [the Directive 2014/53 page](https://example.org/a) and X"
    );
  });

  test("handles escaped parentheses in link urls", () => {
    const text = "[Delegated Regulation](https://eur-lex.europa.eu/?uri=PI_COM:C\\(2025\\)8407) FAQ 21";
    assert.equal(
      replaceOutsideLinks(text, /FAQ 21/g, "X"),
      "[Delegated Regulation](https://eur-lex.europa.eu/?uri=PI_COM:C\\(2025\\)8407) X"
    );
  });

  test("returns the text unchanged when there is nothing to replace", () => {
    assert.equal(replaceOutsideLinks("no links here", /FAQ \d+/g, "X"), "no links here");
  });
});

describe("EU regulation links", () => {
  test("links regulations mentioned in plain text", () => {
    const result = resolve("Products covered by Regulation (EU) 2024/2847 must comply.", "cra-basics");
    assert.deepEqual(links(result).map(link => link.url), ["https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R2847"]);
  });

  test("does not insert links inside existing links", () => {
    const markdown = "In scope of the [Delegated Regulation adopted under the Radio Equipment Directive 2014/53/EU](https://single-market-economy.ec.europa.eu/rdr.pdf) (RED Delegated Regulation).";
    assert.equal(resolve(markdown, "cra-basics"), markdown);
  });
});

describe("ENISA SRP FAQ cross-references", () => {
  test("links references to other SRP FAQs", () => {
    const result = resolve("More detailed information is provided in FAQ 21.", "srp");
    assert.deepEqual(links(result), [{ text: "FAQ 21", url: "/faq/srp/faq_21/" }]);
  });

  test("leaves references to unknown SRP FAQs unchanged", () => {
    assert.equal(resolve("See FAQ 99 for details.", "srp"), "See FAQ 99 for details.");
  });

  test("links references to sections of the Commission's FAQ", () => {
    const result = resolve("See Section 5.4 of the Commission's FAQ.", "srp");
    assert.deepEqual(links(result), [{ text: "5.4", url: "/faq/official/faq_5-4/" }]);
  });

  test("links both sections in 'subsections 5.1 & 5.3'", () => {
    const result = resolve("before 11 September 2026 (subsections 5.1 & 5.3).", "srp");
    assert.deepEqual(links(result), [
      { text: "5.1", url: "/faq/official/faq_5-1/" },
      { text: "5.3", url: "/faq/official/faq_5-3/" }
    ]);
    assert.match(result, /^before 11 September 2026 \(subsections \[5\.1\]/);
  });

  test("leaves references to unknown Commission FAQ sections unchanged", () => {
    assert.equal(resolve("Section 9.1 provides detailed guidance.", "srp"), "Section 9.1 provides detailed guidance.");
  });

  test("does not link SRP references outside the SRP FAQs", () => {
    const markdown = "See FAQ 21 and subsection 5.1.";
    assert.equal(resolve(markdown, "cra-basics"), markdown);
    assert.equal(resolve(markdown, "maintainers"), markdown);
  });

  test("does not insert cross-reference links inside existing links", () => {
    const markdown = "See [FAQ 21 on ENISA's website](https://www.enisa.europa.eu/faq#21).";
    assert.equal(resolve(markdown, "srp"), markdown);
  });

  test("links parenthetical CRA article references", () => {
    const result = resolve("Notifications are submitted to the relevant CSIRT (Article 14(7)).", "srp");
    assert.deepEqual(links(result).map(link => link.text), ["Article 14(7)"]);
    assert.match(links(result)[0].url, /#art_14$/);
  });
});

describe("rendering answers fetched as HTML", () => {
  const render = (html, context) => md.render(resolve(htmlToMarkdown(html), context));

  test("inserted links are rendered instead of shown as literal Markdown", () => {
    const html = "<p>Products covered by Regulation (EU) 2024/2847 must comply.</p>";

    // Without conversion, markdown-it leaves the raw HTML block untouched
    assert.match(md.render(resolve(html, "cra-basics")), /\]\(https:\/\/eur-lex/);

    const rendered = render(html, "cra-basics");
    assert.match(rendered, /<a href="https:\/\/eur-lex\.europa\.eu\/legal-content\/EN\/TXT\/\?uri=CELEX:32024R2847"/);
    assert.doesNotMatch(rendered, /\]\(/);
  });

  test("existing links containing regulation references render as a single link", () => {
    const html = '<p>In scope of the&nbsp;<a href="https://single-market-economy.ec.europa.eu/rdr.pdf">Delegated Regulation adopted under the Radio Equipment Directive 2014/53/EU</a>&nbsp;(RED Delegated Regulation).</p>';
    assert.equal(
      render(html, "cra-basics"),
      '<p>In scope of the <a href="https://single-market-economy.ec.europa.eu/rdr.pdf">Delegated Regulation adopted under the Radio Equipment Directive 2014/53/EU</a> (RED Delegated Regulation).</p>\n'
    );
  });

  test("SRP cross-references render as links", () => {
    const rendered = render("<p>More detailed information on delayed dissemination is provided in FAQ 21.</p>", "srp");
    assert.match(rendered, /<a href="\/faq\/srp\/faq_21\/" title="[^"]*">FAQ 21<\/a>/);
  });
});
