/**
 * Link Resolution Utilities
 *
 * Converts custom wiki-style markdown syntax to standard markdown links.
 * This module handles:
 * - [[Article 17]] → CRA legislation links
 * - [[category/filename]] → Internal FAQ links
 * - [[category]] → Curated list links
 * - ../relative/path.md → Relative markdown links
 */

const path = require('path');

const CRA_BASE_URL = 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L_202402847';

/**
 * Helper to create markdown link with optional title
 */
function mdLink(text, url, title) {
  title = title ? ` "${title.replace(/"/g, '&quot;')}"` : "";
  return `[${text}](${url}${title})`;
}

/**
 * Resolve all custom link syntax in markdown content
 *
 * @param {string} markdown - Raw markdown content with custom syntax
 * @param {Object} context - Context object with category info
 * @param {Object} internalLinks - Index of internal FAQ/list links
 * @param {Object} craReferences - CRA article/annex/recital titles
 * @returns {string} Markdown with resolved standard links
 */
function resolveLinks(markdown, context, internalLinks, craReferences) {
  if (!markdown) return markdown;

  let result = markdown;

  // 1. Convert [[Article X]] patterns
  result = result.replace(/\[\[(ARTICLE|ART\.)\s+(\d+)(\([^)]*\))?\]\]/gi, (match, type, num, subsection) => {
    const displayText = `Article ${num}${subsection || ''}`;
    const title = craReferences?.articleTitles?.[num] || "Unknown article";
    return mdLink(displayText, `${CRA_BASE_URL}#art_${num}`, `⚖️ Article ${num} - ${title}`);
  });

  // 2. Convert [[Annex X]] patterns
  result = result.replace(/\[\[ANNEX\s+([IVX]+)\]\]/gi, (match, num) => {
    num = num.toUpperCase();
    const title = craReferences?.annexTitles?.[num] || "Unknown annex";
    return mdLink(`Annex ${num}`, `${CRA_BASE_URL}#anx_${num}`, `⚖️ Annex ${num} - ${title}`);
  });

  // 3. Convert [[Recital X]] patterns
  result = result.replace(/\[\[(RECITAL|REC\.)\s+(\d+)\]\]/gi, (match, type, num) => {
    return mdLink(`Recital ${num}`, `${CRA_BASE_URL}#rct_${num}`, `⚖️ Recital ${num}`);
  });

  // 4. Convert [[category/filename]] patterns (FAQ references)
  result = result.replace(/\[\[([a-z0-9-]+\/[a-z0-9-]+)\]\]/gi, (match, faqId) => {
    const faq = internalLinks?.[faqId];
    if (faq) {
      return mdLink(faq.pageTitle, faq.permalink, `💬 FAQ: ${faq.pageTitle}`);
    }
    return match;
  });

  // 5. Convert [[category]] patterns (list references)
  result = result.replace(/\[\[([a-z0-9-]+)\]\]/gi, (match, categoryName) => {
    const listId = `lists/${categoryName}`;
    const list = internalLinks?.[listId];
    if (list) {
      const icon = list.icon ? `${list.icon} ` : '';
      const linkText = `${icon}${list.title} FAQ list`;
      return mdLink(linkText, list.permalink, `${linkText} - ${list.description}`);
    }
    return match;
  });

  // 6. Convert relative .md links
  if (context && context.category) {
    result = result.replace(/\[([^\]]+)\]\((\.\.?\/[^)]+\.(md|yml))\)/gi, (match, linkText, href) => {
      const currentPath = `faq/${context.category}`;
      const resolvedPath = path.posix.resolve('/', currentPath, href);

      const pathMatch = resolvedPath.match(/^\/faq\/([^/]+)\/(.+)\.(md|yml)$/);
      if (pathMatch) {
        const [, targetCategory, filename, extension] = pathMatch;

        let targetId;
        if (extension === 'md') {
          targetId = `${targetCategory}/${filename}`;
        } else if (extension === 'yml' && filename === 'README') {
          targetId = `lists/${targetCategory}`;
        }

        if (targetId) {
          const item = internalLinks?.[targetId];
          if (item) {
            if (item.pageTitle) {
              return mdLink(linkText, item.permalink, `💬 FAQ: ${item.pageTitle}`);
            } else if (item.title) {
              return mdLink(linkText, item.permalink, `💬 FAQ list: ${item.title}`);
            }
          }
        }
      }
      return match;
    });
  }

  return result;
}

module.exports = {
  resolveLinks
};
