/**
 * Link Resolution Utilities
 *
 * Converts custom wiki-style markdown syntax to standard markdown links.
 * This module handles:
 * - [[Article 17]] → CRA legislation links
 * - [[2024/2853 Article 5]], [[PLD Article 5]] → links into other EU acts, by their number in eu-reg.json or their `cite` key
 * - [[CRA-GUIDANCE Section 3.2.4]], [[CRA-GUIDANCE point 71]] → links into the Commission's CRA guidance
 * - [[category/filename]], [[category/sublist/filename]] → Internal FAQ links
 * - [[category]] → List links
 * - [[pending-guidance/filename]] → Links to a request for Commission guidance
 * - [[CRA Article 25 | security attestations]] → any of the above, with the link text given after the pipe
 * - ../relative/path.md → Relative markdown links
 */

const path = require('path');
const euRegData = require('../eu-reg.json');
const officialGuidance = require('../official-guidance.json');
// Article and annex titles per act, from scripts/fetch-eu-reg-titles.js
const euRegTitles = require('../eu-reg-titles.json');

const EUR_LEX_HTML_URL = 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:';
const CRA_BASE_URL = `${EUR_LEX_HTML_URL}32024R2847`;

// Documents that can be cited with a prefix, e.g. [[2024/2853 Article 5]],
// [[PLD Article 5]] or [[CRA-GUIDANCE Section 3.2.4]]. The prefix is the number
// of an act in eu-reg.json ("2024/2853"), the `cite` key the few best-known
// acts also have ("PLD"), or CRA-GUIDANCE for the Commission's guidance. Each
// entry resolves a reference ("Article 5", "point 71") to {text, url, title},
// or undefined when the document has no such part.
const EUR_LEX_ANCHORS = { article: 'art_', recital: 'rct_', annex: 'anx_' };

