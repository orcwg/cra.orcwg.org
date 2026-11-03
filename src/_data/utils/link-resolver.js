/**
 * Link Resolution Utilities
 *
 * Converts custom wiki-style markdown syntax to standard markdown links.
 * This module handles:
 * - [[Article 17]] → CRA legislation links
 * - [[2024/2853 Article 5]], [[PLD Article 5]] → links into other EU acts, by their number in eu-reg.json or their `cite` key
 * - [[CRA-GUIDANCE Section 3.2.4]], [[CRA-GUIDANCE point 71]] → links into the Commission's CRA guidance
 * - [[category/filename]] → Internal FAQ links
 * - [[category]] → List links
 * - ../relative/path.md → Relative markdown links
 */

const path = require('path');
const euRegData = require('../eu-reg.json');
const officialGuidance = require('../official-guidance.json');

const EUR_LEX_HTML_URL = 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:';
const CRA_BASE_URL = `${EUR_LEX_HTML_URL}32024R2847`;

// Documents that can be cited with a prefix, e.g. [[2024/2853 Article 5]],
// [[PLD Article 5]] or [[CRA-GUIDANCE Section 3.2.4]]. The prefix is the number
// of an act in eu-reg.json ("2024/2853"), the `cite` key the few best-known
// acts also have ("PLD"), or CRA-GUIDANCE for the Commission's guidance. Each
// entry resolves a reference ("Article 5", "point 71") to {text, url, title},
// or undefined when the document has no such part.
const EUR_LEX_ANCHORS = { article: 'art_', recital: 'rct_', annex: 'anx_' };

