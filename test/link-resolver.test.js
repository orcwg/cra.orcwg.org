const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const markdownIt = require("markdown-it");
const { resolveLinks, replaceOutsideLinks } = require("../src/_data/utils/link-resolver.js");
const { htmlToMarkdown } = require("../src/_data/utils/html-to-markdown.js");
const craReferences = require("../src/_data/craReferences.json");

const md = markdownIt({ html: true, linkify: true });

const resolve = (markdown, context) => resolveLinks(markdown, context, {}, craReferences);

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

  test("handles link titles and escaped parentheses in link urls", () => {
    const text = '[Delegated Regulation](https://eur-lex.europa.eu/?uri=PI_COM:C\\(2025\\)8407 "Title") Directive 2014/53';
    assert.equal(
      replaceOutsideLinks(text, /Directive 2014\/53/g, "X"),
      '[Delegated Regulation](https://eur-lex.europa.eu/?uri=PI_COM:C\\(2025\\)8407 "Title") X'
    );
  });

  test("returns the text unchanged when there is nothing to replace", () => {
    assert.equal(replaceOutsideLinks("no links here", /Directive \d+/g, "X"), "no links here");
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

  test("does not insert Blue Guide links inside existing links", () => {
    const markdown = "See [the Blue Guide on EU product rules](https://example.org/blue-guide).";
    assert.equal(resolve(markdown, "legislation"), markdown);
  });
});

describe("prefixed citations", () => {
  const eurLex = (celex) => `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:${celex}`;

  test("[[Article N]] without a prefix still links the CRA", () => {
    assert.deepEqual(links(resolve("See [[Article 24]].")), [{ text: "Article 24", url: `${eurLex("32024R2847")}#art_24` }]);
  });

  test("links articles, recitals and annexes of other acts by their cite key", () => {
    const result = resolve("See [[PLD Article 5]], [[AI-ACT Recital 3]], [[NIS2 Annex I]] and [[CRA Art. 13(8)]].");
    assert.deepEqual(links(result), [
      { text: "Article 5 of the PLD", url: `${eurLex("32024L2853")}#art_5` },
      { text: "Recital 3 of the AI Act", url: `${eurLex("32024R1689")}#rct_3` },
      { text: "Annex I of the NIS 2 Directive", url: `${eurLex("32022L2555")}#anx_I` },
      { text: "Article 13(8) of the CRA", url: `${eurLex("32024R2847")}#art_13` }
    ]);
  });

  test("links sections, points, examples and figures of the Commission guidance", () => {
    const result = resolve("See [[CRA-GUIDANCE Section 3.2.4]], [[CRA-GUIDANCE point 71]], [[CRA-GUIDANCE Example 1]] and [[CRA-GUIDANCE Figure 1]].");
    assert.deepEqual(links(result), [
      { text: "Section 3.2.4 of the Commission guidance", url: "/official-guidance/#sct_3.sct_2.sct_4" },
      { text: "point 71 of the Commission guidance", url: "/official-guidance/#pnt_71" },
      { text: "Example 1 of the Commission guidance", url: "/official-guidance/#exm_1" },
      { text: "Figure 1 of the Commission guidance", url: "/official-guidance/#fgr_1" }
    ]);
    assert.match(result, /"📜 Official CRA Guidance - Section 3\.2\.4 - Donations"/);
  });

  test("the prefix is not case sensitive", () => {
    assert.deepEqual(links(resolve("[[pld article 5]]")).map(link => link.url), [`${eurLex("32024L2853")}#art_5`]);
  });

  test("leaves unknown documents and parts as written", () => {
    for (const markdown of ["[[GDPR Article 5]]", "[[CRA-GUIDANCE Section 99.9]]", "[[CRA-GUIDANCE point 9999]]", "[[PLD Section 2]]"]) {
      assert.equal(resolve(markdown), markdown);
    }
  });

  test("does not mistake FAQ and list references for prefixed citations", () => {
    for (const markdown of ["[[maintainers/should-i-worry]]", "[[stewards]]", "[[Annex I, Part I]]"]) {
      assert.doesNotMatch(resolve(markdown), /of the/);
    }
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
});
