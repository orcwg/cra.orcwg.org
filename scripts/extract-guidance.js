#!/usr/bin/env node
// Extracts the Commission's CRA guidance, as published in the Official Journal
// of the European Union, into the site's /official-guidance/ page, with stable
// anchors for sections, points (and their lettered sub-points), examples,
// figures and footnotes.
//
// Usage: node scripts/extract-guidance.js [--check] <input.xhtml>
//
// The input is the XHTML rendition of the Official Journal publication, the
// document EUR-Lex shows at
// https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:C_202606013.
// The Publications Office serves it to scripts at
// https://publications.europa.eu/resource/oj/C_202606013 (with the headers
// "Accept: application/xhtml+xml" and "Accept-Language: eng").
//
// Writes src/official-guidance.html (rendered with the official-guidance.njk
// layout), src/_data/official-guidance.json (served by the API, in the shape
// of the machine-readable CRA text) and the figures, which the XHTML embeds,
// to src/assets/images/official-guidance/. With --check, writes nothing and
// fails unless the committed output matches what the XHTML produces.
//
// The extraction is deterministic and self-verifying. It exits non-zero
// unless all of the following hold:
//
//   1. Coverage: the parsed document holds every character of the XHTML's
//      text, and the only text left out of the page is the Official Journal's
//      page furniture (masthead, ELI and ISSN lines), the title block and the
//      table of contents, which the page renders from the headings.
//   2. Fidelity: the text of the generated HTML and JSON, with whitespace
//      removed, is identical to the text of the XHTML's body, in the same
//      order. Footnotes are compared as a separate stream.
//   3. Numbering: headings match the table of contents, and points, examples,
//      figures and footnotes are numbered 1..n without gaps or duplicates.
//   4. Figures: each figure has a label, a caption and exactly one image.
//   5. Links: every id is unique, every internal link points to an existing
//      id, and each footnote is referenced exactly once, in order.
//
// The Official Journal's text has no hyperlinks between its parts: it refers
// to sections in italics ("Section 2.1 Placing on the market") and to points
// in running text ("points 13, 14 and 15"). The script links those references
// to their anchors; that adds links, never text.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseDocument } = require("htmlparser2");

// ---------------------------------------------------------------------------
// XML. The document is parsed with htmlparser2 into its DOM: elements have a
// name, attribs and children, and text nodes have data.

const parseXml = (src) => parseDocument(src, { xmlMode: true });

const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

const isText = (node) => node.type === "text";
const isElement = (node) => node.type === "tag";
const textOf = (node) => (isText(node) ? node.data : (node.children || []).map(textOf).join(""));
const elements = (node) => node.children.filter(isElement);
const cls = (node) => node.attribs.class || "";
const is = (node, name, className) => isElement(node) && node.name === name && (className === undefined || cls(node) === className);

function find(node, test) {
  if (isElement(node) && test(node)) return node;
  for (const child of node.children || []) {
    const found = find(child, test);
    if (found) return found;
  }
  return null;
}

// Whitespace-insensitive comparisons ignore every kind of space; collapsing
// leaves the non-breaking spaces of the source ("Regulation (EU) 2024/2847")
// alone.
const compact = (s) => s.replace(/\s+/g, "");
const collapse = (s) => s.replace(/[ \t\r\n]+/g, " ");

// ---------------------------------------------------------------------------
// Inline content

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const describe = (node) => `<${node.name}${cls(node) ? ` class="${cls(node)}"` : ""}>: ${collapse(textOf(node)).trim().slice(0, 60)}`;

