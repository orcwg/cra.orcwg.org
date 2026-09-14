const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SRP_FAQ_URL, parseSrpFaqPage, linkSrpCrossReferences } = require("../src/_data/utils/srp-faq-parser.js");

const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "enisa-srp-faq.html"), "utf8");
const { lastUpdatedAt, items } = parseSrpFaqPage(fixture, SRP_FAQ_URL);
const byNumber = (number) => items.find(item => item.questionNumber === number);

test("extracts the last update date", () => {
  assert.equal(lastUpdatedAt.toISOString(), "2026-09-12T00:00:00.000Z");
});

test("extracts the intro paragraphs as Markdown", () => {
  const { intro } = parseSrpFaqPage(fixture, SRP_FAQ_URL);
  assert.equal(
    intro,
    "This page provides answers to frequently asked questions about the Cyber Resilience Act Single Reporting Platform (CRA SRP), including its purpose, reporting process, registration and use.  The FAQs are updated regularly to reflect the latest available information and guidance as the CRA SRP is implemented.\n\n" +
    "For broader guidance on the interpretation and implementation of the CRA, please also consult the European Commission’s “[FAQs on the CRA Implementation](https://ec.europa.eu/newsroom/dae/redirection/document/122331)”."
  );
});

test("returns a null intro when the page has no intro paragraphs", () => {
  const html = fixture.replace(/(<\/em><\/p>)[\s\S]*?(<dl class="ckeditor-accordion">)/, "$1\n$2");
  assert.equal(parseSrpFaqPage(html).intro, null);
});

test("extracts every question/answer pair in page order", () => {
  assert.deepEqual(
    items.map(item => item.questionNumber),
    ["1", "4", "7", "8", "9", "13", "17", "27", null]
  );
});

test("separates ENISA's question number from the question text", () => {
  assert.equal(byNumber("1").question, "What is the Cyber Resilience Act’s Single Reporting Platform (CRA SRP)?");
});

test("keeps ENISA's [UPDATED] marker in the question text", () => {
  assert.equal(byNumber("4").question, "[UPDATED] When will the Single Reporting Platform be operational?");
});

test("normalizes whitespace and non-breaking spaces in questions", () => {
  assert.equal(byNumber("9").question, "How do I access and register on the SRP, and what are the roles of Primary and Secondary ARs?");
});

test("keeps unnumbered questions without a question number", () => {
  const last = items[items.length - 1];
  assert.equal(last.questionNumber, null);
  assert.equal(last.question, "Did you not find the answer to your question above?");
});

test("converts answers to Markdown", () => {
  const answer = byNumber("1").answer;
  assert.match(answer, /^The CRA Single Reporting Platform \(SRP\) is an online tool/);
  assert.match(answer, /\n\nManufacturers and open-source software stewards submit notifications/);
  assert.match(answer, /in accordance with Art\. 14\(7\) of the CRA\.$/);
  assert.doesNotMatch(answer, /<\/?p>| /);
});

test("converts nested lists in answers", () => {
  const answer = byNumber("7").answer;
  assert.match(answer, /^-\s+\*\*Early Warning:\*\* Without undue delay/m);
  assert.match(answer, /^\s+-\s+For \*\*severe incidents\*\*: Within \*\*1 month\*\* after the 72-hour notification\.$/m);
});

test("keeps line breaks and strikethrough in answers", () => {
  assert.match(byNumber("4").answer, /Art\. 71\(2\) of the CRA\.\\\nVoluntary reporting/);
  assert.match(byNumber("27").answer, /Art\. 14\(~~3~~1\)/);
});

test("keeps absolute links and makes relative links absolute", () => {
  assert.match(byNumber("8").answer, /\[SRP Glossary\]\(https:\/\/www\.enisa\.europa\.eu\/topics\/product-security\/single-reporting-platform-srp\/cra-srp-glossary2\)/);
  assert.match(byNumber("17").answer, /\[AR User Manual\]\(https:\/\/www\.enisa\.europa\.eu\/topics\/product-security\/single-reporting-platform-srp\/cra-srp-ar-user-manual\)/);
});

test("decodes HTML entities in answers", () => {
  assert.match(byNumber("9").answer, /\*\*Settings > Association Management\*\*/);
  assert.match(byNumber("13").answer, /\(subsections 5\.1 & 5\.3\)/);
});

