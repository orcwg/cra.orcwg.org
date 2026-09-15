#!/usr/bin/env node
// Extracts the Commission's CRA guidance PDF into the site's
// /official-guidance/ page, with stable anchors for sections, points (and
// their lettered sub-points), examples, figures and footnotes.
//
// Usage: node scripts/extract-guidance.js [--check] <input.pdf>
//
// Writes src/official-guidance.html (rendered with the
// official-guidance.njk layout) and the figures, in their original image
// encoding, to src/assets/images/official-guidance/. With --check, writes
// nothing and fails unless the committed output matches what the PDF produces.
//
// The extraction is deterministic and self-verifying. It exits non-zero
// unless all of the following hold:
//
//   1. Coverage: every non-whitespace character of the PDF's page content is
//      present in the structure tree, apart from untagged page furniture
//      (page numbers, "EN" markers), which is reported.
//   2. Fidelity: the text of the generated HTML, with whitespace removed, is
//      identical to the text of the structure tree (excluding the cover page
//      and table of contents), in the same order. Footnotes are compared as a
//      separate stream, since they are moved to the end of the document.
//   3. Numbering: headings match the table of contents, and points, examples,
//      figures and footnotes are numbered 1..n without gaps or duplicates.
//   4. Figures: each extracted image is on the same page as its caption.
//   5. Links: every id is unique, and every internal link points to an
//      existing id and agrees with every other link to the same destination.
//
// Content comes from the PDF's tagged structure tree, as dumped by poppler's
// `pdfinfo -struct-text`. The script repairs the artefacts introduced by page
// breaks (points, examples and bullets split in two, footnotes interleaved
// with body text). Link targets are read from the link annotations, and
// footnote reference positions from the font sizes reported by
// `pdftohtml -xml`, since superscript digits are indistinguishable from body
// text in the structure tree (e.g. "13 April 20265"). Requires poppler
// (`pdfinfo`, `pdftohtml`, `pdfimages`) on the PATH.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

// ---------------------------------------------------------------------------
// Structure tree

function parseStructText(text) {
  const root = { role: "Root", attrs: {}, children: [] };
  const stack = [{ indent: -1, node: root }];
  let last = root;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();
    if (trimmed.startsWith("/")) {
      const [, key, value] = trimmed.match(/^\/(\S+)\s+\/?(.*)$/);
      last.attrs[key] = value;
      continue;
    }
    while (stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (trimmed.startsWith('"')) {
      parent.children.push({ text: trimmed.slice(1, trimmed.lastIndexOf('"')) });
    } else if (/^Object \d+ \d+$/.test(trimmed)) {
      parent.children.push({ obj: Number(trimmed.split(" ")[1]) });
    } else {
      const node = { role: trimmed.match(/^\w+/)[0], attrs: {}, children: [] };
      parent.children.push(node);
      stack.push({ indent, node });
      last = node;
    }
  }
  return root.children[0];
}

const textOf = (node) =>
  node.text !== undefined ? node.text : (node.children || []).map(textOf).join("");

const compact = (s) => s.replace(/\s+/g, "");
const collapse = (s) => s.replace(/\s+/g, " ");

// ---------------------------------------------------------------------------
// Link annotations. The structure tree only references them by object number,
// and they live in compressed object streams.

function readObjectStreams(buf) {
  const src = buf.toString("latin1");
  const objects = new Map();
  const re = /\d+ 0 obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(src))) {
    if (!/\/Type\s*\/ObjStm/.test(m[1])) continue;
    const length = Number(m[1].match(/\/Length (\d+)/)[1]);
    const first = Number(m[1].match(/\/First (\d+)/)[1]);
    const start = m.index + m[0].length;
    const data = zlib.inflateSync(buf.subarray(start, start + length)).toString("latin1");
    const header = data.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < header.length; i += 2) {
      const end = i + 3 < header.length ? header[i + 3] : data.length - first;
      objects.set(header[i], data.slice(first + header[i + 1], first + end));
    }
  }
  return objects;
}

