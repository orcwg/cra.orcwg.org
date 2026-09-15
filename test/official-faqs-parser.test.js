const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseOfficialFAQs, parseVersionTable, getQuestionLastUpdatedAt } = require("../src/_data/parse-official-faqs.js");

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
