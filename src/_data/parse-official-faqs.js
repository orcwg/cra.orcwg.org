const fs = require('fs');
const path = require('path');
const markdownIt = require("markdown-it");
const { isNew, recentlyUpdated } = require('./utils/timestamp-helpers.js');
const { parseRelatedIssues } = require('./utils/issue-parser.js');

// Initialize markdown parser for rendering inline markdown
const mdInline = new markdownIt({html: true});

function renderInlineMarkdown(content) {
  if (!content) return "";
  return mdInline.renderInline(content);
}

// Load configuration for list metadata
const craConfigPath = path.join(__dirname, 'official-faqs-config-lists.json');
const craConfig = JSON.parse(fs.readFileSync(craConfigPath, 'utf8'));

// Load configuration for FAQ metadata
const faqConfigPath = path.join(__dirname, 'official-faqs-config-faqs.json');
const faqConfig = JSON.parse(fs.readFileSync(faqConfigPath, 'utf8'));

const FAQ = "faq";
const LIST = "list";

// Helper function to build hierarchical list ID
function buildListId(number) {
  const parts = number.split('.');
  const pathParts = [craConfig[""].slug]; // Start with root

  for (let i = 1; i <= parts.length; i++) {
    const partialSection = parts.slice(0, i).join('.');
    const config = craConfig[partialSection];
    if (config) {
      pathParts.push(config.slug);
    }
  }

  return pathParts.join('/');
}

// Parse version table to extract dates and version info
function parseVersionTable(content) {
  const versionTableMatch = content.match(/\| FAQ Version \| Date\s*\| Changes\s*\|[\s\S]*?\n(?=\n[^|])/);
  if (!versionTableMatch) {
    return { createdAt: new Date(), lastUpdatedAt: new Date(), latestVersion: null };
  }

  const tableContent = versionTableMatch[0];
  const rows = tableContent.split('\n').filter(line => line.startsWith('|') && !line.includes('---'));

  // Skip header row, process data rows
  const dataRows = rows.slice(1);
  const versions = [];

  for (const row of dataRows) {
    const cells = row.split('|').map(c => c.trim()).filter(c => c);
    if (cells.length >= 2) {
      // Parse date in DD/MM/YYYY format
      const dateMatch = cells[1].match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (dateMatch) {
        const [, day, month, year] = dateMatch;
        versions.push({
          version: cells[0],
          date: new Date(`${year}-${month}-${day}`),
          changes: cells[2] || ''
        });
      }
    }
  }

  if (versions.length === 0) {
    return { createdAt: new Date(), lastUpdatedAt: new Date(), latestVersion: null };
  }

  // Sort by date
  versions.sort((a, b) => a.date - b.date);

  return {
    createdAt: versions[0].date,
    lastUpdatedAt: versions[versions.length - 1].date,
    latestVersion: versions[versions.length - 1]
  };
}

// Extract disclaimer text from markdown content
function extractDisclaimer(content) {
  // The disclaimer is the paragraph starting with "This document is prepared..."
  const paragraphs = content.split(/\n\n+/);
  for (const para of paragraphs) {
    if (para.trim().startsWith('This document is prepared by the Commission services')) {
      const disclaimer = para.trim().replace(/\n/g, ' ');
      // Add conversion notice
      const conversionNotice = 'The content of this FAQ was generated from the [Markdown version](https://ec.europa.eu/newsroom/dae/redirection/document/123307) of the official "FAQs on the Cyber Resilience Act." As the original document was not written in Markdown, errors may have occurred during the conversion. Please check the [original PDF](https://ec.europa.eu/newsroom/dae/redirection/document/122331) for accuracy.';
      return disclaimer + '<br><br>' + conversionNotice;
    }
  }
  return "";
}

// Extract intro text for description
function extractIntroText(content) {
  // The intro text is the paragraph starting with "This preliminary set..."
  const paragraphs = content.split(/\n\n+/);
  for (const para of paragraphs) {
    if (para.trim().startsWith('This preliminary set of technical Frequently Asked Questions')) {
      return para.trim().replace(/\n/g, ' ');
    }
  }
  return "";
}

