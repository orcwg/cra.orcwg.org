/**
 * Link Resolution Utilities
 *
 * Converts custom wiki-style markdown syntax to standard markdown links.
 * This module handles:
 * - [[Article 17]] → CRA legislation links
 * - [[category/filename]] → Internal FAQ links
 * - [[category]] → List links
 * - ../relative/path.md → Relative markdown links
 */

const path = require('path');
const euRegData = require('../eu-reg.json');

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
 * @param {string} category - Category for resolving relative links
 * @param {Object} internalLinks - Index of internal FAQ/list links
 * @param {Object} craReferences - CRA article/annex/recital titles
 * @returns {string} Markdown with resolved standard links
 */
function resolveLinks(markdown, category, internalLinks, craReferences) {
  if (!markdown) return markdown;

  let result = markdown;

  // Convert EU Directive/Regulation patterns to links using a single comprehensive regex
  // Captures patterns like: "Directive 2014/53", "Regulation (EU) 2024/2847", "Implementing Regulation (EU) 748/2012", "Delegated Directive 2025/123", etc.
  result = result.replace(/(?:Commission\s+)?(Delegated|Implementing|)\s*(Directive|Regulation)\s*(?:\(EU\)\s*)?(?:No\s+)?(\d{3,4}\/\d{2,4})/g, (match, prefix, type, yearNum) => {
    const regData = euRegData[yearNum];
    if (regData) {
      return mdLink(match, regData.url, `⚖️ ${regData.short_name} - ${regData.description}`);
    }
    return match;
  });

  if (category === 'official') {

    // Convert _4.5.1 Question title?_ patterns (Official EU FAQ cross-references)
    result = result.replace(/_(\d+(?:\.\d+)*)\s+([^_]+)_/g, (match, number, title) => {
      // Look for FAQ with matching question number
      const faqId = `official/faq_${number.replace(/\./g, '-')}`;
      const faq = internalLinks?.[faqId];
      if (faq) {
        return mdLink(`_${number} ${title}_`, faq.permalink, `🇪🇺 Official European Commission FAQ: ${ faq.pageTitle }`);
      }
      return match; // Return original if not found
    });
    
    // Convert parenthetical references to wiki-style syntax, then let existing patterns handle them

    // Natural language legal references (only for official EU FAQs) - BEFORE wiki patterns
    // Convert (Article 13(8)) -> ([[Article 13(8)]])
    result = result.replace(/\(Article\s+(\d+)(\([^)]*\))?\)/g, (match, num, subsection) => {
      return `([[Article ${num}${subsection || ''}]])`;
    });

    // Convert (Annex IV) -> ([[Annex IV]])
    result = result.replace(/\(Annex\s+([IVX]+)\)/g, (match, num) => {
      return `([[Annex ${num.toUpperCase()}]])`;
    });

    // Convert (Recital 35) -> ([[Recital 35]])
    result = result.replace(/\(Recital\s+(\d+)\)/g, (match, num) => {
      return `([[Recital ${num}]])`;
    });
  }

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

  // 6. Convert relative links to files (*.md or other extensions, inline style)
  if (category) {
    result = result.replace(/\[([^\]]+)\]\((\.\.?\/[^)]+)\)/g, (match, linkText, href) => {
      const currentPath = `faq/${category}`;
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

    // 7. Convert relative links (reference-style)
    // Two-phase: collect definitions, then replace usages

    const refDefinitions = new Map();

    // Match: ^[label]: ./path
    result = result.replace(/^\[([^\]]+)\]:\s*(\.\.?\/[^\s]+)(\s|$)/gim, (match, label, href, _whitespace) => {
      const currentPath = `faq/${category}`;
      const resolvedPath = path.posix.resolve('/', currentPath, href);

      // Only process .md and .yml files (FAQs, guidance requests and Lists)
      const pathMatch = resolvedPath.match(/^\/faq\/([^/]+)\/(.+)\.(md|yml)$/);
      if (pathMatch) {
        const [, targetCategory, filename, ext] = pathMatch;

        let targetId;
        if (ext === 'md') {
          targetId = `${targetCategory}/${filename}`;
        } else if (ext === 'yml' && filename === 'README') {
          targetId = `lists/${targetCategory}`;
        }

        if (targetId) {
          const item = internalLinks?.[targetId];
          if (item) {
            // Store for later replacement
            refDefinitions.set(label.toLowerCase(), {
              url: item.permalink,
              title: item.pageTitle || item.title,
              isPage: !!item.pageTitle
            });
            return ''; // Remove definition line
          }
        }
      }
      return match; // Keep if not found
    });

    // Phase 2: Replace usages with inline links
    if (refDefinitions.size > 0) {
      refDefinitions.forEach((ref, label) => {
        // Handle: [text][label] and [label][]
        const refRegex1 = new RegExp(`\\[([^\\]]+)\\]\\[${label}\\]`, 'gi');
        const refRegex2 = new RegExp(`\\[([^\\]]+)\\]\\[\\]`, 'gi');

        const emoji = ref.isPage ? '💬 FAQ' : '💬 FAQ list';
        const inlineLink = (linkText) => mdLink(linkText, ref.url, `${emoji}: ${ref.title}`);

        // Replace [text][label]
        result = result.replace(refRegex1, (_match, linkText) => inlineLink(linkText));

        // Replace [label][] only if text matches
        result = result.replace(refRegex2, (_match, linkText) => {
          if (linkText.toLowerCase() === label) {
            return inlineLink(linkText);
          }
          return _match;
        });
      });
    }
  }

  return result;
}

module.exports = {
  resolveLinks
};
