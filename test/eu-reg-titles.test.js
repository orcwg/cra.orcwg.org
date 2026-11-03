const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { extractTitles } = require("../src/_data/utils/eu-reg-titles.js");
const euReg = require("../src/_data/eu-reg.json");
const euRegTitles = require("../src/_data/eu-reg-titles.json");

// Excerpt of EUR-Lex's HTML, in the shape of https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024L2853
const html = `
<div class="eli-subdivision" id="art_1">
   <p id="d1e900-1-1" class="oj-ti-art">Article 1</p>
   <div class="eli-title" id="art_1.tit_1">
      <p class="oj-sti-art">Subject matter and objective</p>
   </div>
   <p class="oj-normal">This Directive lays down common rules.</p>
</div>
<div class="eli-subdivision" id="art_2">
   <p id="d1e950-1-1" class="oj-ti-art">Article 2</p>
   <div class="eli-title" id="art_2.tit_1">
      <p class="oj-sti-art">Scope &amp; definitions of
         ‘product’</p>
   </div>
</div>
<div class="eli-container" id="anx_I">
   <p class="oj-doc-ti" id="d1e38-68-1">ANNEX I</p>
   <p class="oj-doc-ti">ESSENTIAL CYBERSECURITY REQUIREMENTS</p>
   <p id="d1e47-68-1" class="oj-ti-grseq-1">Part I Cybersecurity requirements</p>
</div>
<div class="eli-container" id="anx_II">
   <p class="oj-doc-ti" id="d1e38-69-1">ANNEX II</p>
   <p class="oj-doc-ti">Information and instructions to the user</p>
</div>
`;

describe("extractTitles", () => {
  test("extracts article titles by number, with entities decoded and whitespace normalized", () => {
    assert.deepEqual(extractTitles(html).articleTitles, {
      1: "Subject matter and objective",
      2: "Scope & definitions of ‘product’"
    });
  });

  test("extracts annex titles by numeral", () => {
    assert.deepEqual(extractTitles(html).annexTitles, {
      I: "ESSENTIAL CYBERSECURITY REQUIREMENTS",
      II: "Information and instructions to the user"
    });
  });

  test("yields nothing for HTML without EUR-Lex's article markup", () => {
    assert.deepEqual(extractTitles("<p>Article 1</p><p>Subject matter</p>"), { articleTitles: {}, annexTitles: {} });
  });
});

describe("eu-reg-titles.json", () => {
  test("only holds acts listed in eu-reg.json, in its order", () => {
    const numbers = Object.keys(euRegTitles);
    assert.deepEqual(numbers, Object.keys(euReg).filter((number) => numbers.includes(number)));
  });

  test("holds the CRA's 71 articles and 8 annexes", () => {
    const cra = euRegTitles["2024/2847"];
    assert.equal(Object.keys(cra.articleTitles).length, 71);
    assert.equal(cra.articleTitles[24], "Obligations of open-source software stewards");
    assert.deepEqual(Object.keys(cra.annexTitles), ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]);
  });
});