function euRegDocument(reg) {
  const base = EUR_LEX_HTML_URL + reg.url.match(/CELEX:([^&#]+)/)[1];
  // "the PLD" for an act with a cite key, otherwise the act's own name
  // from the start of its full title: "Directive (EU) 2024/2853"
  const name = reg.cite_name || reg.full_title.match(/^.*?\d+\/\d+(?:\/EU)?/)[0];
  return (type, number, displayNumber) => {
    const anchor = EUR_LEX_ANCHORS[type];
    if (!anchor) return undefined;
    const part = `${type[0].toUpperCase()}${type.slice(1)} ${displayNumber}`;
    return {
      text: `${part} of ${name}`,
      url: `${base}#${anchor}${number}`,
      title: `⚖️ ${reg.short_name} - ${part}`
    };
  };
}

function guidanceDocument(doc) {
  // Index every citable part ("section 3.2.4", "point 71", "example 3", "figure 2") by its cite, lowercased
  const parts = {};
  const walk = (section) => {
    parts[section.cite.toLowerCase()] = { id: section.id, label: `${section.cite} - ${section.title}` };
    for (const item of section.content || []) {
      if (!item.cite) continue;
      parts[item.cite.toLowerCase()] = { id: item.id, label: `${item.cite} (${section.cite} - ${section.title})` };
    }
    for (const sub of section.sections || []) walk(sub);
  };
  for (const section of doc.sections) walk(section);

  return (type, number) => {
    const part = parts[`${type} ${number}`];
    if (!part) return undefined;
    const cite = part.label.split(' (')[0].split(' - ')[0];
    return {
      text: `${cite} of the Commission guidance`,
      url: `${doc.permalink}#${part.id}`,
      title: `🇪🇺 ${doc.shortTitle} - ${part.label}`
    };
  };
}

const CITABLE_DOCUMENTS = Object.fromEntries([
  ...Object.entries(euRegData)
    .filter(([number]) => /^\d+\/\d+$/.test(number)) // acts, not the Blue Guide
    .flatMap(([number, reg]) => {
      const document = euRegDocument(reg);
      return reg.cite ? [[number, document], [reg.cite, document]] : [[number, document]];
    }),
  ['CRA-GUIDANCE', guidanceDocument(officialGuidance)]
]);

/**
 * Helper to create markdown link with optional title
 */
function mdLink(text, url, title) {
  title = title ? ` "${title.replace(/"/g, '&quot;')}"` : "";
  return `[${text}](${url}${title})`;
}

/**
 * Markdown link to an article of the CRA on EUR-Lex
 *
 * @param {string} text - Link text, e.g. "Article 14(7)" or "Art. 14(7)"
 * @param {string|number} number - Article number
 * @param {Object} craReferences - CRA article/annex/recital titles
 */
function craArticleLink(text, number, craReferences) {
  const title = craReferences?.articleTitles?.[number] || "Unknown article";
  return mdLink(text, `${CRA_BASE_URL}#art_${number}`, `⚖️ Article ${number} - ${title}`);
}

// Existing Markdown links: [text](url "title"), allowing escaped or balanced parentheses in the url
const MARKDOWN_LINK_PATTERN = /!?\[(?:[^\[\]]|\[[^\]]*\])*\]\((?:\\.|[^()\\]|\([^()]*\))*\)/g;

/**
 * Apply a regex replacement only outside of existing Markdown links, so that
 * links are never inserted inside the text of another link (nested links
 * break the outer link when rendered)
 */
function replaceOutsideLinks(text, pattern, replacer) {
  let output = "";
  let lastIndex = 0;
  for (const link of text.matchAll(MARKDOWN_LINK_PATTERN)) {
    output += text.slice(lastIndex, link.index).replace(pattern, replacer) + link[0];
    lastIndex = link.index + link[0].length;
  }
  return output + text.slice(lastIndex).replace(pattern, replacer);
}

/**
 * Resolve all custom link syntax in markdown content
 *
 * @param {string} markdown - Raw markdown content with custom syntax
 * @param {string} linkResolutionContext - Context path for resolving relative links
 * @param {Object} internalLinks - Index of internal FAQ/list links
 * @param {Object} craReferences - CRA article/annex/recital titles
 * @returns {string} Markdown with resolved standard links
 */
function resolveLinks(markdown, linkResolutionContext, internalLinks, craReferences, caller) {
  if (!markdown) return markdown;

  let result = markdown;

  // Convert EU Directive/Regulation patterns to links using a single comprehensive regex
  // Captures patterns like: "Directive 2014/53", "Regulation (EU) 2024/2847", "Implementing Regulation (EU) 748/2012", "Delegated Directive 2025/123", etc.
  result = replaceOutsideLinks(result, /(?:Commission\s+)?(Delegated|Implementing|)\s*(Directive|Regulation)\s*(?:\(EU\)\s*)?(?:No\s+)?(\d{3,4}\/\d{2,4})/g, (match, prefix, type, yearNum) => {
    const regData = euRegData[yearNum];
    if (regData) {
      return mdLink(match, regData.url, `⚖️ ${regData.short_name} - ${regData.description}`);
    }
    return match;
  });

  // Convert "Blue Guide" references to links
  result = replaceOutsideLinks(result, /\bBlue Guide\b/g, (match) => {
    const blueGuideData = euRegData['52022XC0629(04)'];
    if (blueGuideData) {
      return mdLink(match, blueGuideData.url, `📘 ${blueGuideData.short_name} - ${blueGuideData.description}`);
    }
    return match;
  });

  if (linkResolutionContext === 'official') {

    // Convert _4.5.1 Question title?_ or *4.5.1 Question title?* patterns (Official EU FAQ cross-references)
    // Handles both underscore and asterisk italic delimiters
    const convertOfficialFaqRef = (match, delimiter, number, title) => {
      // Look for FAQ with matching question number
      const faqId = `official/faq_${number.replace(/\./g, '-')}`;
      const faq = internalLinks?.[faqId];
      if (faq) {
        return mdLink(`${delimiter}${number} ${title}${delimiter}`, faq.permalink, `🇪🇺 Official European Commission FAQ: ${ faq._pageTitle }`);
      }
      return match; // Return original if not found
    };

    // Match underscore-delimited patterns
    result = result.replace(/(_)(\d+(?:\.\d+)*)\s+([^_]+)_/g, convertOfficialFaqRef);

    // Match asterisk-delimited patterns
    result = result.replace(/(\*)(\d+(?:\.\d+)*)\s+([^*]+)\*/g, convertOfficialFaqRef);
    
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

  // 0. Convert prefixed [[DOC Article 5]], [[DOC Recital 3]], [[DOC Annex I]], [[DOC Section 3.2.4]],
  //    [[DOC point 71]], [[DOC Example 3]] and [[DOC Figure 2]] patterns, where DOC is a citable document:
  //    an act's number (2024/2853) or cite key (PLD), or CRA-GUIDANCE. Unknown documents or parts are left as written.
  result = result.replace(/\[\[(\d+\/\d+|[A-Z][A-Z0-9-]*)\s+(Article|Art\.|Recital|Rec\.|Annex|Section|point|Example|Figure)\s+([^\]\s]+(?:,\s+Part\s+[IVX]+)?)\]\]/gi, (match, prefix, type, number) => {
    const document = CITABLE_DOCUMENTS[prefix.toUpperCase()];
    if (!document) return match;
    // The CRA is the site's subject: [[CRA Article 5]] renders like [[Article 5]] (steps 1 to 3 below)
    if (document === CITABLE_DOCUMENTS.CRA) return `[[${type} ${number}]]`;
    type = { art: 'article', rec: 'recital' }[type.slice(0, 3).toLowerCase()] || type.toLowerCase();
    const displayNumber = type === 'annex' ? number.replace(/^([ivx]+)(,\s+Part\s+)?([ivx]+)?$/i, (m, annex, sep, part) => `${annex.toUpperCase()}${sep ? sep + part.toUpperCase() : ''}`) : number;
    const anchorNumber = type === 'article' ? number.match(/^\d+/)?.[0] : type === 'annex' ? displayNumber.split(',')[0] : number;
    if (!anchorNumber) return match;
    const link = document(type, anchorNumber, displayNumber);
    return link ? mdLink(link.text, link.url, link.title) : match;
  });

  // 1. Convert [[Article X]] patterns
  result = result.replace(/\[\[(ARTICLE|ART\.)\s+(\d+)(\([^)]*\))?\]\]/gi, (match, type, num, subsection) => {
    return craArticleLink(`Article ${num}${subsection || ''}`, num, craReferences);
  });

  // 2. Convert [[Annex X]] patterns, including extended syntax like [[Annex I, Part I]]
  result = result.replace(/\[\[ANNEX\s+([IVX]+)(?:,?\s+Part\s+([IVX]+))?\]\]/gi, (match, annexNum, partNum) => {
    annexNum = annexNum.toUpperCase();
    const displayText = partNum ? `Annex ${annexNum}, Part ${partNum.toUpperCase()}` : `Annex ${annexNum}`;
    const title = craReferences?.annexTitles?.[annexNum] || "Unknown annex";
    return mdLink(displayText, `${CRA_BASE_URL}#anx_${annexNum}`, `⚖️ Annex ${annexNum} - ${title}`);
  });

  // 3. Convert [[Recital X]] patterns
  result = result.replace(/\[\[(RECITAL|REC\.)\s+(\d+)\]\]/gi, (match, type, num) => {
    return mdLink(`Recital ${num}`, `${CRA_BASE_URL}#rct_${num}`, `⚖️ Recital ${num}`);
  });

  // 4. Convert [[category/filename]] patterns (FAQ references)
  result = result.replace(/\[\[([a-z0-9_-]+\/[a-z0-9_-]+)\]\]/gi, (match, faqId) => {
    const faq = internalLinks?.[faqId];
    if (faq) {
      return mdLink(faq._pageTitle, faq.permalink, `💬 FAQ: ${faq._pageTitle}`);
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
  if (linkResolutionContext) {
    result = result.replace(/\[([^\]]+)\]\((\.\.?\/[^)]+)\)/g, (match, linkText, href) => {
      const currentPath = `faq/${linkResolutionContext}`;
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
            if (item._pageTitle) {
              return mdLink(linkText, item.permalink, `💬 FAQ: ${item._pageTitle}`);
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
      const currentPath = `faq/${linkResolutionContext}`;
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
              title: item._pageTitle || item.title,
              isPage: !!item._pageTitle
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
  resolveLinks,
  replaceOutsideLinks,
  craArticleLink
};
