/**
 * ENISA Single Reporting Platform (SRP) FAQ page parser
 *
 * Extracts the question/answer pairs and the last update date from ENISA's
 * SRP FAQ web page. The page structure relied upon:
 * - the page title, "All you need to know about the CRA Single Reporting
 *   Platform", in a <div class="quote-wrapper"> (the <h1> only says
 *   "Frequently Asked Questions")
 * - an "<em>Updated: 12 September 2026</em>" line with the last update date
 * - intro paragraphs between that line and the FAQ list
 * - a <dl class="ckeditor-accordion"> of <dt>question</dt><dd>answer</dd> pairs
 *
 * Questions are numbered by ENISA ("4. When will ..."); the number is returned
 * separately from the question text. Questions ENISA changed in the last update
 * are marked "[UPDATED]"; the marker is removed from the question text and
 * returned as the `updated` flag. Answers are converted to Markdown.
 *
 * Also links the cross-references that are specific to ENISA's answers
 * ("FAQ 21", "subsection 5.1"), see linkSrpCrossReferences.
 */

const { htmlToMarkdown, htmlToText, absolutizeLinks } = require("./html-to-markdown.js");
const { replaceOutsideLinks, craArticleLink } = require("./link-resolver.js");
const craReferences = require("../craReferences.json");

const SRP_FAQ_URL = "https://www.enisa.europa.eu/topics/product-security/single-reporting-platform-srp/frequently-asked-questions";

/**
 * Parse ENISA's SRP FAQ page
 *
 * @param {string} html - HTML of the FAQ page
 * @param {string} baseUrl - URL of the page, used to absolutize links
 * @returns {{ title: string|null, lastUpdatedAt: Date|null, intro: string|null, items: Array<{ questionNumber: string|null, question: string, updated: boolean, answer: string }> }}
 * @throws if the page does not contain the FAQ list, or the list is empty
 */
function parseSrpFaqPage(html, baseUrl = SRP_FAQ_URL) {
  const listMatch = html.match(/<dl class="ckeditor-accordion">([\s\S]*?)<\/dl>/);
  if (!listMatch) {
    throw new Error(`Could not find the FAQ list on ${baseUrl}`);
  }

  const titleMatch = html.match(/<div class="quote-wrapper">\s*<p>([\s\S]*?)<\/p>/);
  const title = titleMatch ? htmlToText(titleMatch[1]) || null : null;

  const updateMatch = html.match(/<em>\s*Updated:\s*([^<]+)<\/em>/i);
  const updateDate = updateMatch ? new Date(`${updateMatch[1].trim()} UTC`) : null;
  const lastUpdatedAt = updateDate && !isNaN(updateDate) ? updateDate : null;

  // Intro: the paragraphs between the "Updated" line and the FAQ list, in Markdown
  let intro = null;
  if (updateMatch) {
    const introStart = html.indexOf("</p>", updateMatch.index);
    if (introStart !== -1 && introStart < listMatch.index) {
      intro = htmlToMarkdown(absolutizeLinks(html.slice(introStart + "</p>".length, listMatch.index), baseUrl)) || null;
    }
  }

  const items = [];
  const itemPattern = /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g;
  let match;

  while ((match = itemPattern.exec(listMatch[1])) !== null) {
    const title = htmlToText(match[1]);
    const answer = htmlToMarkdown(absolutizeLinks(match[2], baseUrl));

    // "4. [UPDATED] When will ..." → question number "4", updated, question "When will ..."
    const numberMatch = title.match(/^(\d+)\.\s+(.+)$/);
    const questionNumber = numberMatch ? numberMatch[1] : null;
    const questionText = numberMatch ? numberMatch[2].trim() : title;
    const updatedMatch = questionText.match(/^\[UPDATED\]\s*/i);
    const updated = Boolean(updatedMatch);
    const question = updatedMatch ? questionText.slice(updatedMatch[0].length) : questionText;

    if (question && answer) {
      items.push({ questionNumber, question, updated, answer });
    }
  }

  if (items.length === 0) {
    throw new Error(`No FAQs found on ${baseUrl}`);
  }

  return { title, lastUpdatedAt, intro, items };
}

function markdownLink(text, url, title) {
  return `[${text}](${url} "${title.replace(/"/g, "&quot;")}")`;
}

/**
 * Link cross-references found in ENISA's SRP FAQ answers
 *
 * - "Art. 14(7)", "Art.14", "Article 14(7)" or "Articles 14-17" link to the
 *   corresponding articles of the CRA on EUR-Lex, keeping ENISA's wording
 * - "FAQ 21" links to the SRP FAQ with that number (srp/faq_21)
 * - "Section 5.4", "subsection 5.1" or "subsections 5.1 & 5.3" link to the
 *   corresponding European Commission FAQs (official/faq_5-4, ...), which
 *   ENISA's answers refer to
 *
 * References to FAQs that don't exist, and text already inside a link, are
 * left unchanged. Run before the shared link resolver.
 *
 * @param {string} markdown - Answer in Markdown
 * @param {Object} internalLinks - Index of internal FAQs by id (see createInternalLinkIndex in data.js)
 * @returns {string} Markdown with cross-references linked
 */
function linkSrpCrossReferences(markdown, internalLinks) {
  if (!markdown) return markdown;

  // "Articles 14-17": link each article number
  let result = replaceOutsideLinks(markdown, /\b(Articles\s+)(\d+)(\s*[-–]\s*)(\d+)\b/g, (match, prefix, first, separator, last) => {
    return prefix + craArticleLink(first, first, craReferences) + separator + craArticleLink(last, last, craReferences);
  });

  // "Art. 14(7)", "Art.14", "Art. 14 (3)", "Article 14(7)"
  result = replaceOutsideLinks(result, /\b(?:Art\.\s?|Article\s+)(\d+)(?:\s?\(\d+\))?/g, (match, number) => {
    return craArticleLink(match, number, craReferences);
  });

  result = replaceOutsideLinks(result, /\bFAQ\s+(\d+)\b/g, (match, number) => {
    const faq = internalLinks[`srp/faq_${number}`];
    return faq ? markdownLink(match, faq.permalink, `🚨 ENISA SRP FAQ: ${faq._pageTitle}`) : match;
  });

  const linkCommissionFaq = (number) => {
    const faq = internalLinks[`official/faq_${number.replace(/\./g, "-")}`];
    return faq ? markdownLink(number, faq.permalink, `🇪🇺 Official European Commission FAQ: ${faq._pageTitle}`) : number;
  };

  result = replaceOutsideLinks(result, /\b((?:[Ss]ub)?[Ss]ections?\s+)(\d+\.\d+)(\s*&\s*)?(\d+\.\d+)?/g, (match, prefix, first, separator, second) => {
    return prefix + linkCommissionFaq(first) + (second ? separator + linkCommissionFaq(second) : "");
  });

  return result;
}

module.exports = {
  SRP_FAQ_URL,
  parseSrpFaqPage,
  linkSrpCrossReferences
};