function linkTarget(objects, num) {
  const dict = objects.get(num);
  if (!dict) throw new Error(`Link annotation object ${num} not found`);
  const uri = dict.match(/\/URI\((.*?)\)(?=\s*[/>])/);
  if (uri) return { uri: Buffer.from(uri[1].replace(/\\(.)/g, "$1"), "latin1").toString("utf8") };
  const dest = dict.match(/\/Dest\s*\[\s*(\d+ \d+ R)\s*\/XYZ\s+([\d.]+)\s+([\d.]+)/);
  if (dest) return { dest: `${dest[1]} ${dest[2]} ${dest[3]}` };
  throw new Error(`Unsupported link annotation ${num}: ${dict}`);
}

// ---------------------------------------------------------------------------
// Superscript footnote references, from pdftohtml's XML output.

const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

function readPageText(xml) {
  const sizes = new Map();
  for (const m of xml.matchAll(/<fontspec id="(\d+)" size="(\d+)"/g)) sizes.set(m[1], Number(m[2]));
  const elements = [];
  let page = 0;
  for (const m of xml.matchAll(/<page number="(\d+)"|<text top="(\d+)"[^>]*font="(\d+)">(.*?)<\/text>/g)) {
    if (m[1]) page = Number(m[1]);
    else elements.push({ page, top: Number(m[2]), size: sizes.get(m[3]), text: decodeEntities(m[4].replace(/<[^>]+>/g, "")) });
  }
  return elements;
}

// Returns, for each footnote in order, the ~30 characters of body text that
// precede its superscript reference.
function footnoteReferenceContexts(elements, count) {
  const bodySize = mode(elements.filter((e) => compact(e.text)).map((e) => e.size));
  const contexts = [];
  for (let i = 0; i < elements.length && contexts.length < count; i++) {
    const e = elements[i];
    if (e.size >= bodySize || compact(e.text) !== String(contexts.length + 1)) continue;
    let before = "";
    for (let j = i - 1; j >= 0 && elements[j].page === e.page && compact(before).length < 30; j--) {
      before = elements[j].text + before;
    }
    contexts.push(compact(before).slice(-30));
  }
  return contexts;
}

function mode(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

// ---------------------------------------------------------------------------
// Inline content

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Flattens a node into a list of inline tokens: { text } or { link, text }.
function inlines(node, objects) {
  if (node.text !== undefined) return [{ text: node.text }];
  if (node.role === "Link") {
    const obj = node.children.find((c) => c.obj !== undefined);
    return [{ link: linkTarget(objects, obj.obj), text: textOf(node) }];
  }
  return node.children.filter((c) => c.obj === undefined).flatMap((c) => inlines(c, objects));
}

const plain = (tokens) => tokens.map((t) => t.text).join("");

function trimTokens(tokens) {
  tokens = tokens.filter((t) => t.text !== "");
  if (tokens.length && !tokens[0].link) tokens[0] = { text: tokens[0].text.replace(/^\s+/, "") };
  const n = tokens.length - 1;
  if (n >= 0 && !tokens[n].link) tokens[n] = { text: tokens[n].text.replace(/\s+$/, "") };
  return tokens.filter((t) => t.text !== "");
}

// Splits a leading label (e.g. "14. ") off the first text token.
function splitLabel(tokens, re) {
  const [first, ...rest] = tokens;
  const m = first.link ? null : first.text.match(re);
  if (!m) throw new Error(`Expected label ${re} at: ${plain(tokens).slice(0, 60)}`);
  return { label: m[0].trim(), tokens: trimTokens([{ text: first.text.slice(m[0].length) }, ...rest]) };
}

// ---------------------------------------------------------------------------
// Blocks

function buildDocument(tree, objects) {
  const doc = { cover: "", toc: [], headings: [], blocks: [], footnotes: [] };
  let current = null; // the point/example/paragraph that continuations attach to
  let bulletList = null; // the open top-level bullet list, if any

  // Appends a paragraph to a container, merging it into the previous one when
  // that one ends mid-sentence (i.e. a page break split it).
  const appendParagraph = (body, tokens) => {
    const prev = body[body.length - 1];
    if (prev && prev.p && !/[.:;!?’”)]$/.test(plain(prev.p))) {
      prev.p = [...prev.p, { text: " " }, ...tokens];
    } else {
      body.push({ p: tokens });
    }
  };

  const itemBody = (li) => {
    const body = [];
    let run = [];
    const flush = () => {
      const t = trimTokens(run);
      if (t.length) body.push({ p: t });
      run = [];
    };
    for (const lbody of li.children) {
      for (const child of lbody.children) {
        if (child.role === "L") {
          flush();
          body.push({ list: list(child) });
        } else {
          run.push(...inlines(child, objects));
        }
      }
    }
    flush();
    return body;
  };

  const LABELS = { Decimal: /^\d+\.\s/, LowerAlpha: /^[a-z]\.\s/, Disc: /^•\s*/ };

  // Items whose text doesn't start with a label are the tail of the previous
  // item, split by a page break.
  const list = (l) => {
    const type = l.attrs.ListNumbering;
    if (!LABELS[type]) throw new Error(`Unsupported list numbering: ${type}`);
    const result = { type, items: [] };
    for (const li of l.children) {
      const body = itemBody(li);
      if (LABELS[type].test(plain(body[0].p))) {
        const { label, tokens } = splitLabel(body[0].p, LABELS[type]);
        result.items.push({ label, body: [{ p: tokens }, ...body.slice(1)] });
      } else if (result.items.length) {
        appendItems(result, [{ label: null, body }]);
      } else {
        // Continues an item from a previous list; resolved by the caller.
        result.items.push({ label: null, body });
      }
    }
    return result;
  };

  const appendItems = (target, items) => {
    for (const item of items) {
      if (item.label !== null) {
        target.items.push(item);
      } else {
        const prev = target.items[target.items.length - 1];
        if (!prev) throw new Error(`Unlabelled list item with nothing to continue: ${plain(item.body[0].p).slice(0, 60)}`);
        appendParagraph(prev.body, item.body[0].p);
        prev.body.push(...item.body.slice(1));
      }
    }
  };

  for (const node of tree.children) {
    const text = collapse(textOf(node)).trim();
    switch (node.role) {
      case "TOC":
        for (const item of node.children) {
          const link = item.children.find((c) => c.role === "Link");
          if (!link) continue;
          const [, num, title] = collapse(textOf(link)).trim().match(/^(\d+(?:\.\d+)*)\s+(.*?)\s*\.{3,}\s*\d+$/);
          doc.toc.push({ num, title, link: linkTarget(objects, link.children.find((c) => c.obj !== undefined).obj) });
        }
        break;
      case "H1":
      case "H2":
      case "H3": {
        const [, num, title] = text.match(/^(\d+(?:\.\d+)*)\s+(.*)$/);
        const heading = { type: "heading", level: Number(node.role[1]), num, title };
        doc.blocks.push(heading);
        doc.headings.push(heading);
        current = bulletList = null;
        break;
      }
      case "L": {
        const parsed = list(node);
        if (parsed.type === "Decimal") {
          for (const item of parsed.items) {
            if (item.label !== null) {
              current = { type: "point", label: item.label, num: parseInt(item.label, 10), body: [] };
              doc.blocks.push(current);
            } else if (!current || current.type !== "point") {
              throw new Error(`Unnumbered point with no point to continue: ${plain(item.body[0].p).slice(0, 60)}`);
            }
            const [head, ...rest] = item.body;
            appendParagraph(current.body, head.p);
            current.body.push(...rest);
          }
          bulletList = null;
        } else if (bulletList) {
          appendItems(bulletList, parsed.items);
        } else {
          bulletList = { type: parsed.type, items: [] };
          appendItems(bulletList, parsed.items);
          if (current && current.type === "example") {
            current.body.push({ list: bulletList });
          } else {
            doc.blocks.push({ type: "list", list: bulletList });
            current = null;
          }
        }
        break;
      }
      case "Note":
        for (const p of node.children) {
          const tokens = trimTokens(inlines(p, objects));
          if (!tokens.length) continue;
          const expected = String(doc.footnotes.length + 1);
          const m = plain(tokens).match(/^\d+/);
          if (m && m[0] === expected) {
            const { label, tokens: rest } = splitLabel(tokens, /^\d+\s*/);
            // The reference to this footnote is in a block before this point.
            doc.footnotes.push({ num: Number(label), label, tokens: rest, before: doc.blocks.length });
          } else {
            const prev = doc.footnotes[doc.footnotes.length - 1];
            prev.tokens = [...prev.tokens, { text: " " }, ...tokens];
          }
        }
        break;
      case "Figure":
        current = { type: "figure", num: null, caption: null };
        doc.blocks.push(current);
        bulletList = null;
        break;
      case "P": {
        if (!text) break;
        if (!doc.cover) {
          doc.cover = text;
          break;
        }
        const tokens = trimTokens(inlines(node, objects));
        if (/^Figure \d+:/.test(text) && current && current.type === "figure" && !current.caption) {
          const { label, tokens: rest } = splitLabel(tokens, /^Figure \d+:\s*/);
          Object.assign(current, { label, num: parseInt(label.slice(7), 10), caption: rest });
          current = null;
        } else if (/^Example \d+:/.test(text)) {
          const { label, tokens: rest } = splitLabel(tokens, /^Example \d+:\s*/);
          current = { type: "example", label, num: parseInt(label.slice(8), 10), body: [{ p: rest }] };
          doc.blocks.push(current);
        } else if (current && (current.type === "example" || current.type === "paragraph")) {
          appendParagraph(current.body, tokens);
        } else {
          current = { type: "paragraph", body: [{ p: tokens }] };
          doc.blocks.push(current);
        }
        bulletList = null;
        break;
      }
      default:
        throw new Error(`Unexpected top-level ${node.role}: ${text.slice(0, 60)}`);
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
//   ntr1 / ntc1        reference to / content of footnote 1, as in EUR-Lex HTML
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
// Internal links carry only a page position. Destinations are mapped to ids
// from the table of contents first, then from link text (section numbers or
// titles, point numbers), and every link to a destination must agree.

function resolveInternalLinks(doc, problems) {
  const headingIds = new Map(doc.headings.map((h) => [h.num, ids.section(h.num)]));
  const titleIds = new Map(doc.headings.map((h) => [h.title.toLowerCase(), ids.section(h.num)]));
  const pointIds = new Set(doc.blocks.filter((b) => b.type === "point").map((b) => ids.point(b.num)));
  const byDest = new Map();
  const assign = (dest, id, why) => {
    const existing = byDest.get(dest);
    if (existing && existing.id !== id) problems.push(`Destination ${dest} resolves to both #${existing.id} (${existing.why}) and #${id} (${why})`);
    else if (!existing) byDest.set(dest, { id, why });
  };
  for (const entry of doc.toc) assign(entry.link.dest, ids.section(entry.num), `TOC ${entry.num}`);

  const links = [];
  const walkTokens = (tokens) => {
    let before = "";
    for (const t of tokens) {
      if (t.link && t.link.dest) links.push({ token: t, before });
      before += t.text;
    }
  };
  const walkBody = (body) => body.forEach((part) => (part.p ? walkTokens(part.p) : part.list.items.forEach((i) => walkBody(i.body))));
  for (const b of doc.blocks) {
    if (b.body) walkBody(b.body);
    if (b.list) b.list.items.forEach((i) => walkBody(i.body));
    if (b.caption) walkTokens(b.caption);
  }
  doc.footnotes.forEach((fn) => walkTokens(fn.tokens));

  for (const { token, before } of links) {
    const t = collapse(token.text).trim();
    const why = `"${before.slice(-20)}${t}"`;
    if (/^\d+\.\d/.test(t) && headingIds.has(t)) assign(token.link.dest, headingIds.get(t), why);
    else if (/points?\s*$|\d\s*(,|and|or|to)\s*$/.test(before) && pointIds.has(ids.point(t))) assign(token.link.dest, ids.point(t), why);
    else if (/sections?\s*$/i.test(before) && headingIds.has(t)) assign(token.link.dest, headingIds.get(t), why);
    else if (titleIds.has(t.toLowerCase())) assign(token.link.dest, titleIds.get(t.toLowerCase()), `title "${t}"`);
  }
  for (const { token, before } of links) {
    const resolved = byDest.get(token.link.dest);
    if (resolved) token.link.href = `#${resolved.id}`;
    else problems.push(`Unresolved internal link "${token.text}" after "${before.slice(-40)}"`);
  }
}

// ---------------------------------------------------------------------------
// Rendering


function renderTokens(tokens) {
  return tokens
    .map((t) => {
      if (!t.link) return escapeHtml(t.text);
      const href = t.link.uri || t.link.href;
      return href ? `<a href="${escapeHtml(href)}">${escapeHtml(t.text)}</a>` : escapeHtml(t.text);
    })
    .join("");
}

// Numbers and labels link to their own anchor. Clicking one also copies its
// URL (see initializeSelfLinks in src/assets/js/site.js).
const selfLink = (id, label, description) =>
  `<a class="self-link" href="#${id}" title="Copy link to ${escapeHtml(description)}">${escapeHtml(label)}</a>`;

function renderBody(body, idPrefix) {
  return body
    .map((part) => {
      if (part.p) return `<p>${renderTokens(part.p)}</p>`;
      const { type, items } = part.list;
      const lis = items
        .map((item) => {
          const id = idPrefix && type !== "Disc" ? ids.subpoint(idPrefix, item.label) : null;
          const label = id ? selfLink(id, item.label, `point ${idPrefix.slice(4)}(${item.label.replace(/\W/g, "")})`) : escapeHtml(item.label);
          return `<li${id ? ` id="${id}"` : ""}><span class="label">${label}</span> ${renderBody(item.body, null)}</li>`;
        })
        .join("\n");
      return type === "Disc" ? `<ul class="labelled">\n${lis}\n</ul>` : `<ol class="labelled">\n${lis}\n</ol>`;
    })
    .join("\n");
}

function renderBlock(b, figures) {
  switch (b.type) {
    case "heading": {
      const id = ids.section(b.num);
      const tag = `h${b.level + 1}`;
      // Top-level sections are rendered as cards, like the rest of the site.
      const cls = b.level === 1 ? ' class="section-card"' : "";
      return `<section id="${id}"${cls}>\n<${tag} id="${id}.tit_1">${selfLink(id, b.num, `Section ${b.num}`)} ${escapeHtml(b.title)}</${tag}>`;
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
      return `<figure id="${id}">\n<img src="${escapeHtml(figures[b.num - 1].src)}" alt="${escapeHtml(plain(b.caption))}">\n<figcaption><strong>${selfLink(id, b.label.replace(/:$/, ""), `Figure ${b.num}`)}:</strong> ${renderTokens(b.caption)}</figcaption>\n</figure>`;
    }
  }
}

// Inserts footnote references into rendered blocks. Each reference is looked
// for, in order, between the previous reference and the place where the
// footnote appeared in the structure tree, by matching the body text that
// precedes the superscript on the page.
function insertFootnoteReferences(rendered, footnotes, contexts, problems) {
  let blockIdx = 0;
  let htmlOffset = 0;
  footnotes.forEach((fn, n) => {
    const needle = contexts[n] + fn.label;
    for (let i = blockIdx; i < fn.before; i++) {
      const html = rendered[i];
      // Map each non-whitespace text character to its offset in the HTML.
      let text = "";
      const offsets = [];
      for (let j = 0; j < html.length; j++) {
        if (html[j] === "<") {
          j = html.indexOf(">", j);
          continue;
        }
        let ch = html[j];
        const start = j;
        if (ch === "&") {
          const end = html.indexOf(";", j);
          ch = decodeEntities(html.slice(j, end + 1));
          j = end;
        }
        if (/\s/.test(ch) || (i === blockIdx && start < htmlOffset)) continue;
        text += ch;
        offsets.push(start);
      }
      const at = text.indexOf(needle);
      if (at === -1) continue;
      if (text.indexOf(needle, at + 1) !== -1) problems.push(`Footnote ${fn.label} reference context is ambiguous: ${needle}`);
      const start = offsets[at + contexts[n].length];
      const end = offsets[at + needle.length - 1] + 1;
      const ref = `<sup class="footnote-ref"><a href="#${ids.footnote(fn.num)}" id="${ids.footnoteRef(fn.num)}">${fn.label}</a></sup>`;
      rendered[i] = html.slice(0, start) + ref + html.slice(end);
      blockIdx = i;
      htmlOffset = start + ref.length;
      return;
    }
    problems.push(`Footnote ${fn.label} reference not found (context "${needle}")`);
  });
}

// Joins rendered blocks, closing each <section> opened by a heading before the
// next heading at the same or a higher level.
function nestSections(blocks, rendered) {
  const open = [];
  let html = "";
  blocks.forEach((b, i) => {
    if (b.type === "heading") {
      while (open.length && open[open.length - 1] >= b.level) {
        open.pop();
        html += "</section>\n";
      }
      open.push(b.level);
    }
    html += `${rendered[i]}\n\n`;
  });
  return html + "</section>\n".repeat(open.length);
}

// Returns the three parts of the page: table of contents, body and footnotes.
function renderDocument(doc, figures, contexts, problems) {
  resolveInternalLinks(doc, problems);
  const rendered = doc.blocks.map((b) => renderBlock(b, figures));
  insertFootnoteReferences(rendered, doc.footnotes, contexts, problems);

  // Nested lists, closing each level's <ol> before a shallower entry.
  let toc = "";
  let depth = 0;
  for (const h of doc.headings) {
    if (h.level > depth) toc += "\n<ol>\n".repeat(h.level - depth);
    else toc += "</li>\n" + "</ol>\n</li>\n".repeat(depth - h.level);
    toc += `<li><a href="#${ids.section(h.num)}">${h.num} ${escapeHtml(h.title)}</a>`;
    depth = h.level;
  }
  toc += "</li>\n</ol>\n".repeat(depth);

  const footnotes = doc.footnotes
    .map((fn) => {
      const id = ids.footnote(fn.num);
      return `<li id="${id}" class="footnote-item"><span class="label">${selfLink(id, fn.label, `footnote ${fn.num}`)}</span> <p>${renderTokens(fn.tokens)} <a href="#${ids.footnoteRef(fn.num)}" class="footnote-backref" aria-label="Back to reference ${fn.num}"></a></p></li>`;
    })
    .join("\n");

  return { toc: toc.trim(), body: nestSections(doc.blocks, rendered).trim(), footnotes };
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
  source: ${yamlString(`"${meta.reference} - Annex" (PDF)`)}
  disclaimer: ${yamlString(`This guidance is subject to the [disclaimer](https://commission.europa.eu/legal-notice_en#disclaimer) published on the European Commission's website.<br><br>The content of this page was generated from the [original PDF](${meta.sourceUrl}) of the guidance, and its text was verified against it. Please check the original PDF for accuracy.`)}
---
<section class="section-card guidance-toc">
<h2 id="toc_1">Contents</h2>
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
// Verification

// Text of the structure tree, split into the body stream and the footnote
// stream, excluding the cover page and table of contents.
function sourceStreams(tree) {
  let body = "";
  let notes = "";
  let coverSeen = false;
  for (const node of tree.children) {
    if (node.role === "TOC") continue;
    const text = compact(textOf(node));
    if (node.role === "P" && text && !coverSeen) {
      coverSeen = true;
      continue;
    }
    if (node.role === "Note") notes += text;
    else body += text;
  }
  return { body, notes };
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

function verify({ tree, doc, parts, pageText, figures }) {
  const problems = [];
  const report = [];
  const check = (name, fn) => {
    const before = problems.length;
    const summary = fn();
    report.push(`${problems.length === before ? "PASS" : "FAIL"} ${name}: ${summary}`);
  };

  // 1. Coverage: every page content character (counted per character, so
  // this doesn't check order) is in the structure tree, bar page furniture.
  check("coverage", () => {
    const tagged = charCounts(compact(textOf(tree)));
    const bodySize = mode(pageText.filter((e) => compact(e.text)).map((e) => e.size));
    const furniture = pageText.filter((e) => /^(\d+|EN)$/.test(compact(e.text)) && e.size >= bodySize && e.top > 1100);
    const allowed = charCounts(compact(furniture.map((e) => e.text).join("")));
    const unexplained = [];
    for (const [ch, n] of charCounts(compact(pageText.map((e) => e.text).join("")))) {
      const missing = n - (tagged.get(ch) || 0) - (allowed.get(ch) || 0);
      if (missing > 0) unexplained.push([ch, missing]);
    }
    if (unexplained.length) problems.push(`Page content missing from the structure tree: ${JSON.stringify(unexplained)}`);
    return `all page text is in the structure tree, except ${furniture.length} untagged page numbers and "EN" markers`;
  });

  // 2. Fidelity: output text equals structure tree text, in order.
  check("fidelity", () => {
    const source = sourceStreams(tree);
    const bodyDiff = firstDifference(source.body, htmlText(parts.body));
    const notesDiff = firstDifference(source.notes, htmlText(parts.footnotes));
    if (bodyDiff) problems.push(`Body text differs from the structure tree ${bodyDiff}`);
    if (notesDiff) problems.push(`Footnote text differs from the structure tree ${notesDiff}`);
    return `HTML text is identical to the structure tree's ${source.body.length} body and ${source.notes.length} footnote characters (whitespace ignored)`;
  });

  // 3. Numbering.
  check("numbering", () => {
    const tocEntries = doc.toc.map((t) => `${t.num} ${t.title}`).join("\n");
    const headings = doc.headings.map((h) => `${h.num} ${h.title}`).join("\n");
    if (compact(tocEntries) !== compact(headings)) problems.push(`Headings don't match the table of contents ${firstDifference(tocEntries, headings)}`);
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
    return (
      `${doc.headings.length} headings match the TOC; ${counts.point} points, ${counts.example} examples, ` +
      `${counts.figure} figures and ${counts.footnote} footnotes numbered 1..n`
    );
  });

  // 4. Figures: each image file is on the page of its caption, or the page
  // before it.
  check("figures", () => {
    const figureBlocks = doc.blocks.filter((b) => b.type === "figure");
    if (figures.length !== figureBlocks.length) problems.push(`${figures.length} images for ${figureBlocks.length} figures`);
    figureBlocks.forEach((b, i) => {
      const caption = pageText.find((e) => compact(e.text).startsWith(compact(b.label)));
      const image = figures[i];
      if (!caption || !image || (image.page !== caption.page && image.page !== caption.page - 1))
        problems.push(`Figure ${b.num}: image on page ${image && image.page}, caption on page ${caption && caption.page}`);
    });
    return `${figures.length} images extracted, each on its caption's page`;
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
    const refs = (html.match(/class="footnote-ref"/g) || []).length;
    if (refs !== doc.footnotes.length) problems.push(`${refs} footnote references for ${doc.footnotes.length} footnotes`);
    return `${all.length} ids are unique, ${hrefs.length} internal links resolve, ${refs}/${doc.footnotes.length} footnote references placed`;
  });

  return { problems, report };
}

function charCounts(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  return counts;
}

// ---------------------------------------------------------------------------

// Extracts the images in their original encoding (PNG or JPEG), skipping the
// Commission logo on the cover page. Images appear in figure order.
function extractFigures(pdf, figuresUrl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guidance-figures-"));
  try {
    execFileSync("pdfimages", ["-all", "-f", "2", pdf, path.join(dir, "img")]);
    const pages = execFileSync("pdfimages", ["-list", "-f", "2", pdf])
      .toString("utf8")
      .split("\n")
      .slice(2)
      .filter((l) => l.trim())
      .map((l) => Number(l.trim().split(/\s+/)[0]));
    return fs
      .readdirSync(dir)
      .sort()
      .map((f, i) => {
        const name = `figure-${i + 1}${path.extname(f)}`;
        return { name, src: `${figuresUrl}/${name}`, page: pages[i], data: fs.readFileSync(path.join(dir, f)) };
      });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// "27.7.2026" -> "2026-07-27"
function isoDate(date) {
  if (!date) return null;
  const [day, month, year] = date.split(".");
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// "27.7.2026" -> "27 July 2026"
function formatDate(date) {
  if (!date) return null;
  const [day, month, year] = date.split(".").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${day} ${months[month - 1]} ${year}`;
}

const TITLE_PREFIX = "Commission guidance on the application of ";

// The Commission's download link for the PDF, from
// https://digital-strategy.ec.europa.eu/en/library/commission-publishes-new-guidance-support-timely-cyber-resilience-act-implementation
const SOURCE_URL = "https://ec.europa.eu/newsroom/dae/redirection/document/131456";

function extract(input, figuresUrl, sourceUrl = SOURCE_URL) {
  const pdf = fs.readFileSync(input);
  const run = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 256 * 1024 * 1024 }).toString("utf8");
  const tree = parseStructText(run("pdfinfo", ["-struct-text", input]));
  const pageText = readPageText(run("pdftohtml", ["-xml", "-i", "-q", "-stdout", input]));
  const doc = buildDocument(tree, readObjectStreams(pdf));

  const problems = [];
  const figures = extractFigures(input, figuresUrl);
  const figureCount = doc.blocks.filter((b) => b.type === "figure").length;
  if (figures.length !== figureCount) throw new Error(`${figures.length} images found for ${figureCount} figures`);

  const contexts = footnoteReferenceContexts(pageText, doc.footnotes.length);
  if (contexts.length !== doc.footnotes.length) problems.push(`${contexts.length} superscript references found for ${doc.footnotes.length} footnotes`);

  const meta = {
    title: doc.cover.match(new RegExp(`(${TITLE_PREFIX}.*?\\))\\s*$`))?.[1],
    reference: doc.cover.match(/C\(\d{4}\) \d+ final/)?.[0],
    date: formatDate(doc.cover.match(/Brussels, (\d+\.\d+\.\d{4})/)?.[1]),
    isoDate: isoDate(doc.cover.match(/Brussels, (\d+\.\d+\.\d{4})/)?.[1]),
    sourceFile: path.basename(input),
    sourceSha256: crypto.createHash("sha256").update(pdf).digest("hex"),
    sourceUrl,
  };
  for (const [key, value] of Object.entries(meta)) if (!value) problems.push(`Could not find the ${key} on the cover page`);

  const parts = renderDocument(doc, figures, contexts, problems);
  const page = renderPage(parts, meta);
  const verification = verify({ tree, doc, parts, pageText, figures });
  return { page, parts, figures, tree, doc, pageText, problems: [...problems, ...verification.problems], report: verification.report };
}

const PAGE = "src/official-guidance.html";
const FIGURES_DIR = "src/assets/images/official-guidance";
const FIGURES_URL = "/assets/images/official-guidance";

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const input = args.find((a) => !a.startsWith("--"));
  if (!input) {
    console.error("Usage: node scripts/extract-guidance.js [--check] <input.pdf>");
    process.exit(2);
  }
  const root = path.join(__dirname, "..");
  const { page, figures, problems, report } = extract(input, FIGURES_URL);
  for (const line of report) console.log(`  ${line}`);
  if (problems.length) {
    for (const p of problems) console.error(`FAILED: ${p}`);
    process.exit(1);
  }

  const figuresPath = path.join(root, FIGURES_DIR);
  const pagePath = path.join(root, PAGE);
  if (check) {
    // Confirms the committed output is exactly what this PDF produces.
    const stale = [];
    if (!fs.existsSync(pagePath) || fs.readFileSync(pagePath, "utf8") !== page) stale.push(PAGE);
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
    console.log("Verification passed; committed output matches the PDF.");
    return;
  }

  fs.rmSync(figuresPath, { recursive: true, force: true });
  fs.mkdirSync(figuresPath, { recursive: true });
  for (const f of figures) fs.writeFileSync(path.join(figuresPath, f.name), f.data);
  fs.writeFileSync(pagePath, page);
  console.log(`Verification passed. Wrote ${PAGE} and ${figures.length} figures to ${FIGURES_DIR}/`);
}

if (require.main === module) main();

module.exports = { parseStructText, buildDocument, readPageText, footnoteReferenceContexts, extract, verify, ids };
