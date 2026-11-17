const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { parseXml, buildDocument, linkCrossReferences, extract, verify, ids } = require("../scripts/extract-guidance.js");

const plain = (tokens) => tokens.map((t) => (t.footnote ? t.label : t.text)).join("");

// The Official Journal's XHTML lays out numbered and marked content as
// one-row tables.
const table = (...cells) => `<table><col width="4%"/><tbody><tr>${cells.map((c) => `<td valign="top">${c}</td>`).join("")}</tr></tbody></table>`;
const point = (label, ...content) => table("", `<p class="oj-normal">${label}</p>`, content.join("\n"));
const item = (label, text) => table(`<p class="oj-normal">${label}</p>`, `<p class="oj-normal">${text}</p>`);
const example = (text) => `<p class="oj-normal"><span class="oj-italic">${text}</span></p>`;
const heading = (label, title) => `<p class="oj-ti-grseq-1">${label}\u00a0\u00a0\u00a0<span class="oj-bold">${title}</span></p>`;
const noteRef = (n) => ` <a id="ntc${n}-X-E000${n}" href="#ntr${n}-X-E000${n}">(<span class="oj-super oj-note-tag">${n}</span>)</a>`;
const note = (n, text) => `<p class="oj-note"><a id="ntr${n}-X-E000${n}" href="#ntc${n}-X-E000${n}">(<span class="oj-super">${n}</span>)</a>\u00a0\u00a0${text}</p>`;
const build = (...body) => buildDocument(parseXml(`<html><body><div class="eli-container">${body.join("\n")}</div></body></html>`));

describe("parseXml", () => {
  test("parses elements, attributes, text and entities, dropping comments and the prolog", () => {
    const root = parseXml('<?xml version="1.0"?><!DOCTYPE html><a href="?x=1&amp;y=2"><!-- note --><b class="c">R&amp;D &#8212; &#x2019;</b><br/></a>');
    const [a] = root.children;
    assert.equal(a.tag, "a");
    assert.deepEqual(a.attrs, { href: "?x=1&y=2" });
    assert.deepEqual(a.children[0], { tag: "b", attrs: { class: "c" }, children: [{ text: "R&D — ’" }] });
    assert.deepEqual(a.children[1], { tag: "br", attrs: {}, children: [] });
  });

  test("rejects malformed input", () => {
    assert.throws(() => parseXml("<a><b></a>"), /Unexpected <\/a>/);
    assert.throws(() => parseXml("<a>"), /Unclosed <a>/);
    assert.throws(() => parseXml("<a>x < y</a>"), /Malformed XML/);
  });
});

describe("buildDocument", () => {
  test("reads headings, points and footnotes", () => {
    const doc = build(
      heading("1.", "INTRODUCTION"),
      heading("1.1.", "The Act"),
      point("1.", `<span>The first point${noteRef(1)}, with a <a href="https://example.com/">link</a>.</span>`),
      point("2.", "<span>Second point.</span>"),
      '<hr class="oj-note"/>',
      note(1, "A footnote.")
    );
    assert.deepEqual(doc.headings.map((h) => [h.level, h.label, h.num, h.title]), [[1, "1.", "1", "INTRODUCTION"], [2, "1.1.", "1.1", "The Act"]]);
    const points = doc.blocks.filter((b) => b.type === "point");
    assert.deepEqual(points.map((p) => p.num), [1, 2]);
    assert.equal(plain(points[0].body[0].p), "The first point(1), with a link.");
    assert.deepEqual(points[0].body[0].p[1], { footnote: 1, label: "(1)", key: "X-E0001" });
    assert.deepEqual(points[0].body[0].p[3].link, { uri: "https://example.com/" });
    assert.deepEqual(doc.footnotes.map((fn) => [fn.num, fn.label, fn.key, plain(fn.tokens)]), [[1, "(1)", "X-E0001", "A footnote."]]);
  });

  test("publishes a point's examples after it, with their follow-on paragraphs", () => {
    const doc = build(
      point("1.", "<span>A point.</span>", example("Example 1: A company places a product on the market."), example("The company is its manufacturer."), example("Example 2: Another.")),
      point("2.", "<span>Next point.</span>")
    );
    assert.deepEqual(doc.blocks.map((b) => b.type), ["point", "example", "example", "point"]);
    const [, first, second] = doc.blocks;
    assert.equal(first.label, "Example 1:");
    assert.deepEqual(first.body.map((part) => plain(part.p)), ["A company places a product on the market.", "The company is its manufacturer."]);
    // Examples are in italics throughout, so the italics carry no emphasis.
    assert.ok(first.body.every((part) => part.p.every((t) => !t.em)));
    assert.equal(second.num, 2);
  });

  test("reads lettered sub-points and dash lists", () => {
    const doc = build(
      point("1.", "<span>Cases:</span>", item("(a)", "first;"), item("(b)", "second.")),
      '<p class="oj-normal">A paragraph.</p>',
      '<p class="oj-normal"><span class="oj-italic">Implications:</span></p>',
      item("—", "First."),
      item("—", "Second."),
      '<p class="oj-normal">Afterwards.</p>'
    );
    assert.deepEqual(doc.blocks.map((b) => b.type), ["point", "paragraph", "paragraph", "list", "paragraph"]);
    const { list } = doc.blocks[0].body[1];
    assert.equal(list.type, "LowerAlpha");
    assert.deepEqual(list.items.map((i) => [i.label, plain(i.body[0].p)]), [["(a)", "first;"], ["(b)", "second."]]);
    assert.deepEqual(doc.blocks[2].body[0].p, [{ text: "Implications:", em: true }]);
    assert.equal(doc.blocks[3].list.type, "Dash");
    assert.deepEqual(doc.blocks[3].list.items.map((i) => plain(i.body[0].p)), ["First.", "Second."]);
  });

  test("reads a figure's label, caption and image", () => {
    const doc = build(
      '<p class="oj-ti-grseq-1"><span class="oj-italic">Figure 1</span></p>',
      '<p class="oj-ti-grseq-1"><span class="oj-bold">A flowchart</span></p>',
      '<p class="oj-normal"><figure><img src="data:image/jpg;base64,/9j/" alt="Image 1" class="oj-img"/></figure></p>'
    );
    const [figure] = doc.blocks;
    assert.deepEqual([figure.type, figure.label, figure.num, plain(figure.caption), figure.image], ["figure", "Figure 1", 1, "A flowchart", "data:image/jpg;base64,/9j/"]);
  });

  test("rejects content it doesn't recognise", () => {
    assert.throws(() => build('<p class="oj-other">Text</p>'), /Unexpected content <p class="oj-other">/);
    assert.throws(() => build('<p class="oj-normal">A <b>bold</b> claim</p>'), /Unsupported inline content <b>/);
    assert.throws(() => build(point("1.", "<span>A point.</span>", example("Example 1: An example."), '<p class="oj-normal">More of the point.</p>')), /continues after an example/);
  });
});