// Flattens a node's children into inline tokens: { text, em?, link? } or
// { footnote, label, key } for a footnote reference.
function inlines(node, em = false) {
  return node.children.flatMap((child) => {
    if (isText(child)) return [{ text: collapse(child.data), ...(em && { em }) }];
    if (!isElement(child)) return [];
    if (is(child, "span", "oj-italic")) return inlines(child, true);
    if (child.name === "span" && ["", "oj-bold"].includes(cls(child))) return inlines(child, em);
    if (child.name === "a") {
      const note = (child.attribs.id || "").match(/^ntc(\d+)-(.+)$/);
      if (note) return [{ footnote: Number(note[1]), label: compact(textOf(child)), key: note[2] }];
      if (/^https?:\/\//.test(child.attribs.href || "")) return [{ text: collapse(textOf(child)), link: { uri: child.attribs.href }, ...(em && { em }) }];
    }
    throw new Error(`Unsupported inline content ${describe(child)}`);
  });
}

// Merges adjacent text, drops the space the converter puts before a footnote
// reference, and trims the ends.
function tidy(tokens) {
  const out = [];
  for (const token of tokens) {
    const prev = out[out.length - 1];
    if (token.footnote) {
      if (prev && prev.text !== undefined) prev.text = prev.text.replace(/ +$/, "");
      if (prev && prev.text === "") out.pop();
      out.push({ ...token });
      continue;
    }
    const text = prev && prev.text !== undefined && prev.text.endsWith(" ") ? token.text.replace(/^ +/, "") : token.text;
    if (prev && prev.text !== undefined && !prev.link && !token.link && !!prev.em === !!token.em) prev.text += text;
    else out.push({ ...token, text });
  }
  const first = out.find((t) => t.text !== undefined);
  if (first && first === out[0]) first.text = first.text.replace(/^ +/, "");
  const last = out[out.length - 1];
  if (last && last.text !== undefined) last.text = last.text.replace(/ +$/, "");
  return out.filter((t) => t.text !== "");
}

const plain = (tokens) => tokens.map((t) => (t.footnote ? t.label : t.text)).join("");

const whollyItalic = (tokens) => tokens.every((t) => t.footnote || t.em || !t.text.trim());
const withoutItalics = (tokens) => tokens.map(({ em, ...t }) => t);

// Splits a leading label (e.g. "Example 3: ") off the first text token.
function splitLabel(tokens, re) {
  const [first, ...rest] = tokens;
  const m = first.text !== undefined && !first.link ? first.text.match(re) : null;
  if (!m) throw new Error(`Expected label ${re} at: ${plain(tokens).slice(0, 60)}`);
  return { label: m[0].trim(), tokens: tidy([{ ...first, text: first.text.slice(m[0].length) }, ...rest]) };
}

// ---------------------------------------------------------------------------
// Blocks. The converter that produces the Official Journal's XHTML lays out
// everything that carries a number or a marker as a one-row table: table of
// contents entries, points, lettered sub-points and dash list items.

const cells = (table) => {
  const rows = elements(table).filter((e) => e.name === "tbody").flatMap(elements);
  if (rows.length !== 1) throw new Error(`Expected a one-row table: ${describe(table)}`);
  return elements(rows[0]);
};

const LISTS = [
  { type: "LowerAlpha", label: /^\([a-z]\)$/ },
  { type: "Dash", label: /^—$/ },
];

function buildDocument(root) {
  const container = find(root, (n) => is(n, "div", "eli-container"));
  if (!container) throw new Error("No eli-container found: is this the Official Journal's XHTML?");
  const doc = { kind: "", title: "", reference: "", toc: [], headings: [], blocks: [], footnotes: [] };
  let current = null; // the open example or figure
  let list = null; // the open top-level list
  let inNotes = false;

  const push = (block) => {
    doc.blocks.push(block);
    current = list = null;
    return block;
  };

  const listItem = (table) => {
    const [label, content] = cells(table);
    const marker = compact(textOf(label));
    const kind = LISTS.find((l) => l.label.test(marker));
    if (!kind) throw new Error(`Unsupported list marker "${marker}"`);
    return { type: kind.type, item: { label: marker, body: itemBody(content) } };
  };

  const appendItem = (target, { type, item }) => {
    const last = target[target.length - 1];
    if (last && last.list && last.list.type === type) last.list.items.push(item);
    else target.push({ list: { type, items: [item] } });
  };

  const itemBody = (cell) => {
    const body = [];
    for (const child of cell.children) {
      if (!isElement(child)) {
        if (textOf(child).trim()) throw new Error(`Unexpected text in a list item: ${textOf(child).trim().slice(0, 60)}`);
      } else if (is(child, "p", "oj-normal")) body.push({ p: tidy(inlines(child)) });
      else if (child.name === "table") appendItem(body, listItem(child));
      else throw new Error(`Unsupported list item content ${describe(child)}`);
    }
    return body;
  };

  // A paragraph is an example ("Example 3: ..."), the continuation of one (the
  // examples are set in italics throughout), or ordinary text.
  const paragraph = (tokens, point) => {
    if (/^Example\s\d+:/.test(plain(tokens))) {
      const { label, tokens: rest } = splitLabel(tokens, /^Example\s\d+:\s*/);
      const example = push({ type: "example", label, num: parseInt(label.slice(8), 10), body: [{ p: withoutItalics(rest) }] });
      current = example;
    } else if (current && current.type === "example" && whollyItalic(tokens)) {
      current.body.push({ p: withoutItalics(tokens) });
    } else if (point) {
      // Examples are published as blocks of their own, after the point they
      // belong to, so the point's text can't resume after one.
      if (doc.blocks[doc.blocks.length - 1] !== point) throw new Error(`Point ${point.label} continues after an example: ${plain(tokens).slice(0, 60)}`);
      point.body.push({ p: tokens });
    } else {
      push({ type: "paragraph", body: [{ p: tokens }] });
    }
  };

  const point = (label, content) => {
    const block = push({ type: "point", label, num: parseInt(label, 10), body: [] });
    for (const child of content.children) {
      if (!isElement(child)) {
        if (textOf(child).trim()) throw new Error(`Unexpected text in point ${label}: ${textOf(child).trim().slice(0, 60)}`);
      } else if (is(child, "span", "")) {
        block.body.push({ p: tidy(inlines(child)) });
      } else if (is(child, "p", "oj-normal")) {
        paragraph(tidy(inlines(child)), block);
      } else if (child.name === "table") {
        if (doc.blocks[doc.blocks.length - 1] !== block) throw new Error(`Point ${label} continues after an example`);
        appendItem(block.body, listItem(child));
      } else {
        throw new Error(`Unsupported content in point ${label} ${describe(child)}`);
      }
    }
  };

  for (const node of elements(container)) {
    const text = collapse(textOf(node)).trim();
    if (inNotes) {
      if (!is(node, "p", "oj-note")) throw new Error(`Unexpected content among the footnotes ${describe(node)}`);
      const [anchor] = elements(node);
      const id = anchor && (anchor.attribs.id || "").match(/^ntr(\d+)-(.+)$/);
      if (!id) throw new Error(`Footnote without a marker: ${text.slice(0, 60)}`);
      const tokens = tidy(inlines({ ...node, children: node.children.slice(node.children.indexOf(anchor) + 1) }));
      // The marker is followed by non-breaking spaces.
      if (tokens[0].text !== undefined && !tokens[0].link) tokens[0].text = tokens[0].text.replace(/^\s+/, "");
      doc.footnotes.push({ num: Number(id[1]), label: compact(textOf(anchor)), key: id[2], tokens: tokens.filter((t) => t.text !== "") });
    } else if (is(node, "div", "eli-main-title")) {
      const titles = elements(node).filter((p) => is(p, "p", "oj-doc-ti")).map((p) => collapse(textOf(p)).trim());
      const number = elements(node).find((p) => is(p, "p", "oj-no-doc-c"));
      doc.kind = titles[0];
      doc.title = titles[titles.length - 1];
      doc.reference = number ? collapse(textOf(number)).trim().replace(/^\(|\)$/g, "") : "";
    } else if (is(node, "p", "oj-ti-tbl")) {
      // The "Contents" heading; the page has its own.
    } else if (node.name === "table" && find(node, (n) => is(n, "p", "oj-tbl-num"))) {
      const [num, title, page] = cells(node).map((c) => collapse(textOf(c)).trim());
      doc.toc.push({ label: num, num: num.replace(/\.$/, ""), title, page });
    } else if (is(node, "p", "oj-ti-grseq-1")) {
      const tokens = tidy(inlines(node));
      const heading = text.match(/^(\d+(?:\.\d+)*)\.\s+(.*)$/);
      if (/^Figure\s\d+$/.test(text)) {
        current = push({ type: "figure", label: text, num: parseInt(text.slice(7), 10), caption: null, image: null });
      } else if (current && current.type === "figure" && !current.caption) {
        current.caption = withoutItalics(tokens);
      } else if (heading && tokens.every((t) => t.text !== undefined && !t.link)) {
        const num = heading[1];
        doc.headings.push(push({ type: "heading", level: num.split(".").length, label: `${num}.`, num, title: heading[2] }));
      } else {
        throw new Error(`Unrecognised heading: ${text.slice(0, 60)}`);
      }
    } else if (node.name === "table") {
      const tds = cells(node);
      const label = tds.length === 3 && !compact(textOf(tds[0])) ? compact(textOf(tds[1])) : null;
      if (label && /^\d+\.$/.test(label)) {
        point(label, tds[2]);
      } else if (tds.length === 2) {
        const open = list;
        const target = open ? [{ list: open }] : [];
        appendItem(target, listItem(node));
        if (target.length !== 1) throw new Error(`A list changes its marker midway: ${text.slice(0, 60)}`);
        if (!open) push({ type: "list", list: target[0].list });
        list = target[0].list;
      } else {
        throw new Error(`Unrecognised table: ${text.slice(0, 60)}`);
      }
    } else if (is(node, "p", "oj-normal") && find(node, (n) => n.name === "img")) {
      const img = find(node, (n) => n.name === "img");
      if (text || !current || current.type !== "figure" || !current.caption || current.image) throw new Error(`Image outside a figure: ${img.attribs.alt}`);
      current.image = img.attribs.src;
    } else if (is(node, "p", "oj-normal")) {
      paragraph(tidy(inlines(node)), null);
      list = null;
    } else if (is(node, "hr", "oj-note")) {
      inNotes = true;
    } else {
      throw new Error(`Unexpected content ${describe(node)}`);
    }
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Anchor ids follow the ELI subdivision conventions EUR-Lex uses for acts
// (https://eur-lex.europa.eu/content/eli-register/ELI-subdivisions-specifications-v2.pdf):
// three-letter lowercase subdivision codes, "." as the hierarchy separator,
// higher subdivisions identified by their full ancestry, and continuously
// numbered subdivisions (like articles, here points) identified on their own.
//
//   sct_2.sct_3        Section 2.3 (sct_2.sct_3.tit_1 for its heading)
//   pnt_45             point 45
//   pnt_91.pnt_a       point 91(a)
//   fgr_9              Figure 9
//   exm_10             Example 10 (ELI has no code for examples)
//   ntr1 / ntc1        reference to / content of footnote 1 (EUR-Lex HTML
//                      uses the same two prefixes the other way round)
const ids = {
  section: (num) => num.split(".").map((n) => `sct_${n}`).join("."),
  point: (num) => `pnt_${num}`,
  subpoint: (pointId, label) => `${pointId}.pnt_${label.replace(/\W/g, "")}`,
  example: (num) => `exm_${num}`,
  figure: (num) => `fgr_${num}`,
  footnote: (num) => `ntc${num}`,
  footnoteRef: (num) => `ntr${num}`,
};
// ---------------------------------------------------------------------------
// Cross-references

// Every list of inline tokens in the document, in order, each with a function
// that replaces it.
function tokenLists(doc) {
  const lists = [];
  const walk = (body) =>
    body.forEach((part) => {
      if (part.p) lists.push({ tokens: part.p, replace: (tokens) => (part.p = tokens) });
      else part.list.items.forEach((item) => walk(item.body));
    });
  for (const block of doc.blocks) {
    if (block.body) walk(block.body);
    if (block.list) block.list.items.forEach((item) => walk(item.body));
    if (block.caption) lists.push({ tokens: block.caption, replace: (tokens) => (block.caption = tokens) });
  }
  doc.footnotes.forEach((fn) => lists.push({ tokens: fn.tokens, replace: (tokens) => (fn.tokens = tokens) }));
  return lists;
}

// Links the references the guidance makes to its own sections and points.
//
// Sections are referred to in italics, by number and usually by title, at
// times shortened ("Section 3.2.6 Not-for-profit entities"). An italic number
// is linked when it is a section's and any title that follows it starts that
// section's title.
//
// Points are referred to in running text ("points 13, 14 and 15"). References
// to the points of other texts name that text right after the number ("point
// 6 of Annex VII") or right before it ("Annex I, point 11, to Implementing
// Regulation ..."), or put the number in brackets ("point (1) of Part I"), and
// are left alone.
function linkCrossReferences(doc, problems) {
  const headings = new Map(doc.headings.map((h) => [h.num, h]));
  const points = new Set(doc.blocks.filter((b) => b.type === "point").map((b) => b.num));
  const linked = { sections: [], points: [] };

  const sectionLink = (token) => {
    const m = token.text.match(/^(?:Section\s)?(\d+(?:\.\d+)*)(?:\s+(.+?))?[\s.,)]*$/);
    if (!m) return token;
    const heading = headings.get(m[1]);
    const title = (m[2] || "").toLowerCase();
    const matches = heading && [title, title.replace(/[\s.,)]+$/, "")].some((t) => heading.title.toLowerCase().startsWith(t));
    if (!matches) {
      problems.push(`Italic text looks like a reference to a section but matches none: "${token.text}"`);
      return token;
    }
    linked.sections.push(token.text);
    return { ...token, link: { href: `#${ids.section(m[1])}` } };
  };

  const pointLinks = (token) => {
    const out = [];
    let at = 0;
    for (const m of token.text.matchAll(/\b[Pp]oints?\s(\d+(?:,\s\d+)*(?:\sand\s\d+)?)(?!\d)/g)) {
      const before = token.text.slice(0, m.index);
      const after = token.text.slice(m.index + m[0].length);
      if (/,\s$/.test(before) || /^,?\s(of|to)\s/.test(after)) continue;
      const numbers = m.index + m[0].length - m[1].length;
      out.push({ ...token, text: token.text.slice(at, numbers) });
      at = numbers;
      for (const n of m[1].matchAll(/\d+/g)) {
        if (!points.has(Number(n[0]))) {
          problems.push(`Reference to a point that doesn't exist: "${m[0]}"`);
          continue;
        }
        out.push({ ...token, text: token.text.slice(at, numbers + n.index) }, { ...token, text: n[0], link: { href: `#${ids.point(n[0])}` } });
        at = numbers + n.index + n[0].length;
      }
      linked.points.push(m[0]);
    }
    out.push({ ...token, text: token.text.slice(at) });
    return out.filter((t) => t.text !== "");
  };

  for (const { tokens, replace } of tokenLists(doc)) {
    replace(
      tokens.flatMap((token) => {
        if (token.text === undefined || token.link) return [token];
        return token.em ? [sectionLink(token)] : pointLinks(token);
      })
    );
  }
  return linked;
}

// ---------------------------------------------------------------------------
// Rendering

function renderTokens(tokens) {
  return tokens
    .map((t) => {
      if (t.footnote) return `<sup class="footnote-ref"><a href="#${ids.footnote(t.footnote)}" id="${ids.footnoteRef(t.footnote)}">${escapeHtml(t.label)}</a></sup>`;
      const text = t.link ? `<a href="${escapeHtml(t.link.uri || t.link.href)}">${escapeHtml(t.text)}</a>` : escapeHtml(t.text);
      return t.em ? `<em>${text}</em>` : text;
    })
    .join("");
}

// Numbers and labels link to their own anchor. Clicking one also copies its
// URL (see initializeSelfLinks in src/assets/js/site.js).
const selfLink = (id, label, description) =>
  `<a class="self-link" href="#${id}" title="Copy link to ${escapeHtml(description)}">${escapeHtml(label)}</a>`;

const subpointCite = (pointId, label) => `point ${pointId.slice(4)}${label}`;

function renderBody(body, idPrefix) {
  return body
    .map((part) => {
      if (part.p) return `<p>${renderTokens(part.p)}</p>`;
      const { type, items } = part.list;
      const lis = items
        .map((item) => {
          const id = idPrefix && type !== "Dash" ? ids.subpoint(idPrefix, item.label) : null;
          const label = id ? selfLink(id, item.label, subpointCite(idPrefix, item.label)) : escapeHtml(item.label);
          return `<li${id ? ` id="${id}"` : ""}><span class="label">${label}</span> ${renderBody(item.body, null)}</li>`;
        })
        .join("\n");
      return type === "Dash" ? `<ul class="labelled">\n${lis}\n</ul>` : `<ol class="labelled">\n${lis}\n</ol>`;
    })
    .join("\n");
}

function renderBlock(b, figures) {
  switch (b.type) {
    case "heading": {
      const id = ids.section(b.num);
      const tag = `h${b.level + 1}`;
      // Top-level sections are rendered as cards, like the rest of the site.
      const card = b.level === 1 ? ' class="section-card"' : "";
      return `<section id="${id}"${card}>\n<${tag} id="${id}.tit_1">${selfLink(id, b.label, `Section ${b.num}`)} ${escapeHtml(b.title)}</${tag}>`;
    }
    case "point": {
      const id = ids.point(b.num);
      return `<div class="point" id="${id}">${selfLink(id, b.label, `point ${b.num}`)}\n<div>\n${renderBody(b.body, id)}\n</div>\n</div>`;
    }
    case "example": {
      const id = ids.example(b.num);
      const [first, ...rest] = b.body;
      const head = `<p><strong>${selfLink(id, b.label.replace(/:$/, ""), `Example ${b.num}`)}:</strong> ${renderTokens(first.p)}</p>`;
      return `<aside class="example" id="${id}">\n${head}\n${renderBody(rest, null)}\n</aside>`;
    }
    case "paragraph":
      return renderBody(b.body, null);
    case "list":
      return renderBody([{ list: b.list }], null);
    case "figure": {
      const id = ids.figure(b.num);
      return `<figure id="${id}">\n<img src="${escapeHtml(figures[b.num - 1].src)}" alt="${escapeHtml(plain(b.caption))}">\n<figcaption><strong>${selfLink(id, b.label, b.label)}</strong> ${renderTokens(b.caption)}</figcaption>\n</figure>`;
    }
  }
}

// Joins rendered blocks, closing each <section> opened by a heading before the
// next heading at the same or a higher level.
function nestSections(blocks, rendered) {
  const open = [];
  let html = "";
  // Each top-level section ends with a link back to the table of contents at
  // the top of the page. Its label comes from CSS, so that the page's text
  // stays that of the guidance.
  const close = (level) =>
    `${level === 1 ? `<p class="back-to-top"><a href="#toc_1" aria-label="Back to top"></a></p>\n` : ""}</section>\n`;
  blocks.forEach((b, i) => {
    if (b.type === "heading") {
      while (open.length && open[open.length - 1] >= b.level) html += close(open.pop());
      open.push(b.level);
    }
    html += `${rendered[i]}\n\n`;
  });
  while (open.length) html += close(open.pop());
  return html;
}

// Returns the three parts of the page: table of contents, body and footnotes.
function renderDocument(doc, figures) {
  const rendered = doc.blocks.map((b) => renderBlock(b, figures));

  // Nested lists, closing each level's <ol> before a shallower entry.
  let toc = "";
  let depth = 0;
  for (const h of doc.headings) {
    if (h.level > depth) toc += "\n<ol>\n".repeat(h.level - depth);
    else toc += "</li>\n" + "</ol>\n</li>\n".repeat(depth - h.level);
    toc += `<li><a href="#${ids.section(h.num)}">${h.label} ${escapeHtml(h.title)}</a>`;
    depth = h.level;
  }
  toc += "</li>\n</ol>\n".repeat(depth);

  const footnotes = doc.footnotes
    .map((fn) => {
      const id = ids.footnote(fn.num);
      return `<li id="${id}" class="footnote-item"><span class="label">${selfLink(id, fn.label, `footnote ${fn.num}`)}</span> <p>${renderTokens(fn.tokens)} <a href="#${ids.footnoteRef(fn.num)}" class="footnote-backref" aria-label="Back to reference ${fn.num}"></a></p></li>`;
    })
    .join("\n");

  return { toc: `<h2 id="toc_1">Contents</h2>\n${toc.trim()}`, body: nestSections(doc.blocks, rendered).trim(), footnotes };
}

const yamlString = (s) => JSON.stringify(s);

// Assembles the Eleventy page. Its content is not processed by a template
// engine, so the extracted text is published exactly as verified.
function renderPage(parts, meta) {
  return `---
# Generated by scripts/extract-guidance.js; do not edit by hand.
layout: official-guidance.njk
permalink: "/official-guidance/"
title: "Official CRA Guidance"
templateEngineOverride: false
guidance:
  title: ${yamlString(meta.title)}
  reference: ${yamlString(meta.reference)}
  date: ${yamlString(meta.date)}
  eli: ${yamlString(meta.eli)}
  sourceFile: ${yamlString(meta.sourceFile)}
  sourceSha256: ${yamlString(meta.sourceSha256)}
  sourceUrl: ${yamlString(meta.sourceUrl)}
# Rendered by components/faq/faq-attribution.njk, as for the official FAQs.
attribution:
  author: "European Union"
  createdAt: ${meta.isoDate}
  license: "CC-BY-4.0"
  licenseUrl: "https://commission.europa.eu/legal-notice_en#copyright-notice"
  srcUrl: ${yamlString(meta.sourceUrl)}
  source: ${yamlString(`"OJ C, ${meta.reference}, ${meta.ojDate}"`)}
  disclaimer: ${yamlString(`This guidance is subject to the [disclaimer](https://commission.europa.eu/legal-notice_en#disclaimer) published on the European Commission's website.<br><br>The content of this page was generated from the guidance as published in the [Official Journal of the European Union](${meta.sourceUrl}), and its text was verified against it. Only the Official Journal's version is authentic; please check it for accuracy.`)}
---
<section class="section-card guidance-toc">
${parts.toc}
</section>

${parts.body}

<section class="section-card">
<h2>Footnotes</h2>
<ol class="footnotes-list">
${parts.footnotes}
</ol>
</section>
`;
}

// ---------------------------------------------------------------------------
// JSON document, in the shape of the machine-readable CRA text published at
// https://cra.orcwg.org/api/ (see x-eur-lex's generated/cra.json): typed nodes
// carrying a marker, an id, the anchor they live at (src), a human-readable
// citation (cite) and content, with footnotes collected at the end and
// referenced by id.

const footnotesIn = (content) =>
  [...new Set(content.flatMap((part) => (typeof part === "string" ? [...part.matchAll(/#ntc(\d+)"/g)].map((m) => m[1]) : part.footnotes || [])))];

function jsonContent(body, pointId) {
  const parts = [];
  for (const part of body) {
    if (part.p) {
      parts.push(renderTokens(part.p));
      continue;
    }
    if (part.list.type === "Dash" || !pointId) {
      parts.push({ type: "list", items: part.list.items.map((item) => ({ marker: item.label, content: jsonContent(item.body, null) })) });
      continue;
    }
    // Lettered sub-points, e.g. point 91(a).
    for (const item of part.list.items) {
      const id = ids.subpoint(pointId, item.label);
      const content = jsonContent(item.body, null);
      parts.push({
        type: "point",
        marker: item.label,
        id,
        src: `#${id}`,
        cite: subpointCite(pointId, item.label),
        content,
        footnotes: footnotesIn(content),
      });
    }
  }
  return parts;
}