function euRegDocument(number, reg) {
  const titles = euRegTitles[number];
  const base = EUR_LEX_HTML_URL + reg.url.match(/CELEX:([^&#]+)/)[1];
  // "the PLD" for an act with a cite key, otherwise the act's own name
  // from the start of its full title: "Directive (EU) 2024/2853"
  const name = reg.cite_name || reg.full_title.match(/^.*?\d+\/\d+(?:\/EU)?/)[0];
  const resolve = (type, number, displayNumber) => {
    const anchor = EUR_LEX_ANCHORS[type];
    if (!anchor) return undefined;
    const part = `${type[0].toUpperCase()}${type.slice(1)} ${displayNumber}`;
    return {
      text: `${part} of ${name}`,
      url: `${base}#${anchor}${number}`,
      title: `⚖️ ${reg.short_name} - ${part}${partTitle(titles, type, number)}`
    };
  };
  // "PLD" or "2024/2853" in the short form used inside a parenthesis: "(PLD Article 5)"
  resolve.shortName = (reg.cite_name || number).replace(/^the /, '');
  return resolve;
}

// " - Right to compensation" for an article or annex whose title is known; recitals have none
function partTitle(titles, type, number) {
  if (type === 'recital') return '';
  const title = titles?.[type === 'annex' ? 'annexTitles' : 'articleTitles']?.[number];
  return title ? ` - ${title}` : '';
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

  const resolve = (type, number) => {
    const part = parts[`${type} ${number}`];
    if (!part) return undefined;
    const cite = part.label.split(' (')[0].split(' - ')[0];
    return {
      text: `${cite} of the Commission guidance`,
      url: `${doc.permalink}#${part.id}`,
      title: `🇪🇺 ${doc.shortTitle} - ${part.label}`
    };
  };
  resolve.shortName = 'Guidance';
  return resolve;
}

const CITABLE_DOCUMENTS = Object.fromEntries([
  ...Object.entries(euRegData)
    .filter(([number]) => /^\d+\/\d+$/.test(number)) // acts, not the Blue Guide
    .flatMap(([number, reg]) => {
      const document = euRegDocument(number, reg);
      return reg.cite ? [[number, document], [reg.cite, document]] : [[number, document]];
    }),
  ['CRA-GUIDANCE', guidanceDocument(officialGuidance)]
]);

const PREFIXED_CITATION = /\[\[(\d+\/\d+|[A-Z][A-Z0-9-]*)\s+(Article|Art\.|Recital|Rec\.|Annex|Section|point|Example|Figure)\s+([^\]\s]+(?:,\s+Part\s+[IVX]+)?)\]\]/i;

/**
 * Parse one prefixed citation, "[[PLD Article 5]]", into its document, part type, display
 * number and resolved link, or undefined when it is not one or doesn't resolve
 */
function parseCitation(citation) {
  const match = citation.match(PREFIXED_CITATION);
  if (!match || match[0] !== citation) return undefined;
  let [, prefix, type, number] = match;
  const document = CITABLE_DOCUMENTS[prefix.toUpperCase()];
  if (!document) return undefined;
  type = { art: 'article', rec: 'recital' }[type.slice(0, 3).toLowerCase()] || type.toLowerCase();
  const displayNumber = type === 'annex' ? number.replace(/^([ivx]+)(,\s+Part\s+)?([ivx]+)?$/i, (m, annex, sep, part) => `${annex.toUpperCase()}${sep ? sep + part.toUpperCase() : ''}`) : number;
  const anchorNumber = type === 'article' ? number.match(/^\d+/)?.[0] : type === 'annex' ? displayNumber.split(',')[0] : number;
  if (!anchorNumber) return undefined;
  const link = document(type, anchorNumber, displayNumber);
  return link && { document, type, displayNumber, link };
}

const PLURALS = { annex: 'Annexes' };

/**
 * Render citations in the short form, grouped by document and part type: "CRA Recital 15,
 * Guidance points 52, 53, and 76, Example 18". Consecutive citations of the same document share its name, and
 * consecutive citations of the same part type share the type's name and are joined with
 * "and"; every citation stays its own link.
 */
function groupCitations(citations) {
  const groups = [];
  for (const citation of citations) {
    const group = groups.at(-1);
    if (group && group.document === citation.document && group.type === citation.type) group.citations.push(citation);
    else groups.push({ document: citation.document, type: citation.type, citations: [citation] });
  }
  return groups.map((group, i) => {
    const plural = group.citations.length > 1;
    const type = plural ? PLURALS[group.type] || `${group.type}s` : group.type;
    const label = group.type === 'point' ? type : `${type[0].toUpperCase()}${type.slice(1)}`;
    const name = groups[i - 1]?.document === group.document ? '' : `${group.document.shortName} `;
    const links = group.citations.map((citation, j) => mdLink((j === 0 ? `${name}${label} ` : '') + citation.displayNumber, citation.link.url, citation.link.title));
    return links.length > 2 ? `${links.slice(0, -1).join(', ')}, and ${links.at(-1)}` : links.join(' and ');
  }).join(', ');
}

/**
 * Helper to create markdown link with optional title
 */
function mdLink(text, url, title) {
  title = title ? ` "${title.replace(/"/g, '&quot;')}"` : "";
  return `[${text}](${url}${title})`;
}

// A cross-reference in the Commission's FAQ: an italic question or section number, "_1.3_", "*1.3*",
// "_section 6.8_" or "_1.2 What is a product with digital elements?_", or a plain "section 6.7".
// The rest of the line is captured too, since the title may continue there.
const OFFICIAL_CROSS_REFERENCE = /(?:(_|\*)(?:section\s+)?(\d+(?:\.\d+)+)(?:\s+([^_*\n]+?))?\1|\bsection\s+(\d+(?:\.\d+)+))([^\n]*)/gi;

/**
 * Link the cross-references between the Commission's own FAQs.
 *
 * The Markdown version of the Commission's FAQ writes them as an italic question or section number,
 * followed by the question's title either inside the italics ("_1.2 What is a product with digital elements?_"),
 * partly inside ("_7.2 A manufacturer develops a product type before the CRA applies._ Can it continue [...]?"),
 * or entirely outside ("_1.3_ What is a direct or indirect logical or physical data connection?",
 * "see section _4.1_ Risk-based approach and risk-assessment", "see _section 6.8_ What is the declaration of conformity?").
 * The italics may use underscores or asterisks. Occasionally the number isn't in italics at all
 * ("see section 6.7 What is the CE marking?"); such a reference counts only when the title follows it,
 * since "section 2.3 of the Blue Guide" is a section of another document.
 *
 * Each becomes a link to the question, or to the section when the number is a section's. The link covers the
 * number and, when the text that follows is the target's title, the title too; otherwise only the italic part.
 * Numbers that match neither a question nor a section are left as written.
 *
 * @param {string} markdown - Answer of an official FAQ
 * @param {Object} internalLinks - Index of internal FAQ/list links
 * @returns {string} Markdown with the cross-references linked
 */
function linkOfficialCrossReferences(markdown, internalLinks) {
  if (!markdown) return markdown;
  return replaceOutsideLinks(markdown, OFFICIAL_CROSS_REFERENCE, (match, delimiter, italicNumber, innerTitle, plainNumber, rest) => {
    const number = italicNumber || plainNumber;
    const reference = match.slice(0, match.length - rest.length);
    const target = findOfficialItem(number, internalLinks);
    const titleLength = target ? officialTitleLength(target._pageTitle, innerTitle, rest) : 0;
    // The rest of the line may hold further cross-references
    const linkRest = (text) => linkOfficialCrossReferences(text, internalLinks);

    if (!target || (!delimiter && !titleLength)) return reference + linkRest(rest);

    const tooltip = target.type === 'list'
      ? `🇪🇺 Official European Commission FAQ section ${number}: ${target._pageTitle}`
      : `🇪🇺 Official European Commission FAQ: ${target._pageTitle}`;
    return mdLink(reference + rest.slice(0, titleLength), target.permalink, tooltip) + linkRest(rest.slice(titleLength));
  });
}

// The official question or section a number designates, if any
function findOfficialItem(number, internalLinks) {
  if (!internalLinks) return undefined;
  const faq = internalLinks[`official/faq_${number.replace(/\./g, '-')}`];
  if (faq) return faq;
  return Object.values(internalLinks).find(item =>
    item.type === 'list' && item._sectionNumber === number && typeof item.id === 'string' && item.id.startsWith('official/'));
}

// Ignore whitespace, case and the shape of quotes when comparing a reference's text with a title
const normalizeTitleChar = (c) => /\s/.test(c) ? '' : c.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
const normalizeTitle = (text) => [...text].map(normalizeTitleChar).join('');

/**
 * How many characters of `rest`, the text following an italic cross-reference, complete the target's title,
 * given `innerTitle`, the part of the title already inside the italics. 0 when the text that follows isn't the title.
 */
function officialTitleLength(title, innerTitle, rest) {
  if (!title) return 0;
  const wanted = normalizeTitle(title);
  const inner = normalizeTitle(innerTitle || '');
  if (!wanted.startsWith(inner)) return 0;
  let remaining = wanted.slice(inner.length);
  if (!remaining) return 0;

  let i = 0;
  while (i < rest.length && remaining) {
    const c = normalizeTitleChar(rest[i]);
    if (c && remaining[0] !== c) return 0;
    remaining = remaining.slice(c.length);
    i++;
  }
  if (remaining) return 0;
  // The title must end at a word boundary: "Support period" doesn't match "Support periods"
  if (/[\p{L}\p{N}]/u.test(rest[i] || '')) return 0;
  return i;
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

  // Convert [[target | link text]] patterns: the target resolves as [[target]] does, and the link
  // shows the given text instead of the generated one. The pipe may be escaped, "\|", as it has to be
  // in a table cell. Targets that don't resolve are left as written.
  result = replaceOutsideLinks(result, /\[\[([^\]|]+?)\s*\\?\|\s*([^\]]+?)\s*\]\]/g, (match, target, text) => {
    const link = resolveLinks(`[[${target}]]`, linkResolutionContext, internalLinks, craReferences).match(/^\[.*\]\((.+)\)$/s);
    return link ? `[${text}](${link[1]})` : match;
  });

  if (linkResolutionContext === 'official') {

    // Cross-references between the Commission's own FAQs: "_1.2 What is a product with digital elements?_",
    // "_1.3_ What is a direct or indirect [...] connection?", "see section _4.1_ Risk-based approach"
    result = linkOfficialCrossReferences(result, internalLinks);

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

  // 0. Convert prefixed [[DOC Article 5]], [[DOC Recital 3]], [[DOC Annex I]], [[DOC Section 3.2.4]],
  //    [[DOC point 71]], [[DOC Example 3]] and [[DOC Figure 2]] patterns, where DOC is a citable document:
  //    an act's number (2024/2853) or cite key (PLD), or CRA-GUIDANCE. Unknown documents or parts are left as written.
  //
  //    Each renders as "Article 5 of the CRA", "Recital 15 of the PLD", "point 71 of the Commission guidance".
  //    A parenthesis holding nothing but such citations, "([[CRA Recital 15]], [[CRA-GUIDANCE point 58]],
  //    [[CRA-GUIDANCE point 61]])", renders them in a short form grouped by document and part:
  //    "(CRA Recital 15, Guidance points 58 and 61)". Each citation keeps its own link and tooltip.
  result = result.replace(/\((\[\[[^\]]+\]\](?:,\s*\[\[[^\]]+\]\])*)\)/g, (match, list) => {
    const citations = list.split(/,\s*(?=\[\[)/).map(parseCitation);
    if (citations.some(citation => !citation)) return match;
    return `(${groupCitations(citations)})`;
  });
  result = result.replace(new RegExp(PREFIXED_CITATION.source, 'gi'), (match) => {
    const citation = parseCitation(match);
    return citation ? mdLink(citation.link.text, citation.link.url, citation.link.title) : match;
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

  // 4. Convert [[category/filename]] and [[category/sublist/filename]] patterns (FAQ references),
  //    and [[pending-guidance/filename]] (references to a request for Commission guidance)
  result = result.replace(/\[\[([a-z0-9_-]+(?:\/[a-z0-9_-]+)+)\]\]/gi, (match, faqId) => {
    const faq = internalLinks?.[faqId];
    if (faq) {
      const label = faq.type === 'guidance-request' ? '🛑 Guidance request' : '💬 FAQ';
      return mdLink(faq._pageTitle, faq.permalink, `${label}: ${faq._pageTitle}`);
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

/**
 * The double-bracket references still in a text once its links are resolved: references that name
 * no known document, part, FAQ or list. Takes the markdown-it tokens of the resolved text, so that
 * double brackets in code spans and code blocks, which are examples of the syntax, don't count.
 *
 * @param {Array} tokens - markdown-it tokens of a text whose links have been resolved
 * @returns {string[]} The unresolved references, as written
 */
function findUnresolvedReferences(tokens) {
  return tokens.flatMap(token => {
    if (token.children) return findUnresolvedReferences(token.children);
    return token.type === 'text' ? token.content.match(/\[\[[^\]]+\]\]/g) || [] : [];
  });
}

module.exports = {
  resolveLinks,
  findUnresolvedReferences,
  replaceOutsideLinks,
  craArticleLink
};
