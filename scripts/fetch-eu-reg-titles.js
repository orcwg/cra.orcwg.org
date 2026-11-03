#!/usr/bin/env node
// Fetches the article and annex titles of the EU acts listed in
// src/_data/eu-reg.json from their EUR-Lex HTML and writes them to
// src/_data/eu-reg-titles.json, which the link resolver uses for the
// tooltips of [[CRA Article 24]], [[PLD Article 5]] and the like.
//
// Usage: node scripts/fetch-eu-reg-titles.js [--from <dir>] [<number>...]
//
//   --from <dir>  Read each act's HTML from <dir>/<CELEX>.html instead of
//                 fetching it from EUR-Lex (e.g. from copies kept elsewhere).
//   <number>      Only these acts, by their key in eu-reg.json ("2024/2853").
//                 Default: every act with a CELEX number (so not the Blue Guide).
//
// Existing entries are kept for acts that are skipped, fail to fetch or
// yield no titles (EUR-Lex's older HTML has no article markup), with a
// warning for the last two.

const fs = require("fs");
const path = require("path");
const { extractTitles } = require("../src/_data/utils/eu-reg-titles.js");

const EU_REG = path.join(__dirname, "../src/_data/eu-reg.json");
const OUTPUT = path.join(__dirname, "../src/_data/eu-reg-titles.json");
const EUR_LEX_HTML_URL = "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:";

async function main(argv) {
  const args = [...argv];
  const fromIndex = args.indexOf("--from");
  const from = fromIndex === -1 ? null : args.splice(fromIndex, 2)[1];
  if (fromIndex !== -1 && !from) throw new Error("--from needs a directory");

  const euReg = JSON.parse(fs.readFileSync(EU_REG, "utf8"));
  const titles = fs.existsSync(OUTPUT) ? JSON.parse(fs.readFileSync(OUTPUT, "utf8")) : {};

  const acts = Object.entries(euReg).filter(([number, reg]) => /^\d+\/\d+$/.test(number) && /CELEX:/.test(reg.url));
  const wanted = args.length ? acts.filter(([number]) => args.includes(number)) : acts;
  for (const number of args) {
    if (!acts.some(([n]) => n === number)) throw new Error(`Not an act in eu-reg.json: ${number}`);
  }

  for (const [number, reg] of wanted) {
    const celex = reg.url.match(/CELEX:([^&#]+)/)[1];
    let html;
    try {
      if (from) {
        html = fs.readFileSync(path.join(from, `${celex}.html`), "utf8");
      } else {
        const response = await fetch(EUR_LEX_HTML_URL + celex);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        html = await response.text();
      }
    } catch (error) {
      console.warn(`${number} (${reg.short_name}): not fetched, ${error.message}${titles[number] ? "; keeping the existing titles" : ""}`);
      continue;
    }
    const extracted = extractTitles(html);
    const articles = Object.keys(extracted.articleTitles).length;
    if (articles === 0) {
      console.warn(`${number} (${reg.short_name}): no article titles in its HTML${titles[number] ? "; keeping the existing titles" : ""}`);
      continue;
    }
    titles[number] = extracted;
    console.log(`${number} (${reg.short_name}): ${articles} articles, ${Object.keys(extracted.annexTitles).length} annexes`);
  }

  // Same order as eu-reg.json
  const ordered = Object.fromEntries(Object.keys(euReg).filter((number) => titles[number]).map((number) => [number, titles[number]]));
  fs.writeFileSync(OUTPUT, JSON.stringify(ordered, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)}: ${Object.keys(ordered).length} acts`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