function jsonBlock(block, figures) {
  switch (block.type) {
    case "point":
    case "example": {
      const id = block.type === "point" ? ids.point(block.num) : ids.example(block.num);
      const content = jsonContent(block.body, block.type === "point" ? id : null);
      return {
        type: block.type,
        marker: block.label,
        id,
        src: `#${id}`,
        cite: block.type === "point" ? `point ${block.num}` : `Example ${block.num}`,
        content,
        footnotes: footnotesIn(content),
      };
    }
    case "figure": {
      const id = ids.figure(block.num);
      const caption = renderTokens(block.caption);
      return {
        type: "figure",
        marker: block.label,
        id,
        src: `#${id}`,
        cite: block.label,
        title: caption,
        image: figures[block.num - 1].src,
        footnotes: footnotesIn([caption]),
      };
    }
    default:
      return jsonContent(block.body || [{ list: block.list }], null);
  }
}

// Nests the flat blocks under the sections their headings open.
function jsonSections(doc, figures) {
  const root = { sections: [] };
  const stack = [root];
  for (const block of doc.blocks) {
    if (block.type === "heading") {
      stack.length = block.level;
      const id = ids.section(block.num);
      const section = {
        type: "section",
        marker: block.label,
        title: block.title,
        id,
        src: `#${id}`,
        cite: `Section ${block.num}`,
        content: [],
        sections: [],
      };
      stack[stack.length - 1].sections.push(section);
      stack.push(section);
      continue;
    }
    const rendered = jsonBlock(block, figures);
    stack[stack.length - 1].content.push(...(Array.isArray(rendered) ? rendered : [rendered]));
  }
  return root.sections;
}