// Parse markdown file and build FAQ structure
async function parseOfficialFAQs(mdPath = path.join(__dirname, 'FAQs_on_the_CRA__v12_AnSi0bxqu0pJAFLWayO5WfIULZM_123307.md')) {
  const content = fs.readFileSync(mdPath, 'utf8');

  const { createdAt, lastUpdatedAt, latestVersion } = parseVersionTable(content);
  const disclaimer = extractDisclaimer(content);
  const introText = extractIntroText(content);

  // Format version info for description
  let versionInfo = '';
  if (latestVersion) {
    const dateStr = latestVersion.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    versionInfo = `\n\n**Current version**: ${latestVersion.version} (${dateStr})`;
  }

  // Split content into lines for processing
  const lines = content.split('\n');

  // Find where actual FAQ content starts (first # heading after Contents that isn't "Contents")
  let contentStartIndex = 0;
  let inTOC = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^# Contents/)) {
      inTOC = true;
      continue;
    }
    // Find first h1 heading after TOC
    if (inTOC && lines[i].match(/^# [A-Z]/)) {
      contentStartIndex = i;
      break;
    }
  }

  // Extract footnotes
  const footnotes = {};
  const footnotePattern = /^\[\^(\d+)\]:\s*(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(footnotePattern);
    if (match) {
      const number = match[1];
      let text = match[2];
      // Handle multiline footnotes
      let j = i + 1;
      while (j < lines.length && !lines[j].match(/^\[\^\d+\]:/) && !lines[j].match(/^#/)) {
        if (lines[j].trim()) {
          text += ' ' + lines[j].trim();
        }
        j++;
      }
      footnotes[number] = text.trim();
    }
  }

  // Parse headings and build section structure
  // Headings don't have numbers - we need to generate them based on structure
  const headings = [];
  const headingPattern = /^(#{1,3})\s+(.+?)(?:\s*\{[^}]*\})?$/;

  for (let i = contentStartIndex; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(headingPattern);
    if (match) {
      const level = match[1].length;
      const title = match[2].trim();

      // Skip if this looks like a footnote or TOC
      if (title.startsWith('[^') || title.match(/^\[\d/) || title === 'Contents') {
        continue;
      }

      headings.push({
        lineIndex: i,
        level,
        title
      });
    }
  }

  // Assign section numbers based on structure
  // h1 = section (1, 2, 3...)
  // h2 = subsection (1.1, 1.2, 2.1...)
  // h3 = sub-subsection (2.1.1, 2.1.2...)
  const counters = [0, 0, 0]; // h1, h2, h3 counters

  for (const heading of headings) {
    const level = heading.level;

    if (level === 1) {
      counters[0]++;
      counters[1] = 0;
      counters[2] = 0;
      heading.number = String(counters[0]);
    } else if (level === 2) {
      counters[1]++;
      counters[2] = 0;
      heading.number = `${counters[0]}.${counters[1]}`;
    } else if (level === 3) {
      counters[2]++;
      heading.number = `${counters[0]}.${counters[1]}.${counters[2]}`;
    }
  }

  // Determine types: leaf (FAQ) vs branch (list)
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const hasDeepChildren = headings.slice(i + 1).some(nextHeading =>
      nextHeading.number && heading.number &&
      nextHeading.number.startsWith(heading.number + '.') &&
      nextHeading.number.split('.').length > heading.number.split('.').length
    );
    heading.type = hasDeepChildren ? LIST : FAQ;
  }

  // Build tree structure
  const lists = [];
  const faqs = [];

  // Create root list
  const rootConfig = craConfig[""];
  const rootList = {
    id: "official",
    type: LIST,
    title: rootConfig.title,
    _pageTitle: rootConfig.title,
    icon: rootConfig.icon,
    description: "**Message from the European Commission**: _\"" + introText + "\"_" + versionInfo,
    descriptionHtml: "",
    permalink: `/faq/${rootConfig.slug}/`,
    children: [],
    parents: [],
    faqCount: 0,
    listCount: 0,
    countText: "",
    _level: 0,
    _showQuestionNumbers: true,
    createdAt,
    lastUpdatedAt,
    _isNew: isNew(createdAt),
    _recentlyUpdated: recentlyUpdated(createdAt, lastUpdatedAt)
  };
  lists.push(rootList);

  // Build items from headings
  const itemStack = [rootList];

  for (let headingIndex = 0; headingIndex < headings.length; headingIndex++) {
    const heading = headings[headingIndex];
    const sectionLevel = heading.number.split('.').length;

    // Adjust stack to current level
    while (itemStack.length > sectionLevel) {
      itemStack.pop();
    }

    if (heading.type === LIST) {
      // Create list item
      const config = craConfig[heading.number];
      if (!config) {
        console.warn(`Warning: No config found for section ${heading.number}: ${heading.title}`);
        continue;
      }
      const listId = buildListId(heading.number);

      const newList = {
        id: listId,
        type: LIST,
        title: `${heading.number} ${heading.title}`,
        _pageTitle: heading.title,
        icon: config.icon,
        description: config.description,
        descriptionHtml: "",
        permalink: `/faq/${listId}/`,
        children: [],
        parents: [],
        faqCount: 0,
        listCount: 0,
        countText: "",
        _level: sectionLevel,
        _showQuestionNumbers: true,
        createdAt,
        lastUpdatedAt,
        _isNew: isNew(createdAt),
        _recentlyUpdated: recentlyUpdated(createdAt, lastUpdatedAt)
      };

      // Add to parent
      const parentList = itemStack[itemStack.length - 1];
      parentList.children.push(newList);
      newList.parents.push(parentList);
      lists.push(newList);
      itemStack.push(newList);
    } else {
      // Create FAQ item
      const faqNumber = heading.number.replace(/\./g, '-');
      const faqId = `official/faq_${faqNumber}`;
      const faqPermalink = `/faq/${faqId}/`;

      // Extract answer content (everything between this heading and the next)
      const startLine = heading.lineIndex + 1;
      let endLine = lines.length;

      // Find the next heading or footnote section
      if (headingIndex + 1 < headings.length) {
        endLine = headings[headingIndex + 1].lineIndex;
      } else {
        // Find where footnotes start or EOF
        for (let i = startLine; i < lines.length; i++) {
          if (lines[i].match(/^\[\^\d+\]:/)) {
            endLine = i;
            break;
          }
        }
      }

      // Extract answer lines
      const answerLines = lines.slice(startLine, endLine);
      let answer = answerLines.join('\n').trim();

      // Extract footnote references from answer
      const footnoteRefs = [];
      const footnoteRefPattern = /\[\^(\d+)\]/g;
      let refMatch;
      while ((refMatch = footnoteRefPattern.exec(answer)) !== null) {
        if (!footnoteRefs.includes(refMatch[1])) {
          footnoteRefs.push(refMatch[1]);
        }
      }

      // Append footnote definitions to answer
      if (footnoteRefs.length > 0) {
        const footnoteTexts = footnoteRefs.map(num => {
          if (footnotes[num]) {
            return `[^${num}]: ${footnotes[num]}`;
          }
          return null;
        }).filter(Boolean);

        if (footnoteTexts.length > 0) {
          answer += '\n\n' + footnoteTexts.join('\n');
        }
      }

      // Get FAQ config for related issues
      const currentFaqConfig = faqConfig[heading.number];
      const relatedIssues = currentFaqConfig && currentFaqConfig.relatedIssues.join(', ') || "";

      const faq = {
        id: faqId,
        type: FAQ,
        status: "official",
        _pageTitle: heading.title,
        question: heading.title,
        questionHtml: renderInlineMarkdown(heading.title),
        questionNumber: heading.number,
        answer,
        answerHtml: "",
        parents: [],
        _listed: true,
        permalink: faqPermalink,
        _linkResolutionContext: 'official',
        author: "European Union",
        license: "CC-BY-4.0",
        licenseUrl: "https://commission.europa.eu/legal-notice_en#copyright-notice",
        srcUrl: "https://ec.europa.eu/newsroom/dae/redirection/document/122331",
        source: "\"FAQs on the Cyber Resilience Act\" (PDF)",
        disclaimer,
        disclaimerHtml: renderInlineMarkdown(disclaimer),
        relatedIssues: parseRelatedIssues(relatedIssues),
        guidanceId: false,
        createdAt,
        lastUpdatedAt,
        _isNew: isNew(createdAt),
        _recentlyUpdated: recentlyUpdated(createdAt, lastUpdatedAt)
      };

      // Add to parent
      const parentList = itemStack[itemStack.length - 1];
      parentList.children.push(faq);
      faq.parents.push(parentList);
      faqs.push(faq);
    }
  }

  return { lists, faqs, rootList };
}

// Export for use in other scripts
module.exports = { parseOfficialFAQs };
