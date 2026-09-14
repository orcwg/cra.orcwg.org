const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SRP_FAQ_URL, parseSrpFaqPage } = require("../src/_data/utils/srp-faq-parser.js");

const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "enisa-srp-faq.html"), "utf8");
const { lastUpdatedAt, items } = parseSrpFaqPage(fixture, SRP_FAQ_URL);
const byNumber = (number) => items.find(item => item.questionNumber === number);

test("extracts the last update date", () => {
  assert.equal(lastUpdatedAt.toISOString(), "2026-09-12T00:00:00.000Z");
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
