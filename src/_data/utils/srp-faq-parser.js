/**
 * ENISA Single Reporting Platform (SRP) FAQ page parser
 *
 * Extracts the question/answer pairs and the last update date from ENISA's
 * SRP FAQ web page. The page structure relied upon:
 * - an "<em>Updated: 12 September 2026</em>" line with the last update date
 * - a <dl class="ckeditor-accordion"> of <dt>question</dt><dd>answer</dd> pairs
 *
 * Questions are numbered by ENISA ("4. When will ..."); the number is returned
 * separately from the question text. Answers are converted to Markdown.
 */

const { htmlToMarkdown, htmlToText, absolutizeLinks } = require("./html-to-markdown.js");

const SRP_FAQ_URL = "https://www.enisa.europa.eu/topics/product-security/single-reporting-platform-srp/frequently-asked-questions";

/**
 * Parse ENISA's SRP FAQ page
 *
 * @param {string} html - HTML of the FAQ page
 * @param {string} baseUrl - URL of the page, used to absolutize links
 * @returns {{ lastUpdatedAt: Date|null, items: Array<{ questionNumber: string|null, question: string, answer: string }> }}
 * @throws if the page does not contain the FAQ list, or the list is empty
 */
function parseSrpFaqPage(html, baseUrl = SRP_FAQ_URL) {
  const listMatch = html.match(/<dl class="ckeditor-accordion">([\s\S]*?)<\/dl>/);
  if (!listMatch) {
    throw new Error(`Could not find the FAQ list on ${baseUrl}`);
  }

  const updateMatch = html.match(/<em>\s*Updated:\s*([^<]+)<\/em>/i);
  const updateDate = updateMatch ? new Date(`${updateMatch[1].trim()} UTC`) : null;
  const lastUpdatedAt = updateDate && !isNaN(updateDate) ? updateDate : null;

  const items = [];
  const itemPattern = /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g;
  let match;

  while ((match = itemPattern.exec(listMatch[1])) !== null) {
    const title = htmlToText(match[1]);
    const answer = htmlToMarkdown(absolutizeLinks(match[2], baseUrl));

    // "4. When will ..." → question number "4", question "When will ..."
    const numberMatch = title.match(/^(\d+)\.\s+(.+)$/);
    const questionNumber = numberMatch ? numberMatch[1] : null;
    const question = numberMatch ? numberMatch[2].trim() : title;

    if (question && answer) {
      items.push({ questionNumber, question, answer });
    }
  }

  if (items.length === 0) {
    throw new Error(`No FAQs found on ${baseUrl}`);
  }

  return { lastUpdatedAt, items };
}

module.exports = {
  SRP_FAQ_URL,
  parseSrpFaqPage
};
