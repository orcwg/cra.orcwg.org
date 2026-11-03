/**
 * Article and annex titles of an EU act, extracted from its EUR-Lex HTML
 * (the "TXT/HTML" manifestation, e.g.
 * https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R2847).
 *
 * Articles are `<div class="eli-subdivision" id="art_N">` blocks whose title
 * is the first `<p class="oj-sti-art">`; annexes are `<div class="eli-container"
 * id="anx_X">` blocks whose title is the second `<p class="oj-doc-ti">` (the
 * first one is "ANNEX X"). Acts published before EUR-Lex adopted this markup
 * yield nothing.
 */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function text(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
      if (code[0] === "#") return String.fromCodePoint(parseInt(code[1] === "x" ? code.slice(2) : code.slice(1), code[1] === "x" ? 16 : 10));
      return ENTITIES[code.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} html - An act's EUR-Lex HTML
 * @returns {{articleTitles: Object<string, string>, annexTitles: Object<string, string>}}
 */
function extractTitles(html) {
  const articleTitles = {};
  for (const [, number, title] of html.matchAll(/<div class="eli-subdivision" id="art_(\d+)">\s*<p[^>]*class="oj-ti-art">[^<]*<\/p>\s*<div class="eli-title"[^>]*>\s*<p class="oj-sti-art">([\s\S]*?)<\/p>/g)) {
    articleTitles[number] ??= text(title);
  }

  const annexTitles = {};
  for (const [, number, title] of html.matchAll(/<div class="eli-container" id="anx_([IVXLC]+)">\s*<p class="oj-doc-ti"[^>]*>[\s\S]*?<\/p>\s*<p class="oj-doc-ti"[^>]*>([\s\S]*?)<\/p>/g)) {
    annexTitles[number] ??= text(title);
  }

  return { articleTitles, annexTitles };
}

module.exports = { extractTitles };
