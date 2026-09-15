const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { parseStructText, buildDocument, extract, verify, ids } = require("../scripts/extract-guidance.js");

// Builds `pdfinfo -struct-text` output from [indent, line] pairs.
const struct = (lines) => lines.map(([indent, line]) => `${" ".repeat(indent * 2)}${line}`).join("\n");

const plain = (tokens) => tokens.map((t) => t.text).join("");

describe("parseStructText", () => {
  test("parses roles, attributes, text and object references", () => {
    const tree = parseStructText(
      struct([
        [0, "Document"],
        [1, "L (block):"],
        [2, "   /ListNumbering /Decimal"],
        [2, "LI (block)"],
        [3, "LBody (block)"],
        [4, '"1. See "'],
        [4, "Link (inline)"],
        [5, "Object 12 0"],
        [5, "Span (inline)"],
        [6, '"Section 2"'],
      ])
    );
    const list = tree.children[0];
    assert.equal(list.role, "L");
    assert.deepEqual(list.attrs, { ListNumbering: "Decimal" });
    const body = list.children[0].children[0];
    assert.deepEqual(body.children[0], { text: "1. See " });
    assert.equal(body.children[1].role, "Link");
    assert.deepEqual(body.children[1].children[0], { obj: 12 });
  });
});

describe("buildDocument", () => {
  const build = (lines) =>
    buildDocument(parseStructText(struct([[0, "Document"], [1, "P (block)"], [2, '"COVER"'], ...lines])), new Map());

  test("rejoins a point split by a page break and a footnote", () => {
    const doc = build([
      [1, "H1 (block)"],
      [2, '"1 Introduction "'],
      [1, "L (block):"],
      [2, "   /ListNumbering /Decimal"],
      [2, "LI (block)"],
      [3, "LBody (block)"],
      [4, '"1. The first point is "'],
      [1, "Note <Note 1> (inline)"],
      [2, "P (block)"],
      [3, '"1 A footnote "'],
      [2, "P (block)"],
      [3, '"that continues."'],
      [1, "L (block):"],
      [2, "   /ListNumbering /Decimal"],
      [2, "LI (block)"],
      [3, "LBody (block)"],
      [4, '"split1. "'],
      [2, "LI (block)"],
      [3, "LBody (block)"],
      [4, '"2. Second point."'],
    ]);
    const points = doc.blocks.filter((b) => b.type === "point");
    assert.deepEqual(points.map((p) => p.num), [1, 2]);
    assert.equal(points[0].body.length, 1);
    assert.equal(plain(points[0].body[0].p), "The first point is split1.");
    assert.equal(doc.footnotes.length, 1);
    assert.equal(plain(doc.footnotes[0].tokens), "A footnote that continues.");
    assert.deepEqual(doc.headings.map((h) => h.num), ["1"]);
  });

  test("attaches follow-on paragraphs to examples, merging mid-sentence splits", () => {
    const doc = build([
      [1, "P (block)"],
      [2, '"Example 1: A company places "'],
      [1, "P (block)"],
      [2, '"a product on the market. "'],
      [1, "P (block)"],
      [2, '"The company is its manufacturer. "'],
    ]);
    const [example] = doc.blocks;
    assert.equal(example.type, "example");
    assert.equal(example.label, "Example 1:");
    assert.deepEqual(example.body.map((part) => plain(part.p)), [
      "A company places a product on the market.",
      "The company is its manufacturer.",
    ]);
  });

  test("keeps paragraphs and bullet lists in document order", () => {
    const doc = build([
      [1, "P (block)"],
      [2, '"Implications: "'],
      [1, "L (block):"],
      [2, "   /ListNumbering /Disc"],
      [2, "LI (block)"],
      [3, "LBody (block)"],
      [4, '"• First bullet, split "'],
      [1, "L (block):"],
      [2, "   /ListNumbering /Disc"],
      [2, "LI (block)"],
      [3, "LBody (block)"],
      [4, '"across pages. "'],
      [2, "LI (block)"],
      [3, "LBody (block)"],
      [4, '"• Second bullet. "'],
      [1, "P (block)"],
      [2, '"Afterwards. "'],
    ]);
    assert.deepEqual(doc.blocks.map((b) => b.type), ["paragraph", "list", "paragraph"]);
    assert.deepEqual(doc.blocks[1].list.items.map((i) => plain(i.body[0].p)), ["First bullet, split across pages.", "Second bullet."]);
  });
});

describe("ids", () => {
  test("follow ELI subdivision conventions", () => {
    assert.equal(ids.section("2"), "sct_2");
    assert.equal(ids.section("2.3"), "sct_2.sct_3");
    assert.equal(ids.section("3.2.1"), "sct_3.sct_2.sct_1");
    assert.equal(ids.point(45), "pnt_45");
    assert.equal(ids.subpoint(ids.point(91), "a."), "pnt_91.pnt_a");
    assert.equal(ids.figure(9), "fgr_9");
    assert.equal(ids.footnote(3), "ntc3");
    assert.equal(ids.footnoteRef(3), "ntr3");
  });
});

// End-to-end run against the Commission's PDF, when it and poppler are available.
const PDF = process.env.CRA_GUIDANCE_PDF ||
  path.join(__dirname, "../src/_data/C_2026_5252_1_EN_annexe_acte_autonome_cp_part1_v3_kXuCPwXXxAuG8Uj44Ar0o2Vros_131456.pdf");
const hasPoppler = (() => {
  try {
    execFileSync("pdfinfo", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("extract", { skip: !(fs.existsSync(PDF) && hasPoppler) && "guidance PDF or poppler not available" }, () => {
  const result = extract(PDF, "/figures");

  test("passes verification", () => {
    assert.deepEqual(result.problems, []);
  });

  test("is deterministic", () => {
    assert.equal(extract(PDF, "/figures").page, result.page);
  });

  test("verification detects dropped, altered and reordered text", () => {
    const body = result.parts.body;
    const run = (tampered) => verify({ ...result, parts: { ...result.parts, body: tampered } }).problems;
    const dropped = body.replace("Both copies of version 1.0.0 of software X", "Both copies of software X");
    const altered = body.replace("entered into force on 10 December 2024", "entered into force on 11 December 2024");
    const [a, b, c] = ["pnt_1", "pnt_2", "pnt_3"].map((id) => body.indexOf(`<div class="point" id="${id}">`));
    const reordered = body.slice(0, a) + body.slice(b, c) + body.slice(a, b) + body.slice(c);
    for (const tampered of [dropped, altered, reordered]) {
      assert.notEqual(tampered, body);
      assert.match(run(tampered).join("\n"), /Body text differs/);
    }
  });

  test("verification detects broken anchors", () => {
    const body = result.parts.body.replace('id="pnt_14"', 'id="pnt_14x"');
    assert.match(verify({ ...result, parts: { ...result.parts, body } }).problems.join("\n"), /Links to missing ids: .*pnt_14/);
  });

  test("renders an Eleventy page that isn't processed by a template engine", () => {
    assert.match(result.page, /^---\n[\s\S]*\npermalink: "\/official-guidance\/"\n[\s\S]*\ntemplateEngineOverride: false\n/);
    assert.match(result.page, /reference: "C\(2026\) 5252 final"/);
  });
});