// The document, shaped so that the site's API serves it like any other item
// (see src/_data/utils/api-formatter.js).
function renderJson(doc, figures, meta) {
  return {
    id: "official-cra-guidance",
    type: "document",
    title: meta.title,
    shortTitle: "Official CRA Guidance",
    reference: meta.reference,
    date: meta.isoDate,
    eli: meta.eli,
    permalink: "/official-guidance/",
    author: "European Union",
    license: "CC-BY-4.0",
    licenseUrl: "https://commission.europa.eu/legal-notice_en#copyright-notice",
    srcUrl: meta.sourceUrl,
    source: { file: meta.sourceFile, sha256: meta.sourceSha256 },
    sections: jsonSections(doc, figures),
    footnotes: doc.footnotes.map((fn) => ({ id: String(fn.num), marker: fn.label, text: renderTokens(fn.tokens) })),
  };
}

// ---------------------------------------------------------------------------
// Verification

const FURNITURE = ["oj-hd-ti", "oj-hd-lg", "oj-hd-coll", "oj-hd-uniq", "oj-hd-date"];

// Splits the XHTML's text into what the page reproduces (the body and the
// footnotes, as two streams), what it renders from the headings instead (the
// title block and the table of contents), and the Official Journal's page
// furniture around the document.
function sourceStreams(root) {
  const streams = { body: "", notes: "", front: "", furniture: [], stray: [] };
  const container = find(root, (n) => is(n, "div", "eli-container"));
  let inNotes = false;
  for (const node of elements(container)) {
    const text = compact(textOf(node));
    if (is(node, "hr", "oj-note")) inNotes = true;
    else if (inNotes) streams.notes += text;
    else if (is(node, "div", "eli-main-title") || is(node, "p", "oj-ti-tbl") || (node.name === "table" && find(node, (n) => is(n, "p", "oj-tbl-num")))) streams.front += text;
    else streams.body += text;
  }
  const walk = (node, p) => {
    if (node === container) return;
    if (isText(node)) {
      const text = collapse(node.data).trim();
      if (!text) return;
      const known = p && (FURNITURE.includes(cls(p)) || (cls(p) === "oj-normal" && /^(ELI: |ISSN )/.test(collapse(textOf(p)).trim())));
      (known ? streams.furniture : streams.stray).push(text);
    } else if (isElement(node)) {
      node.children.forEach((child) => walk(child, node.name === "p" ? node : p));
    }
  };
  walk(find(root, (n) => n.name === "body"), null);
  return streams;
}

