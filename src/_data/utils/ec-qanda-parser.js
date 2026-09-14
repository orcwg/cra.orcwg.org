/**
 * European Commission "Cyber Resilience Act - Questions and Answers" parser
 *
 * Extracts the question/answer pairs and dates from the Commission's press
 * corner API response. The document structure relied upon:
 * - an optional "<p><em>*Updated on DD/MM/YYYY</em></p>" line
 * - questions as "<p><strong>Question?</strong></p>" paragraphs, each followed
 *   by the HTML of its answer
 *
 * Questions are returned as found in the document (they are used to build FAQ
 * ids, which must stay stable). Answers are converted to Markdown.
 */

const { htmlToMarkdown } = require("./html-to-markdown.js");

const EC_QANDA_API_URL = "https://ec.europa.eu/commission/presscorner/api/documents?reference=QANDA/22/5375&language=en&ts=1764255415176";

/**
 * Parse the Commission's press corner API response
 *
 * @param {Object} ecData - JSON response of the press corner API
 * @returns {{ createdAt: Date, lastUpdatedAt: Date, items: Array<{ question: string, answer: string }> }}
 */
function parseEcQandaDocument(ecData) {
  let content = ecData.docuLanguageResource.htmlContent;

  // Extract update date and remove it from the content
  const updateMatch = content.match(/\*Updated on (\d{2})\/(\d{2})\/(\d{4})/);
  let updateDate = null;

  if (updateMatch) {
    const [, day, month, year] = updateMatch;
    updateDate = new Date(`${year}-${month}-${day}`);
    content = content.replace(/<p><em>\*Updated on \d{2}\/\d{2}\/\d{4}<\/em><\/p>/, "").trim();
  }

  const createdAt = new Date(ecData.publishDate);
  const lastUpdatedAt = updateDate || createdAt;

  const sections = content
    .split(/<p><strong>(.*?)<\/strong><\/p>/g)
    .map(s => s.replace("<p>&nbsp;</p>", "").trim())
    .filter(s => s);

  const items = [];
  for (let i = 0; i < sections.length - 1; i += 2) {
    const question = sections[i];
    const answer = htmlToMarkdown(sections[i + 1]);

    if (question && answer) {
      items.push({ question, answer });
    }
  }

  return { createdAt, lastUpdatedAt, items };
}

module.exports = {
  EC_QANDA_API_URL,
  parseEcQandaDocument
};
