const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const markdownIt = require("markdown-it");
const { resolveLinks, replaceOutsideLinks } = require("../src/_data/utils/link-resolver.js");
const { htmlToMarkdown } = require("../src/_data/utils/html-to-markdown.js");
const craReferences = require("../src/_data/eu-reg-titles.json")["2024/2847"];

const md = markdownIt({ html: true, linkify: true });

const resolve = (markdown, context) => resolveLinks(markdown, context, {}, craReferences);

// Extract [text](url) pairs from Markdown, ignoring link titles
const links = (markdown) => [...markdown.matchAll(/\[([^\]]+)\]\((\S+)(?: "[^"]*")?\)/g)].map(([, text, url]) => ({ text, url }));

// Reduce every [text](url "title") link to [text], to check the text around them
const linkText = (markdown) => markdown.replace(/\[([^\]]+)\]\(\S+(?: "[^"]*")?\)/g, "[$1]");

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
    assert.match(result, /"🇪🇺 Official CRA Guidance - Section 3\.2\.4 - Donations"/);
  });

  test("links any act in eu-reg.json by its number, named as in its full title", () => {
    const result = resolve("See [[168/2013 Article 1]], [[2022/30 Annex I]] and [[2014/53 Recital 2]].");
    assert.deepEqual(links(result), [
      { text: "Article 1 of Regulation (EU) No 168/2013", url: `${eurLex("32013R0168")}#art_1` },
      { text: "Annex I of Commission Delegated Regulation (EU) 2022/30", url: `${eurLex("32022R0030")}#anx_I` },
      { text: "Recital 2 of Directive 2014/53/EU", url: `${eurLex("32014L0053")}#rct_2` }
    ]);
  });

  test("a prefixed citation carries the article or annex title when eu-reg-titles.json has it", () => {
    assert.match(resolve("[[PLD Article 5]]"), /"⚖️ New Product Liability Directive \(PLD 2024\) - Article 5 - Right to compensation"/);
    assert.match(resolve("[[AI-ACT Annex III]]"), /"⚖️ Artificial Intelligence Act \(AI Act\) - Annex III - High-risk AI systems referred to in Article 6\(2\)"/);
    assert.match(resolve("[[2019/2144 Article 5]]"), /"⚖️ General Safety Regulation \(vehicles\) - Article 5"\)/);
  });

  test("a prefixed CRA citation carries the article or annex title, like the unprefixed one", () => {
    const [article] = links(resolve("[[CRA Article 24]]"));
    assert.deepEqual(article, { text: "Article 24 of the CRA", url: `${eurLex("32024R2847")}#art_24` });
    assert.match(resolve("[[CRA Article 24]]"), new RegExp(`"⚖️ Cyber Resilience Act \\(CRA\\) - Article 24 - ${craReferences.articleTitles[24]}"`));
    assert.match(resolve("[[CRA Annex I]]"), new RegExp(` - Annex I - ${craReferences.annexTitles.I}"`));
    assert.match(resolve("[[CRA Recital 18]]"), /"⚖️ Cyber Resilience Act \(CRA\) - Recital 18"/);
  });

  test("an act with a cite key is named by it whichever prefix is used", () => {
    assert.equal(resolve("[[2024/2853 Article 5]]"), resolve("[[PLD Article 5]]"));
  });

  test("the prefix is not case sensitive", () => {
    assert.deepEqual(links(resolve("[[pld article 5]]")).map(link => link.url), [`${eurLex("32024L2853")}#art_5`]);
  });

  test("leaves unknown documents and parts as written", () => {
    for (const markdown of ["[[GDPR Article 5]]", "[[2016/679 Article 5]]", "[[CRA-GUIDANCE Section 99.9]]", "[[CRA-GUIDANCE point 9999]]", "[[PLD Section 2]]"]) {
      assert.equal(resolve(markdown), markdown);
    }
  });

  test("a parenthesis of citations renders in the short form, grouped by document and part", () => {
    const result = resolve("Recover costs ([[CRA Recital 15]], [[CRA-GUIDANCE point 58]], [[CRA-GUIDANCE point 61]]).");
    assert.deepEqual(links(result), [
      { text: "CRA Recital 15", url: `${eurLex("32024R2847")}#rct_15` },
      { text: "Guidance points 58", url: "/official-guidance/#pnt_58" },
      { text: "61", url: "/official-guidance/#pnt_61" }
    ]);
    assert.equal(linkText(result), "Recover costs ([CRA Recital 15], [Guidance points 58], [61]).");
    assert.match(result, /"⚖️ Cyber Resilience Act \(CRA\) - Recital 15"/);
    assert.match(result, /"🇪🇺 Official CRA Guidance - point 61 \(Section 3\.2\.4 - Donations\)"/);
  });

  test("grouped citations name each change of document or part type", () => {
    const short = (markdown) => linkText(resolve(markdown));
    assert.equal(short("([[CRA-GUIDANCE point 55]], [[CRA-GUIDANCE point 56]], [[CRA-GUIDANCE Example 18]])"), "([Guidance points 55], [56], [Example 18])");
    assert.equal(short("([[CRA Article 3(14)]], [[PLD Article 5]], [[AI-ACT Recital 3]], [[2019/1020 Annex I]])"), "([CRA Article 3(14)], [PLD Article 5], [AI Act Recital 3], [Regulation (EU) 2019/1020 Annex I])");
    assert.equal(short("([[CRA Article 5]])"), "([CRA Article 5])");
  });

  test("a parenthesis holding anything but citations keeps the long form", () => {
    const short = (markdown) => linkText(resolve(markdown));
    assert.equal(short("(see [[CRA Article 5]])"), "(see [Article 5 of the CRA])");
    assert.equal(short("([[CRA Article 5]], [[GDPR Article 5]])"), "([Article 5 of the CRA], [[GDPR Article 5]])");
    assert.equal(short("([[maintainers/should-i-worry]], [[CRA Article 5]])"), "([[maintainers/should-i-worry]], [Article 5 of the CRA])");
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
