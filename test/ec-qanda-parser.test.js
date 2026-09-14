const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseEcQandaDocument } = require("../src/_data/utils/ec-qanda-parser.js");
const fixture = require("./fixtures/ec-qanda.json");

const { createdAt, lastUpdatedAt, items } = parseEcQandaDocument(fixture);

test("uses the publish date as creation date", () => {
  assert.equal(createdAt.toISOString(), "2023-12-01T07:00:00.000Z");
});

test("extracts the update date", () => {
  assert.equal(lastUpdatedAt.toISOString(), "2023-12-01T00:00:00.000Z");
});

test("falls back to the publish date when there is no update date", () => {
  const html = fixture.docuLanguageResource.htmlContent.replace(/<p><em>\*Updated on [^<]*<\/em><\/p>/, "");
  const result = parseEcQandaDocument({ ...fixture, docuLanguageResource: { htmlContent: html } });
  assert.equal(result.lastUpdatedAt.getTime(), result.createdAt.getTime());
});

test("extracts every question/answer pair", () => {
  assert.deepEqual(items.map(item => item.question), [
    "What is the new EU Cyber Resilience Act?",
    "Delegated Regulation under the Radio Equipment Directive"
  ]);
});

test("does not include the update line or empty paragraphs in answers", () => {
  const last = items[items.length - 1].answer;
  assert.doesNotMatch(last, /Updated on/);
  assert.match(last, /will therefore be amended or repealed\.$/);
});

test("converts answers to Markdown", () => {
  const answer = items[0].answer;
  assert.match(answer, /^The Cyber Resilience Act is the first ever EU-wide legislation of its kind\./);
  assert.match(answer, /\n\n-\s+Wired and wireless products that are connected to the internet/);
  assert.doesNotMatch(answer, /<\/?(p|ul|li)>/);
});

test("keeps existing links in answers", () => {
  assert.match(
    items[1].answer,
    /\[Delegated Regulation adopted under the Radio Equipment Directive 2014\/53\/EU\]\(https:\/\/single-market-economy\.ec\.europa\.eu\/[^)]+\) \(RED Delegated Regulation\)/
  );
});