function htmlText(html) {
  return compact(decodeEntities(html.replace(/<[^>]+>/g, " ")));
}

function firstDifference(expected, actual) {
  let i = 0;
  while (i < expected.length && expected[i] === actual[i]) i++;
  return i === expected.length && i === actual.length
    ? null
    : `at character ${i}: expected "…${expected.slice(Math.max(0, i - 40), i + 40)}…", got "…${actual.slice(Math.max(0, i - 40), i + 40)}…"`;
}

// The document's text, in order: markers, titles and content.
function jsonText(nodes) {
  return nodes
    .map((node) => {
      if (typeof node === "string") return node;
      const own = [node.marker, node.title].filter(Boolean).join(" ");
      const children = node.items || node.content || [];
      return `${own} ${jsonText(children)} ${jsonText(node.sections || [])}`;
    })
    .join(" ");
}

function verify({ xhtml, root, doc, parts, json, figures }) {
  const problems = [];
  const report = [];
  const check = (name, fn) => {
    const before = problems.length;
    const summary = fn();
    report.push(`${problems.length === before ? "PASS" : "FAIL"} ${name}: ${summary}`);
  };
  const source = sourceStreams(root);

  // 1. Coverage: the parsed tree holds the raw text of the file, and all of
  // it is the body, the footnotes, the front matter or known page furniture.
  check("coverage", () => {
    const raw = xhtml.slice(xhtml.indexOf("<body"), xhtml.lastIndexOf("</body>")).replace(/<!--[\s\S]*?-->/g, "");
    const lost = firstDifference(htmlText(raw), compact(textOf(find(root, (n) => n.name === "body"))));
    if (lost) problems.push(`The parsed document differs from the XHTML's text ${lost}`);
    if (source.stray.length) problems.push(`Unrecognised text outside the document: ${JSON.stringify(source.stray)}`);
    return `all ${htmlText(raw).length} characters of the XHTML are parsed; left out of the page are ${source.furniture.length} lines of Official Journal page furniture, the title block and the table of contents`;
  });

  // 2. Fidelity: output text equals source text, in order.
  check("fidelity", () => {
    const jsonDiff = firstDifference(source.body, htmlText(jsonText(json.sections)));
    if (jsonDiff) problems.push(`JSON text differs from the XHTML ${jsonDiff}`);
    const jsonNotesDiff = firstDifference(source.notes, htmlText(json.footnotes.map((fn) => `${fn.marker} ${fn.text}`).join(" ")));
    if (jsonNotesDiff) problems.push(`JSON footnote text differs from the XHTML ${jsonNotesDiff}`);
    const bodyDiff = firstDifference(source.body, htmlText(parts.body));
    const notesDiff = firstDifference(source.notes, htmlText(parts.footnotes));
    if (bodyDiff) problems.push(`Body text differs from the XHTML ${bodyDiff}`);
    if (notesDiff) problems.push(`Footnote text differs from the XHTML ${notesDiff}`);
    return `HTML and JSON text are identical to the XHTML's ${source.body.length} body and ${source.notes.length} footnote characters (whitespace ignored)`;
  });

  // 3. Numbering.
  check("numbering", () => {
    const tocEntries = doc.toc.map((t) => `${t.label} ${t.title}`).join("\n");
    const headings = doc.headings.map((h) => `${h.label} ${h.title}`).join("\n");
    if (compact(tocEntries) !== compact(headings)) problems.push(`Headings don't match the table of contents ${firstDifference(tocEntries, headings)}`);
    if (compact(source.front) !== compact([doc.kind, doc.title, `(${doc.reference})`, "Contents", ...doc.toc.map((t) => t.label + t.title + t.page)].join("")))
      problems.push("The title block and table of contents hold text that wasn't read");
    const counts = {};
    for (const [type, nums] of [
      ["point", doc.blocks.filter((b) => b.type === "point").map((b) => b.num)],
      ["example", doc.blocks.filter((b) => b.type === "example").map((b) => b.num)],
      ["figure", doc.blocks.filter((b) => b.type === "figure").map((b) => b.num)],
      ["footnote", doc.footnotes.map((f) => f.num)],
    ]) {
      counts[type] = nums.length;
      nums.forEach((n, i) => n !== i + 1 && problems.push(`${type} ${i + 1} expected, found ${n}`));
    }
    doc.footnotes.forEach((fn) => fn.label !== `(${fn.num})` && problems.push(`Footnote ${fn.num} is labelled ${fn.label}`));
    return (
      `${doc.headings.length} headings match the TOC; ${counts.point} points, ${counts.example} examples, ` +
      `${counts.figure} figures and ${counts.footnote} footnotes numbered 1..n`
    );
  });

  // 4. Figures.
  check("figures", () => {
    const blocks = doc.blocks.filter((b) => b.type === "figure");
    if (figures.length !== blocks.length) problems.push(`${figures.length} images for ${blocks.length} figures`);
    blocks.forEach((b) => (!b.caption || !b.image) && problems.push(`${b.label} lacks ${b.caption ? "an image" : "a caption"}`));
    figures.forEach((f, i) => {
      const jpeg = f.data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
      const png = f.data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      if (path.extname(f.name) !== (jpeg ? ".jpg" : png ? ".png" : "")) problems.push(`Figure ${i + 1} is not the image its type says it is`);
    });
    return `${figures.length} images extracted, one for each captioned figure`;
  });

  // 5. Ids and links.
  check("links", () => {
    const html = [parts.toc, parts.body, parts.footnotes].join("\n");
    const all = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    const idSet = new Set(all);
    if (idSet.size !== all.length) problems.push(`Duplicate ids: ${all.filter((id, i) => all.indexOf(id) !== i).join(", ")}`);
    const hrefs = [...html.matchAll(/ href="#([^"]+)"/g)].map((m) => m[1]);
    const broken = hrefs.filter((h) => !idSet.has(h));
    if (broken.length) problems.push(`Links to missing ids: ${[...new Set(broken)].join(", ")}`);
    const refs = tokenLists(doc).flatMap(({ tokens }) => tokens.filter((t) => t.footnote));
    const placed = (html.match(/class="footnote-ref"/g) || []).length;
    if (placed !== doc.footnotes.length) problems.push(`${placed} footnote references for ${doc.footnotes.length} footnotes`);
    refs.forEach((ref, i) => {
      const fn = doc.footnotes[i];
      if (!fn || ref.footnote !== fn.num || ref.key !== fn.key) problems.push(`Footnote reference ${ref.label} doesn't match footnote ${fn ? fn.label : i + 1}`);
    });
    return `${all.length} ids are unique, ${hrefs.length} internal links resolve, ${placed}/${doc.footnotes.length} footnote references placed`;
  });

  return { problems, report };
}