describe("linkCrossReferences", () => {
  const link = (...content) => {
    const doc = build(heading("2.", "SCOPE"), heading("2.1.", "Placing on the market"), point("1.", "<span>One.</span>"), point("2.", "<span>Two.</span>"), ...content);
    const problems = [];
    linkCrossReferences(doc, problems);
    const tokens = doc.blocks[doc.blocks.length - 1].body[0].p;
    return { problems, links: tokens.filter((t) => t.link).map((t) => [t.text, t.link.href]) };
  };

  test("links italic section references, whose titles may be shortened", () => {
    const { problems, links } = link(
      point("3.", '<span>See Section <span class="oj-italic">2.1 Placing on the</span>, Section <span class="oj-italic">2 Scope</span> and <span class="oj-italic">emphasis</span>.</span>')
    );
    assert.deepEqual(problems, []);
    assert.deepEqual(links, [["2.1 Placing on the", "#sct_2.sct_1"], ["2 Scope", "#sct_2"]]);
  });

  test("reports italic section references that match no section", () => {
    const { problems, links } = link(point("3.", '<span>See Section <span class="oj-italic">2.1 Making available</span>.</span>'));
    assert.deepEqual(links, []);
    assert.match(problems.join("\n"), /matches none: "2.1 Making available"/);
  });

  test("links references to the guidance's points, not to those of other texts", () => {
    const { problems, links } = link(
      point("3.", "<span>See points 1 and\u00a02, point 6 of Annex VII, Annex I, point 2, to the Regulation and point (1) of Part I.</span>")
    );
    assert.deepEqual(problems, []);
    assert.deepEqual(links, [["1", "#pnt_1"], ["2", "#pnt_2"]]);
  });

  test("reports references to points that don't exist", () => {
    assert.match(link(point("3.", "<span>See point 9.</span>")).problems.join("\n"), /point that doesn't exist: "point 9"/);
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

// End-to-end run against the Official Journal's XHTML.
const XHTML = process.env.CRA_GUIDANCE_XHTML || path.join(__dirname, "../src/_data/OJ_C_202606013_EN.xhtml");

describe("extract", { skip: !fs.existsSync(XHTML) && "guidance XHTML not available" }, () => {
  const result = extract(XHTML, "/figures");

  test("passes verification", () => {
    assert.deepEqual(result.problems, []);
  });

  test("is deterministic", () => {
    assert.equal(extract(XHTML, "/figures").page, result.page);
  });

  test("verification detects dropped, altered and reordered text", () => {
    const body = result.parts.body;
    const run = (tampered) => verify({ ...result, parts: { ...result.parts, body: tampered } }).problems;
    // The source separates some words with non-breaking spaces.
    const dropped = body.replace(/Both copies of version\s1\.0\.0 of software\sX/, "Both copies of software X");
    const altered = body.replace(/entered into force on 10(\s)December(\s)2024/, "entered into force on 11$1December$22024");
    const [a, b, c] = ["pnt_1", "pnt_2", "pnt_3"].map((id) => body.indexOf(`<div class="point" id="${id}">`));
    const reordered = body.slice(0, a) + body.slice(b, c) + body.slice(a, b) + body.slice(c);
    for (const tampered of [dropped, altered, reordered]) {
      assert.notEqual(tampered, body);
      assert.match(run(tampered).join("\n"), /Body text differs/);
    }
  });

  test("builds a JSON document the API can serve", () => {
    const { json } = result;
    assert.equal(json.id, "official-cra-guidance");
    assert.equal(json.type, "document");
    assert.equal(json.permalink, "/official-guidance/");
    assert.equal(json.reference, "C/2026/6013");
    assert.equal(json.date, "2026-11-17");
    assert.equal(json.eli, "http://data.europa.eu/eli/C/2026/6013/oj");
    assert.equal(json.footnotes.length, 31);
    assert.deepEqual(json.sections.map((s) => s.marker), ["1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9."]);

    const flatten = (nodes) =>
      nodes.flatMap((n) => (typeof n === "string" ? [] : [n, ...flatten([...(n.content || []), ...(n.sections || []), ...(n.items || [])])]));
    const nodes = flatten(json.sections);
    const all = (id) => nodes.find((n) => n.id === id);
    assert.deepEqual(all("sct_2.sct_3"), {
      ...all("sct_2.sct_3"),
      type: "section",
      marker: "2.3.",
      title: "Computer code",
      src: "#sct_2.sct_3",
      cite: "Section 2.3",
    });
    const point = all("pnt_45");
    assert.equal(point.type, "point");
    assert.equal(point.marker, "45.");
    assert.equal(point.cite, "point 45");
    assert.equal(point.src, "#pnt_45");
    assert.equal(all("pnt_91.pnt_a").cite, "point 91(a)");
    assert.equal(all("exm_10").cite, "Example 10");
    assert.equal(all("fgr_9").image, "/figures/figure-9.jpg");
    // Footnote 7 is referenced in point 13 and listed once.
    assert.deepEqual(all("pnt_13").footnotes, ["7"]);
    assert.deepEqual({ id: json.footnotes[6].id, marker: json.footnotes[6].marker }, { id: "7", marker: "(7)" });
  });

  test("verification detects text missing from the JSON", () => {
    const json = JSON.parse(JSON.stringify(result.json));
    const section = json.sections[0].sections[0];
    section.content[0].content[0] = section.content[0].content[0].replace(/entered\sinto\sforce/, "");
    assert.match(verify({ ...result, json }).problems.join("\n"), /JSON text differs/);
  });

  test("verification detects broken anchors", () => {
    const body = result.parts.body.replace('id="pnt_14"', 'id="pnt_14x"');
    assert.match(verify({ ...result, parts: { ...result.parts, body } }).problems.join("\n"), /Links to missing ids: .*pnt_14/);
  });

  test("renders an Eleventy page that isn't processed by a template engine", () => {
    assert.match(result.page, /^---\n[\s\S]*\npermalink: "\/official-guidance\/"\n[\s\S]*\ntemplateEngineOverride: false\n/);
    assert.match(result.page, /reference: "C\/2026\/6013"/);
  });

  test("attributes the guidance to the EU under the Commission's copyright notice", () => {
    assert.match(result.page, /\nattribution:\n  author: "European Union"\n  createdAt: 2026-11-17\n  license: "CC-BY-4.0"\n  licenseUrl: "https:\/\/commission\.europa\.eu\/legal-notice_en#copyright-notice"\n  srcUrl: "https:\/\/data\.europa\.eu\/eli\/C\/2026\/6013\/oj"\n/);
  });

  test("links the guidance's references to its own sections and points", () => {
    assert.deepEqual(result.linked.points.map((ref) => ref.replace(/\s/g, " ")), ["points 13, 14 and 15", "point 104", "point 91", "points 151 and 152"]);
    assert.equal(result.linked.sections.length, 33);
    assert.match(result.parts.body, /Section <em><a href="#sct_4">4 Substantial modifications<\/a><\/em>/);
  });

  test("verification detects footnote references that don't match their footnotes", () => {
    const doc = { ...result.doc, footnotes: result.doc.footnotes.map((fn, i) => (i === 4 ? { ...fn, key: "other" } : fn)) };
    assert.match(verify({ ...result, doc }).problems.join("\n"), /Footnote reference \(5\) doesn't match/);
  });
});
