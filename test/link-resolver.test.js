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

  test("links the implementing regulation on product categories by its cite key", () => {
    const result = resolve("See [[CRA-CATEGORIES Annex I]].");
    assert.deepEqual(links(result), [{ text: "Annex I of the CRA Implementing Regulation on product categories", url: `${eurLex("32025R2392")}#anx_I` }]);
    assert.match(result, /"⚖️ CRA Implementing Regulation on Product Categories - Annex I - IMPORTANT PRODUCTS WITH DIGITAL ELEMENTS"/);
    assert.equal(resolve("[[2025/2392 Annex I]]"), resolve("[[CRA-CATEGORIES Annex I]]"));
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
    assert.equal(linkText(result), "Recover costs ([CRA Recital 15], [Guidance points 58] and [61]).");
    assert.match(result, /"⚖️ Cyber Resilience Act \(CRA\) - Recital 15"/);
    assert.match(result, /"🇪🇺 Official CRA Guidance - point 61 \(Section 3\.2\.4 - Donations\)"/);
  });

  test("grouped citations name each change of document or part type", () => {
    const short = (markdown) => linkText(resolve(markdown));
    assert.equal(short("([[CRA-GUIDANCE point 52]], [[CRA-GUIDANCE point 53]], [[CRA-GUIDANCE point 76]], [[CRA-GUIDANCE Example 18]])"), "([Guidance points 52], [53], and [76], [Example 18])");
    assert.equal(short("([[CRA Article 3(14)]], [[PLD Article 5]], [[AI-ACT Recital 3]], [[2019/1020 Annex I]])"), "([CRA Article 3(14)], [PLD Article 5], [AI Act Recital 3], [2019/1020 Annex I])");
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

describe("FAQ references", () => {
  const faqs = {
    "maintainers/should-i-worry": { id: "maintainers/should-i-worry", type: "faq", permalink: "/faq/maintainers/should-i-worry/", _pageTitle: "Should I worry?" },
    "maintainers/scope/new-faq": { id: "maintainers/scope/new-faq", type: "faq", permalink: "/faq/maintainers/scope/new-faq/", _pageTitle: "A new FAQ" }
  };
  const link = (markdown) => resolveLinks(markdown, "maintainers", faqs, craReferences);

  test("links an FAQ by its category and filename", () => {
    assert.deepEqual(links(link("See [[maintainers/should-i-worry]].")), [{ text: "Should I worry?", url: "/faq/maintainers/should-i-worry/" }]);
  });

  test("links an FAQ in a sublist's folder by its full id", () => {
    assert.deepEqual(links(link("See [[maintainers/scope/new-faq]].")), [{ text: "A new FAQ", url: "/faq/maintainers/scope/new-faq/" }]);
  });

  test("leaves an unknown id as it is", () => {
    assert.equal(link("See [[maintainers/scope/missing]]."), "See [[maintainers/scope/missing]].");
  });
});

describe("official FAQ cross-references", () => {
  // The Commission's FAQ refers to its own questions and sections by number, in italics
  const official = {
    "official/faq_1-2": { id: "official/faq_1-2", type: "faq", permalink: "/faq/official/faq_1-2/", _pageTitle: "What is a product with digital elements? Are stand-alone software or firmware products with digital elements?" },
    "official/faq_1-3": { id: "official/faq_1-3", type: "faq", permalink: "/faq/official/faq_1-3/", _pageTitle: "What is a direct or indirect logical or physical data connection to a device or network?" },
    "official/faq_6-7": { id: "official/faq_6-7", type: "faq", permalink: "/faq/official/faq_6-7/", _pageTitle: "What is the CE marking?" },
    "official/faq_6-8": { id: "official/faq_6-8", type: "faq", permalink: "/faq/official/faq_6-8/", _pageTitle: "What is the declaration of conformity?" },
    "official/faq_7-2": { id: "official/faq_7-2", type: "faq", permalink: "/faq/official/faq_7-2/", _pageTitle: "A manufacturer develops a product type before the CRA applies. Can it continue to manufacture products identical to that type after the CRA applies?" },
    "lists/official/interplay/aviation": { id: "official/interplay/aviation", type: "list", _sectionNumber: "2.1", permalink: "/faq/official/interplay/aviation/", _pageTitle: "Regulation (EU) 2018/1139 on common rules in the field of civil aviation" },
    "lists/official/manufacturers/risk-assessment": { id: "official/manufacturers/risk-assessment", type: "list", _sectionNumber: "4.1", permalink: "/faq/official/manufacturers/risk-assessment/", _pageTitle: "Risk-based approach and risk-assessment" },
    "lists/official/manufacturers/support-period": { id: "official/manufacturers/support-period", type: "list", _sectionNumber: "4.5", permalink: "/faq/official/manufacturers/support-period/", _pageTitle: "Support period" },
    // Another source's list with the same section number must never be picked
    "lists/srp": { id: "srp", type: "list", _sectionNumber: "4.1", permalink: "/faq/srp/", _pageTitle: "SRP FAQ" }
  };
  const link = (markdown) => resolveLinks(markdown, "official", official, craReferences);

  test("links an italic number followed by the question's title inside the italics", () => {
    assert.deepEqual(links(link("See also entry _1.3 What is a direct or indirect logical or physical data connection to a device or network?_ for details.")), [
      { text: "_1.3 What is a direct or indirect logical or physical data connection to a device or network?_", url: "/faq/official/faq_1-3/" }
    ]);
  });

  test("links an italic number followed by the question's title outside the italics", () => {
    const result = link("See also _1.3_ What is a direct or indirect logical or physical data connection to a device or network? and more.");
    assert.deepEqual(links(result), [{ text: "_1.3_ What is a direct or indirect logical or physical data connection to a device or network?", url: "/faq/official/faq_1-3/" }]);
    assert.equal(linkText(result), "See also [_1.3_ What is a direct or indirect logical or physical data connection to a device or network?] and more.");
  });

  test("the link covers a title that starts inside the italics and continues after them", () => {
    const result = link("See also _7.2 A manufacturer develops a product type before the CRA applies._ Can it continue to manufacture products identical to that type after the CRA applies?");
    assert.deepEqual(links(result).map(l => l.url), ["/faq/official/faq_7-2/"]);
    assert.equal(linkText(result), "See also [_7.2 A manufacturer develops a product type before the CRA applies._ Can it continue to manufacture products identical to that type after the CRA applies?]");
  });

  test("the title may be split across the italics boundary wherever the source splits it", () => {
    const result = link("(see also entry _1.2 What is a product with digital elements?_ Are stand-alone software or firmware products with digital elements?);");
    assert.equal(linkText(result), "(see also entry [_1.2 What is a product with digital elements?_ Are stand-alone software or firmware products with digital elements?]);");
  });

  test("the word section may sit inside the italics", () => {
    assert.deepEqual(links(link("(see _section 6.8_ What is the declaration of conformity?).")), [
      { text: "_section 6.8_ What is the declaration of conformity?", url: "/faq/official/faq_6-8/" }
    ]);
  });

  test("asterisks work as italics too", () => {
    assert.deepEqual(links(link("See *6.8* What is the declaration of conformity? and *4.1 Risk-based approach and risk-assessment*.")), [
      { text: "*6.8* What is the declaration of conformity?", url: "/faq/official/faq_6-8/" },
      { text: "*4.1 Risk-based approach and risk-assessment*", url: "/faq/official/manufacturers/risk-assessment/" }
    ]);
  });

  test("a plain section number is a cross-reference only when the question's title follows it", () => {
    assert.deepEqual(links(link("affixes the CE marking (see section 6.7 What is the CE marking?), and")), [
      { text: "section 6.7 What is the CE marking?", url: "/faq/official/faq_6-7/" }
    ]);
    // "section 2.3" is a section of the Blue Guide, which gets its own link, not a cross-reference
    assert.deepEqual(links(link("manufactured for one's own use (The 'Blue Guide' on the implementation of EU product rules 2022, section 2.3).")).map(l => l.url.startsWith("/")), [false]);
    const annex = "(Annex II, section 2.1 of CRA SR). For more information, see the standards.";
    assert.equal(link(annex), annex);
  });

  test("a section number links to the section's list, not to another source's list", () => {
    assert.deepEqual(links(link("see the section _4.1_ Risk-based approach and risk-assessment.")), [
      { text: "_4.1_ Risk-based approach and risk-assessment", url: "/faq/official/manufacturers/risk-assessment/" }
    ]);
  });

  test("a section title naming a regulation is linked whole, without a nested regulation link", () => {
    const result = link("see also section _2.1_ Regulation (EU) 2018/1139 on common rules in the field of civil aviation.");
    assert.deepEqual(links(result), [
      { text: "_2.1_ Regulation (EU) 2018/1139 on common rules in the field of civil aviation", url: "/faq/official/interplay/aviation/" }
    ]);
  });

  test("only the number is linked when the text that follows isn't the target's title", () => {
    const result = link("described in section _4.1_ What does the CRA require of the manufacturer's cybersecurity risk assessment?");
    assert.deepEqual(links(result), [{ text: "_4.1_", url: "/faq/official/manufacturers/risk-assessment/" }]);
    assert.equal(linkText(result), "described in section [_4.1_] What does the CRA require of the manufacturer's cybersecurity risk assessment?");
  });

  test("the title must end at a word boundary", () => {
    assert.deepEqual(links(link("_4.5_ Support periods vary.")), [{ text: "_4.5_", url: "/faq/official/manufacturers/support-period/" }]);
    assert.deepEqual(links(link("See also section _4.5_ Support period.")), [{ text: "_4.5_ Support period", url: "/faq/official/manufacturers/support-period/" }]);
  });

  test("titles are compared regardless of case, spacing and the shape of quotes", () => {
    const index = { ...official, "official/faq_4-2-5": { id: "official/faq_4-2-5", type: "faq", permalink: "/faq/official/faq_4-2-5/", _pageTitle: 'When is a product “tailor-made”? What documentation is required in these cases?' } };
    const result = resolveLinks('see entry _4.2.5 When is a product "tailor-made"?_  what documentation is required in these cases?', "official", index, craReferences);
    assert.deepEqual(links(result).map(l => l.url), ["/faq/official/faq_4-2-5/"]);
    assert.equal(linkText(result), 'see entry [_4.2.5 When is a product "tailor-made"?_  what documentation is required in these cases?]');
  });

  test("links every cross-reference on a line", () => {
    const result = link("- Affix the CE marking (see section _6.7_ What is the CE marking?), draw up a declaration of conformity (see section _6.8_ What is the declaration of conformity?).");
    assert.deepEqual(links(result).map(l => l.url), ["/faq/official/faq_6-7/", "/faq/official/faq_6-8/"]);
    assert.equal(linkText(result), "- Affix the CE marking (see section [_6.7_ What is the CE marking?]), draw up a declaration of conformity (see section [_6.8_ What is the declaration of conformity?]).");
  });

  test("leaves numbers that are neither a question nor a section as written", () => {
    const markdown = "see also _9.9_ Nothing here, _1.1.9_ nor sections 1.1.9 and 1.2.1, or _2.3_.";
    assert.equal(link(markdown), markdown);
  });

  test("does not insert links inside existing links", () => {
    const markdown = "see [the _6.8_ What is the declaration of conformity? page](https://example.org/doc).";
    assert.equal(link(markdown), markdown);
  });

  test("only applies to the Commission's own FAQ", () => {
    const markdown = "see _6.8_ What is the declaration of conformity?";
    assert.equal(resolveLinks(markdown, "cra-basics", official, craReferences), markdown);
    assert.equal(resolveLinks(markdown, "srp", official, craReferences), markdown);
  });

  test("renders as a single link holding the italic number", () => {
    const html = md.renderInline(link("See _6.8_ What is the declaration of conformity?"));
    assert.equal(html, 'See <a href="/faq/official/faq_6-8/" title="🇪🇺 Official European Commission FAQ: What is the declaration of conformity?"><em>6.8</em> What is the declaration of conformity?</a>');
  });
});