// ---------------------------------------------------------------------------

// The figures are embedded in the XHTML as data URIs, in figure order.
function extractFigures(doc, figuresUrl) {
  return doc.blocks
    .filter((b) => b.type === "figure" && b.image)
    .map((b) => {
      const m = b.image.match(/^data:image\/(jpe?g|png);base64,(.*)$/s);
      if (!m) throw new Error(`${b.label} is not an embedded JPEG or PNG image`);
      const name = `figure-${b.num}.${m[1] === "png" ? "png" : "jpg"}`;
      return { name, src: `${figuresUrl}/${name}`, data: Buffer.from(m[2], "base64") };
    });
}

// "17.11.2026" -> "2026-11-17"
function isoDate(date) {
  if (!date) return null;
  const [day, month, year] = date.split(".");
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// "17.11.2026" -> "17 November 2026"
function formatDate(date) {
  if (!date) return null;
  const [day, month, year] = date.split(".").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${day} ${months[month - 1]} ${year}`;
}

function extract(input, figuresUrl) {
  const file = fs.readFileSync(input);
  const xhtml = file.toString("utf8");
  const root = parseXml(xhtml);
  const doc = buildDocument(root);

  const problems = [];
  const figures = extractFigures(doc, figuresUrl);
  const figureCount = doc.blocks.filter((b) => b.type === "figure").length;
  if (figures.length !== figureCount) throw new Error(`${figures.length} images found for ${figureCount} figures`);

  // The masthead carries the Official Journal number and publication date,
  // and the last lines the document's European Legislation Identifier.
  const masthead = (className) => {
    const node = find(root, (n) => is(n, "p", className));
    return node ? collapse(textOf(node)).trim() : null;
  };
  const ojDate = masthead("oj-hd-date");
  const eli = sourceStreams(root).furniture.map((line) => line.match(/^ELI: (http\S+)$/)?.[1]).find(Boolean);
  const meta = {
    title: doc.title,
    reference: doc.reference,
    ojDate,
    date: formatDate(ojDate),
    isoDate: isoDate(ojDate),
    eli,
    sourceFile: path.basename(input),
    sourceSha256: crypto.createHash("sha256").update(file).digest("hex"),
    sourceUrl: eli && eli.replace(/^http:/, "https:"),
  };
  for (const [key, value] of Object.entries(meta)) if (!value) problems.push(`Could not find the ${key} of the document`);
  if (doc.reference !== masthead("oj-hd-uniq")) problems.push(`The document is numbered ${doc.reference}, but the Official Journal's masthead says ${masthead("oj-hd-uniq")}`);

  const linked = linkCrossReferences(doc, problems);
  const parts = renderDocument(doc, figures);
  const page = renderPage(parts, meta);
  const json = renderJson(doc, figures, meta);
  const verification = verify({ xhtml, root, doc, parts, json, figures });
  const report = [...verification.report, `INFO cross-references: linked ${linked.sections.length} references to sections and ${linked.points.length} to points`];
  return { page, parts, json, figures, xhtml, root, doc, linked, problems: [...problems, ...verification.problems], report };
}

const PAGE = "src/official-guidance.html";
const JSON_FILE = "src/_data/official-guidance.json";
const FIGURES_DIR = "src/assets/images/official-guidance";
const FIGURES_URL = "/assets/images/official-guidance";

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const input = args.find((a) => !a.startsWith("--"));
  if (!input) {
    console.error("Usage: node scripts/extract-guidance.js [--check] <input.xhtml>");
    process.exit(2);
  }
  const root = path.join(__dirname, "..");
  const { page, json, figures, problems, report } = extract(input, FIGURES_URL);
  const jsonText = `${JSON.stringify(json, null, 2)}\n`;
  for (const line of report) console.log(`  ${line}`);
  if (problems.length) {
    for (const p of problems) console.error(`FAILED: ${p}`);
    process.exit(1);
  }

  const figuresPath = path.join(root, FIGURES_DIR);
  const pagePath = path.join(root, PAGE);
  const jsonPath = path.join(root, JSON_FILE);
  if (check) {
    // Confirms the committed output is exactly what this XHTML produces.
    const stale = [];
    if (!fs.existsSync(pagePath) || fs.readFileSync(pagePath, "utf8") !== page) stale.push(PAGE);
    if (!fs.existsSync(jsonPath) || fs.readFileSync(jsonPath, "utf8") !== jsonText) stale.push(JSON_FILE);
    const expected = new Set(figures.map((f) => f.name));
    const existing = fs.existsSync(figuresPath) ? fs.readdirSync(figuresPath) : [];
    for (const f of figures) {
      const file = path.join(figuresPath, f.name);
      if (!fs.existsSync(file) || !fs.readFileSync(file).equals(f.data)) stale.push(`${FIGURES_DIR}/${f.name}`);
    }
    for (const name of existing) if (!expected.has(name)) stale.push(`${FIGURES_DIR}/${name} (unexpected)`);
    if (stale.length) {
      console.error(`Output is out of date; run: node scripts/extract-guidance.js ${input}\n  ${stale.join("\n  ")}`);
      process.exit(1);
    }
    console.log("Verification passed; committed output matches the XHTML.");
    return;
  }

  fs.rmSync(figuresPath, { recursive: true, force: true });
  fs.mkdirSync(figuresPath, { recursive: true });
  for (const f of figures) fs.writeFileSync(path.join(figuresPath, f.name), f.data);
  fs.writeFileSync(pagePath, page);
  fs.writeFileSync(jsonPath, jsonText);
  console.log(`Verification passed. Wrote ${PAGE}, ${JSON_FILE} and ${figures.length} figures to ${FIGURES_DIR}/`);
}

if (require.main === module) main();

module.exports = { parseXml, buildDocument, linkCrossReferences, extract, verify, ids };
