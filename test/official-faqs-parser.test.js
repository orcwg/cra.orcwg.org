const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseOfficialFAQs, parseVersionTable, getQuestionLastUpdatedAt } = require("../src/_data/parse-official-faqs.js");
const { resolveLinks } = require("../src/_data/utils/link-resolver.js");
const craReferences = require("../src/_data/eu-reg-titles.json")["2024/2847"];

const table = `| FAQ Version | Date       | Changes                                   |
| ----------- | ---------- | ----------------------------------------- |
| 1.0         | 03/12/2025 | New                                       |
| 1.1         | 17/12/2025 | Copyright notice; minor formatting issues |
| 1.2         | 16/01/2026 | Minor correction of 6.2                   |
| 1.3         | 01/07/2026 | Deletion of subsection 4.6                |
| 1.4         | 04/09/2026 | Addition of FAQ 5.5                       |

Next paragraph`;

const { createdAt, versions } = parseVersionTable(table);
const lastUpdated = (number) => getQuestionLastUpdatedAt(number, versions, createdAt).toISOString().slice(0, 10);

test("extracts the numbers mentioned in each changelog entry", () => {
  assert.deepEqual(versions.map(v => v.numbers), [[], [], ["6.2"], ["4.6"], ["5.5"]]);
});

test("a question mentioned in the changelog was updated on that version's date", () => {
  assert.equal(lastUpdated("6.2"), "2026-01-16");
  assert.equal(lastUpdated("5.5"), "2026-09-04");
});

test("a section mentioned in the changelog updates the questions it contains", () => {
  assert.equal(lastUpdated("4.6.1"), "2026-07-01");
});

test("a question the changelog never mentions keeps the document's creation date", () => {
  assert.equal(lastUpdated("5.4"), "2025-12-03");
  assert.equal(lastUpdated("1.1"), "2025-12-03");
});

test("numbers are matched whole, not as prefixes of other numbers", () => {
  assert.equal(lastUpdated("5.55"), "2025-12-03");
  assert.equal(lastUpdated("6.2.1"), "2026-01-16");
  assert.equal(lastUpdated("6.21"), "2025-12-03");
});

test("in the current document, only questions named in the changelog get a later update date", async () => {
  const { faqs } = await parseOfficialFAQs();
  const updated = faqs.filter(faq => faq.lastUpdatedAt > faq.createdAt).map(faq => faq.questionNumber);
  assert.deepEqual(updated.sort(), ["5.5", "6.2"]);
});

// Resolve the links of every question of the current document, as the build does
async function resolveCurrentDocument() {
  const { faqs, lists } = await parseOfficialFAQs();
  const index = {};
  faqs.forEach(faq => { index[faq.id] = faq; });
  lists.forEach(list => { index[`lists/${list.id}`] = list; });
  const resolved = new Map(faqs.map(faq => [faq.questionNumber, resolveLinks(faq.answer, faq._linkResolutionContext, index, craReferences, faq)]));
  return { faqs, lists, resolved };
}

const internalLinks = (markdown) => [...markdown.matchAll(/\[([^\]]+)\]\((\/faq\/\S+?)(?: "[^"]*")?\)/g)].map(([, text, url]) => ({ text, url }));

test("in the current document, cross-references link the question or section they name", async () => {
  const { lists, resolved } = await resolveCurrentDocument();
  const section = (number) => lists.find(list => list._sectionNumber === number).permalink;

  assert.deepEqual(internalLinks(resolved.get("1.4")).map(link => link.url), ["/faq/official/faq_7-1/", "/faq/official/faq_7-2/", "/faq/official/faq_5-3/"]);
  assert.deepEqual(internalLinks(resolved.get("6.3")).map(link => link.url), [section("4.1"), "/faq/official/faq_6-5/", "/faq/official/faq_6-6/", "/faq/official/faq_6-7/", "/faq/official/faq_6-8/"]);
  assert.deepEqual(internalLinks(resolved.get("1.9")).map(link => link.url), [section("2.1"), section("2.2")]);
  assert.ok(internalLinks(resolved.get("1.4")).some(link => link.text === "_7.1_ When does the CRA start applying?"), "the link covers the title that follows the number");
});

test("in the current document, no cross-reference to an existing question or section is left unlinked", async () => {
  const { faqs, lists, resolved } = await resolveCurrentDocument();
  const known = new Set([...faqs.map(faq => faq.questionNumber), ...lists.map(list => list._sectionNumber)]);
  const unlinked = [];
  for (const [questionNumber, markdown] of resolved) {
    const outsideLinks = markdown.replace(/\[([^\]]+)\]\(\S+(?: "[^"]*")?\)/g, "");
    for (const [, number] of outsideLinks.matchAll(/[_*](?:section\s+)?(\d+(?:\.\d+)+)/g)) {
      if (known.has(number)) unlinked.push(`${questionNumber} → ${number}`);
    }
  }
  assert.deepEqual(unlinked, []);
  assert.ok([...resolved.values()].some(markdown => internalLinks(markdown).length > 0), "the document has cross-references");
});