test("returns a null update date when the page has none", () => {
  const html = fixture.replace(/<em>Updated: [^<]*<\/em>/, "");
  assert.equal(parseSrpFaqPage(html).lastUpdatedAt, null);
});

test("throws when the FAQ list is missing", () => {
  assert.throws(() => parseSrpFaqPage("<html><body><p>Page moved</p></body></html>"), /Could not find the FAQ list/);
});

test("throws when the FAQ list is empty", () => {
  assert.throws(() => parseSrpFaqPage('<dl class="ckeditor-accordion"></dl>'), /No FAQs found/);
});

describe("linkSrpCrossReferences", () => {
  // Minimal internal link index, as built by createInternalLinkIndex in data.js
  const internalLinks = {
    "srp/faq_21": { permalink: "/faq/srp/faq_21/", _pageTitle: "Can the dissemination of a report be delayed or withheld?" },
    "official/faq_5-1": { permalink: "/faq/official/faq_5-1/", _pageTitle: "How can a manufacturer become aware of an actively exploited vulnerability or a severe incident?" },
    "official/faq_5-3": { permalink: "/faq/official/faq_5-3/", _pageTitle: "Does the reporting obligation apply to products placed on the market before 11 December 2027?" },
    "official/faq_5-4": { permalink: "/faq/official/faq_5-4/", _pageTitle: "Actively exploited vulnerability contained in a third-party component" }
  };

  const link = (markdown) => linkSrpCrossReferences(markdown, internalLinks);

  // Extract [text](url) pairs from Markdown, ignoring link titles
  const links = (markdown) => [...markdown.matchAll(/\[([^\]]+)\]\((\S+)(?: "[^"]*")?\)/g)].map(([, text, url]) => ({ text, url }));

  test("links references to other SRP FAQs", () => {
    const result = link("More detailed information is provided in FAQ 21.");
    assert.equal(
      result,
      'More detailed information is provided in [FAQ 21](/faq/srp/faq_21/ "🚨 ENISA SRP FAQ: Can the dissemination of a report be delayed or withheld?").'
    );
  });

  test("leaves references to unknown SRP FAQs unchanged", () => {
    assert.equal(link("See FAQ 99 for details."), "See FAQ 99 for details.");
  });

  test("links references to sections of the Commission's FAQ", () => {
    assert.deepEqual(links(link("See Section 5.4 of the Commission's FAQ.")), [{ text: "5.4", url: "/faq/official/faq_5-4/" }]);
  });

  test("links both sections in 'subsections 5.1 & 5.3'", () => {
    const result = link("before 11 September 2026 (subsections 5.1 & 5.3).");
    assert.deepEqual(links(result), [
      { text: "5.1", url: "/faq/official/faq_5-1/" },
      { text: "5.3", url: "/faq/official/faq_5-3/" }
    ]);
    assert.match(result, /^before 11 September 2026 \(subsections \[5\.1\]\([^)]+\) & \[5\.3\]\([^)]+\)\)\.$/);
  });

  test("leaves references to unknown Commission FAQ sections unchanged", () => {
    assert.equal(link("Section 9.1 provides detailed guidance."), "Section 9.1 provides detailed guidance.");
  });

  test("does not insert links inside existing links", () => {
    const markdown = "See [FAQ 21 on ENISA's website](https://www.enisa.europa.eu/faq#21) and [Section 5.4](https://example.org/5-4).";
    assert.equal(link(markdown), markdown);
  });

  test("handles empty answers", () => {
    assert.equal(link(""), "");
  });

  test("links the cross-references of the fixture page", () => {
    const answers = Object.fromEntries(items.map(item => [item.questionNumber, link(item.answer)]));
    assert.deepEqual(links(answers["8"]).filter(l => l.url.startsWith("/")), [{ text: "FAQ 21", url: "/faq/srp/faq_21/" }]);
    assert.deepEqual(links(answers["13"]).filter(l => l.url.startsWith("/")).map(l => l.url), ["/faq/official/faq_5-1/", "/faq/official/faq_5-3/"]);
  });

  test("is not part of the shared link resolver", () => {
    const { resolveLinks } = require("../src/_data/utils/link-resolver.js");
    const markdown = "See FAQ 21 and subsection 5.1.";
    assert.equal(resolveLinks(markdown, "srp", internalLinks, {}), markdown);
  });
});
