// ============================================================================
// Dependencies
// ============================================================================
const fs = require("fs").promises;
const path = require("path");
const matter = require("gray-matter");
const markdownIt = require("markdown-it");
const plainTextPlugin = require("markdown-it-plain-text");
const markdownItFootnote = require("markdown-it-footnote");
const yaml = require("js-yaml");
const { resolveLinks } = require("./utils/link-resolver.js");
const { isNew, recentlyUpdated, NEW_CONTENT_THRESHOLD, RECENTLY_UPDATED_THRESHOLD } = require("./utils/timestamp-helpers.js");
const { parseRelatedIssues } = require("./utils/issue-parser.js");
const craReferences = require("./craReferences.json");
const { execSync } = require("child_process");
const { parsePDFFAQs } = require("./parse-official-faqs-pdf.js");
const apiFormatter = require("./utils/api-formatter.js");
const { API_CONFIG, RESOURCES } = require("./api.json");

// ============================================================================
// Constants
// ============================================================================

const CACHE_DIR = path.join(__dirname, "..", "..", "_cache");
const FAQ_DIR = path.join(CACHE_DIR, "faq");
const ROOT_DIR = path.join(__dirname, "..", "..");
const GUIDANCE_DIR = path.join(CACHE_DIR, "faq", "pending-guidance");
const AUTHORS_PATH = path.join(FAQ_DIR, "AUTHORS.md");
const CONTRIBUTORS_PATH = path.join(ROOT_DIR, "CONTRIBUTORS.md");

const EDIT_ON_GITHUB_ROOT = "https://github.com/orcwg/cra-hub/edit/main/";
const GITHUB_ROOT = "https://github.com/orcwg/cra-hub/tree/main/";

const ROOT_LIST_ID = "faq";
const LIST_FILENAME = 'README.yml';

const LICENSE = "CC-BY-4.0";
const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";

// Initialize data arrays for content processing
const faqs = [];
const guidanceRequests = [];
const lists = [];

// Type constants for content classification
const FAQ = 'faq';
const GUIDANCE_REQUEST = 'guidance-request';
const LIST = 'list';

// ============================================================================
// Markdown Renderers
// ============================================================================

// Plain text renderer (for page titles)
const mdPlain = markdownIt().use(plainTextPlugin);

// Basic inline markdown renderer (no plugins needed)
const mdInline = markdownIt({
  html: true,
  linkify: true,
  typographer: false
});

// Full markdown renderer with plugins (for HTML output)
let md = markdownIt({
  html: true,
  linkify: true,
  typographer: false
}).use(markdownItFootnote);

// Render simple inline markdown (titles, questions - no plugins needed)
function renderInlineMarkdown(content) {
  if (!content) return "";
  return mdInline.renderInline(content);
}

// ============================================================================
// Markdown and Link Processing Functions
// ============================================================================

/**
 * Resolve links and render markdown in a single pass
 * Loads markdown plugins before rendering
 */
async function resolveLinksThenRenderMarkdown(items, sourceField, targetField, internalLinkIndex) {
  const { default: markdownItGitHubAlerts } = await import("markdown-it-github-alerts");
  md = md.use(markdownItGitHubAlerts);

  for (const item of items) {
    if (item[sourceField]) {
      const resolved = resolveLinks(item[sourceField], item._linkResolutionContext, internalLinkIndex, craReferences, item);
      item[targetField] = md.render(resolved);
    }
  }
}

// ============================================================================
// Utility Functions - Text Processing
// ============================================================================

// Convert markdown to plain text (used for page titles)
function markdownToPlainText(markdownText) {
  mdPlain.render(markdownText);
  return mdPlain.plainText.trim();
}

// ============================================================================
// Utility Functions - Content Specific Extractions from Markdown Data
// ============================================================================


// Extract the "Guidance Needed" section from markdown content
function extractGuidanceText(content) {
  const lines = content.split('\n');

  const guidanceStart = lines.findIndex(line =>
    line.trim().match(/^#+\s*Guidance Needed/i)
  );

  const guidanceEnd = lines.findIndex((line, index) =>
    index > guidanceStart && line.trim().match(/^#+\s/)
  );

  const endIndex = guidanceEnd === -1 ? lines.length : guidanceEnd;
  const guidanceLines = lines
    .slice(guidanceStart + 1, endIndex)
    .filter(line => line);

  const rawText = guidanceLines.join(' ');
  return markdownToPlainText(rawText).trim();
}

// Splits raw Markdown at the first H1, returns [h1, body]
function splitMarkdownAtFirstH1(content) {
  const firsth1 = content.match(/^#\s+(.+)$/m);
  const h1 = firsth1[1].trim();
  const body = content.replace(firsth1[0], '').trim();

  return [h1, body];
}

function toPosixPath(p) {
  return p.split(path.sep).join("/");
}

// ============================================================================
// Utility Functions - Timestamp Helpers
// ============================================================================


function generateTimestamps(faqs) {
  let createdAt = new Date(0);
  let lastUpdatedAt = new Date(0);

  if (faqs.length > 0) {
    createdAt = new Date(Math.max(...faqs.map(faq => faq.createdAt.getTime())));
    lastUpdatedAt = new Date(Math.max(...faqs.map(faq => faq.lastUpdatedAt.getTime())));
  }
  return { createdAt, lastUpdatedAt };
}

// ============================================================================
// Utility Functions - Git Operations
// ============================================================================

const getTimestampsForObj = (function initTimestampsFetcher(cacheDir) {
  const timestampMap = new Map();

  // Get all commits with their modified files
  const logOutput = execSync('git log --format="%ad|%H" --date=iso --name-only', {
    cwd: cacheDir,
    encoding: 'utf8'
  });

  const lines = logOutput.trim().split('\n');
  let currentDate = null;

  // Process in reverse order to get creation dates (oldest first)
  for (const line of lines.reverse()) {
    if (line.includes('|')) {
      // This is a date line
      currentDate = new Date(line.split('|')[0]);
    } else if (line && currentDate) {
      // This is a file path
      const existing = timestampMap.get(line);
      if (!existing) {
        // First time seeing this file (creation)
        timestampMap.set(line, { createdAt: currentDate, lastUpdatedAt: currentDate });
      } else {
        // Update last modified date
        existing.lastUpdatedAt = currentDate;
      }
    }
  }

  return function getTimestampsForObj(posixPath) {
    return timestampMap.get(posixPath);
  };
})(CACHE_DIR);

// ============================================================================
// Utility Functions - File Operations
// ============================================================================

async function getFile(file) {
  const fullPath = path.join(file.parentPath, file.name);
  const rawContent = await fs.readFile(fullPath, "utf-8");
  const relativePath = path.relative(CACHE_DIR, fullPath);
  const posixPath = toPosixPath(relativePath);
  const { createdAt, lastUpdatedAt } = getTimestampsForObj(posixPath);

  return {
    // Internal fields (prefixed with _)
    _filename: file.name,
    _path: path.relative(CACHE_DIR, file.parentPath),
    _fullPath: fullPath,
    _posixPath: posixPath,
    _rawContent: rawContent,
    // Public fields
    _editOnGithubUrl: new URL(posixPath, EDIT_ON_GITHUB_ROOT).href,
    srcUrl: new URL(posixPath, GITHUB_ROOT).href,
    license: "CC-BY-4.0",
    licenseUrl: new URL("LICENSE.md", GITHUB_ROOT).href,
    author: "ORC WG Authors",
    authorUrl: "https://cra.orcwg.org/acknowledgements/",
    createdAt,
    lastUpdatedAt,
    _isNew: isNew(createdAt),
    _recentlyUpdated: recentlyUpdated(createdAt, lastUpdatedAt)
  };
}

async function getMarkdownFile(entry) {
  const file = await getFile(entry);
  const parsed = matter(file._rawContent);

  // Internal fields
  file._frontmatter = parsed.data;
  file._content = parsed.content.trim();

  const posixPathWithoutExt = file._posixPath.replace(/\.md$/, "");
  file.permalink = "/" + posixPathWithoutExt + "/"; // backslash to make eleventy happy
  file.id = posixPathWithoutExt.replace(/^faq\/pending-guidance\//, "").replace(/^faq\//, "");
  file._linkResolutionContext = file.id.replace(/\/[^\/]+$/, ""); // Extract context path for resolving relative links
  return file;
}

async function getREADME(entry) { // cra-hub uses README.yml files to define FAQ lists
  const file = await getFile(entry);
  file._yaml = yaml.load(file._rawContent);

  const posixDirPath = file._posixPath.replace(/\/README\.yml$/, "");
  file.permalink = "/" + posixDirPath + "/"; // backslash to make eleventy happy
  file.id = posixDirPath.replace(/^faq\//, ""); // => root dir id equals "faq" as root dir has no trailing slash
  return file;
}

// ============================================================================
// FAQ Processing
// ============================================================================

// Create internal link index for cross-referencing content
function createInternalLinkIndex(faqs, lists, guidanceRequests) {
  const index = {};

  faqs.forEach(faq => {
    index[faq.id] = faq;
  });

  lists.forEach(list => {
    index[`lists/${list.id}`] = list;
  });

  guidanceRequests.forEach(guidanceRequest => {
    index[`guidance/${guidanceRequest.id}`] = guidanceRequest;
  });

  return index;
}

function isFaq(file) {
  return file.parentPath !== GUIDANCE_DIR &&  // Reject pending-guidance files
    file.parentPath !== FAQ_DIR &&     // Reject files at the root of the FAQ
    file.isFile() &&                     // Reject directories
    file.name.endsWith('.md');           // Keep only markdown files
}

function createFaq(file) {

  // Normalize status
  const status = file._frontmatter.Status.replace(/^(⚠️|🛑|✅)\s*/, '').replace(" ", "-").trim().toLowerCase();
  const _needsRefactoring = (/>\s*\[!WARNING\]\s*\n>\s*.*needs\s+refactoring/).test(file._content);

  // Extract question and answer
  const [question, answer] = splitMarkdownAtFirstH1(file._content);

  // Set guidance ID
  const guidanceId = file._frontmatter["guidance-id"] ? file._frontmatter["guidance-id"].trim() : false;

  return {
    ...file,
    type: FAQ,
    status,
    _needsRefactoring,
    relatedIssues: parseRelatedIssues(file._frontmatter["Related issue"] || file._frontmatter["Related issues"]), // Temporarily use both, remove once CRA-HUB source is normalized to Related issues.
    _pageTitle: markdownToPlainText(question),
    question,
    questionHtml: renderInlineMarkdown(question),
    answer,
    disclaimer: `The information contained in this FAQ is of a general nature only
      and is not intended to address the specific circumstances of any particular individual or entity.
      It is not necessarily comprehensive, complete, accurate, or up to date.
      It does not constitute professional or legal advice.
      If you need specific advice, you should consult a suitably qualified professional.`,
    disclaimerHtml: renderInlineMarkdown(`The information contained in this FAQ is of a general nature only
      and is not intended to address the specific circumstances of any particular individual or entity.
      It is not necessarily comprehensive, complete, accurate, or up to date.
      It does not constitute professional or legal advice.
      If you need specific advice, you should consult a suitably qualified professional.`),
    answerHtml: "", // Populated after link resolution
    _answerMissing: (answer.length == 0),
    guidanceId,
    parents: []
  };
}

// ============================================================================
// Guidance Request Processing
// ============================================================================

function isGuidance(file) {
  return file.parentPath === GUIDANCE_DIR &&
    file.isFile() &&
    file.name.endsWith('.md');
}

function createGuidanceRequest(file) {
  // Normalize status
  const status = file._frontmatter.status.replace(/^(⚠️|🛑|✅)\s*/, '').replace(" ", "-").trim().toLowerCase();

  // Extract title and body
  const [title, body] = splitMarkdownAtFirstH1(file._content);

  return {
    ...file,
    permalink: file.permalink.replace(/^\/faq/, ""), // Move guidance permalinks out of faq dir
    type: GUIDANCE_REQUEST.type,
    status,
    _pageTitle: markdownToPlainText(title),
    title,
    titleHtml: renderInlineMarkdown(title),
    body,
    bodyHtml: "", // Populated after link resolution
    guidanceText: extractGuidanceText(body)
  };
}

// ============================================================================
// YAML List Processing
// ============================================================================

function normalizeReferenceIds(relativeIds = [], listId) {
  return relativeIds.map(id => {
    if (!listId || id.includes('/')) {
      return id;
    }
    return `${listId}/${id}`;
  });
}

function isList(file) {
  return file.isFile() && file.name === LIST_FILENAME;
}

// Create a list from a YAML file
function createList(file) {
  const isRoot = file.id === ROOT_LIST_ID;

  return {
    ...file,
    type: LIST,
    _pageTitle: markdownToPlainText(file._yaml.title),
    title: file._yaml.title,
    icon: file._yaml.icon,
    description: file._yaml.description,
    descriptionHtml: "", // Populated after link resolution
    license: "CC-BY-4.0",
    licenseUrl: new URL("LICENSE.md", GITHUB_ROOT).href,
    author: "ORC WG Authors",
    authorUrl: "https://cra.orcwg.org/acknowledgements/",
    isRoot,
    children: [],
    parents: [], // Lists that include this list (filled during cross-referencing)
    faqCount: 0,
    listCount: 0
  }
}

// ============================================================================
// Authors Processing
// ============================================================================


// Read and return AUTHORS.md/CONTRIBUTORS.md content
async function fetchAcknowledgementsFile(path) {
  const rawContent = await fs.readFile(path, "utf-8");
  const parsed = matter(rawContent);
  const content = parsed.content.trim();

  if (!content) {
    throw new Error(`File at ${path} is empty or has no content after frontmatter.`);
  }

  return content;
}

async function processAcknowledgements(authorsPath, contribPath) {
  // Extract the different names list in the bodies into arrays
  let content;
  content = await fetchAcknowledgementsFile(authorsPath);
  const faqAuthors = extractNames(content);
  content = await fetchAcknowledgementsFile(contribPath);
  const websiteContributors = extractNames(content);
  return { faqAuthors, websiteContributors };
}

function extractNames(content) {
  const names = content.match(/^\*\s+(.+)$/gm);

  //Remove the * in the beginning
  return names.map(name => name.replace(/^\*\s+/, '').trim());
}

// ============================================================================
// Cross referencing functions
// ============================================================================

// Cross reference FAQs and their related guidance requests
function crossReferenceFaqsAndGuidanceRequests(faqs, guidanceRequests) {
  guidanceRequests.forEach(guidanceRequest => {
    guidanceRequest.relatedFaqs = [];
    relatedFaqs = faqs.filter(faq => (faq.guidanceId == guidanceRequest.id));
    relatedFaqs.forEach(relatedFaq => {
      guidanceRequest.relatedFaqs.push(relatedFaq);
      relatedFaq.relatedGuidanceRequest = guidanceRequest;
    })
  });
};

// Cross-reference YAML-based lists with their FAQs and sublists (bidirectional)
function crossReferenceListsAndFaqs(lists, faqs) {
  lists.forEach(list => {
    const childRefs = list._yaml ? normalizeReferenceIds(list._yaml.faqs, list.isRoot ? null : list.id) : [];
    childRefs.forEach(itemRef => {
      // Check if it's a  list reference
      const sublist = lists.find(l => l.id === itemRef);
      if (sublist) {
        sublist.parents.push(list);
        list.children.push(sublist);
      } else {
        const faqObject = faqs.find(faq => faq.id === itemRef);
        if (faqObject) {
          faqObject.parents.push(list);
          faqObject._listed = true;  // Internal: Tag FAQ as listed in a YAML-based list
          list.children.push(faqObject);
        }
      }
    });
  });
}

// ============================================================================
// Dynamic Lists
// ============================================================================

// Dynamic list configurations
// Each list has metadata and filter functions to determine behavior

const HIDE_IF_EMPTY = "hide if empty";

const DYNAMIC_LISTS = [
  {
    id: 'new',
    title: 'New FAQs',
    icon: '🌟',
    description: `FAQs added within the last ${NEW_CONTENT_THRESHOLD} days`,
    emptyMsg: "It seems there aren't any newly created FAQs",
    insertAt: 'top',
    inclusionFilter: (faq) => faq._isNew,
    sortChildren: (a, b) => b.createdAt - a.createdAt,  // Newest first
    hideInAllFaqs: true,
    hideInTopics: HIDE_IF_EMPTY
  },
  {
    id: 'recently-updated',
    title: 'Recently Updated FAQs',
    icon: '💫',
    description: `FAQs updated within the last ${RECENTLY_UPDATED_THRESHOLD} days`,
    emptyMsg: "It seems there aren't any recently updated FAQs",
    insertAt: 'top',
    inclusionFilter: (faq) => faq._recentlyUpdated,
    sortChildren: (a, b) => b.lastUpdatedAt - a.lastUpdatedAt,  // Most recently updated first
    hideInAllFaqs: true,
    hideInTopics: HIDE_IF_EMPTY
  },
  {
    id: 'cra-basics',
    title: 'CRA Basics',
    icon: '🏛️',
    description: 'Official questions and answers from the European Commission',
    emptyMsg: 'EC content is currently unavailable',
    insertAt: 'top',
    inclusionFilter: (faq) => faq._linkResolutionContext === 'cra-basics',
    sortChildren: null,  // Maintain original order
    hideInAllFaqs: HIDE_IF_EMPTY,
    hideInTopics: HIDE_IF_EMPTY
  },
  {
    id: 'unlisted',
    title: 'Unlisted FAQs',
    icon: '❌',
    description: 'FAQs not yet assigned to any list',
    emptyMsg: 'Great news! All FAQs are properly assigned to lists. There are currently no unlisted FAQs.',
    insertAt: 'bottom',
    inclusionFilter: (faq) => !faq._listed,
    sortChildren: null,  // No sorting
    hideInAllFaqs: HIDE_IF_EMPTY,
    hideInTopics: HIDE_IF_EMPTY
  }
];

// Create a dynamic list from configuration
function initializeDynamicList(config) {
  return {
    type: LIST,
    ...config,
    permalink: `/faq/${config.id}/`,
    _pageTitle: config.title,
    license: "CC-BY-4.0",
    licenseUrl: new URL("LICENSE.md", GITHUB_ROOT).href,
    author: "ORC WG Authors",
    authorUrl: "https://cra.orcwg.org/acknowledgements/",
    children: [], // Populated after cross-referencing
    parents: [], // Populated after cross-referencing
    faqCount: 0,
    listCount: 0
  };
}

// Create dynamic lists, populate them, and insert into root list
function createAndInsertDynamicLists(lists, rootList, faqs) {
  const topLists = [];
  const bottomLists = [];

  // Create and populate each dynamic list
  DYNAMIC_LISTS.forEach(config => {
    const list = initializeDynamicList(config);
    lists.push(list);

    // Cross reference matching faqs
    const matchingFaqs = faqs.filter(config.inclusionFilter);
    list.children.push(...matchingFaqs);

    matchingFaqs.forEach(faq => faq.parents.push(list));

    // Sort children if configured
    if (config.sortChildren) {
      list.children.sort(config.sortChildren);
    }

    // Calculate metadata from children
    const { createdAt, lastUpdatedAt } = generateTimestamps(list.children);
    list.createdAt = createdAt;
    list.lastUpdatedAt = lastUpdatedAt;
    list._isNew = isNew(createdAt);
    list._recentlyUpdated = recentlyUpdated(createdAt, lastUpdatedAt);

    if (config.hideInTopics == HIDE_IF_EMPTY) {
      list.hideInTopics = list.children.length === 0;
    }
    if (config.hideInAllFaqs == HIDE_IF_EMPTY) {
      list.hideInAllFaqs = list.children.length === 0;
    }

    // Categorize by insertion position
    if (config.insertAt === 'top') {
      topLists.push(list);
    } else {
      bottomLists.push(list);
    }

    list.parents.push(rootList);
  });

  // Insert into root list with proper ordering
  rootList.children.unshift(...topLists);
  rootList.children.push(...bottomLists);
}

// ============================================================================
// List Utilities
// ============================================================================

// Recursively count all descendants (FAQs and lists) at all nesting levels
function countListChildElementsRecursively(list) {
  let faqCount = 0;
  let listCount = 0;

  list.children.forEach(item => {
    if (item.type === FAQ) {
      faqCount++;
    } else if (item.type === LIST) {
      listCount++;
      // Recursively count descendants of nested lists
      const nestedCounts = countListChildElementsRecursively(item);
      faqCount += nestedCounts.faqCount;
      listCount += nestedCounts.listCount;
    }
  });

  return { faqCount, listCount };
}

// Format count text for display
function createCountText(faqCount, listCount) {
  const faqText = `${faqCount} FAQ${faqCount !== 1 ? 's' : ''}`;
  if (listCount > 0) {
    const listText = `${listCount} list${listCount !== 1 ? 's' : ''}`;
    return `${faqText} organised in ${listText}`;
  }
  return faqText;
}

// Calculate counts for all lists
function calculateListCounts(lists) {
  lists.forEach(list => {
    const counts = countListChildElementsRecursively(list);
    list.faqCount = counts.faqCount;
    list.listCount = counts.listCount;
    list.countText = createCountText(counts.faqCount, counts.listCount);
  });
}

// ============================================================================
// EC Content fetching and processing
// ============================================================================

// Create URL-friendly slug from text
function createSlug(text) {
  return text
    .toLowerCase()
    .replace("cyber resilience act", "cra")
    .replace(/[^\w\s-]/g, "") // Remove special characters except spaces and hyphens
    .replace(/\s+/g, "-")     // Replace spaces with hyphens
    .replace(/-+/g, "-")      // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, "");   // Remove leading/trailing hyphens
}

// Fetch and process EC content, adding FAQs directly to main FAQ array
async function fetchAndAddECFaqs(faqs) {
  const _linkResolutionContext = "cra-basics";
  const response = await fetch("https://ec.europa.eu/commission/presscorner/api/documents?reference=QANDA/22/5375&language=en&ts=1764255415176");
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const ecData = await response.json();

  // Extract update date and clean content
  const updateMatch = ecData.docuLanguageResource.htmlContent.match(/\*Updated on (\d{2})\/(\d{2})\/(\d{4})/);
  let updateDate = null;
  let cleanedContent = ecData.docuLanguageResource.htmlContent;

  if (updateMatch) {
    const [, day, month, year] = updateMatch;
    updateDate = new Date(`${year}-${month}-${day}`);
    cleanedContent = cleanedContent.replace(/<p><em>\*Updated on \d{2}\/\d{2}\/\d{4}<\/em><\/p>/, "").trim();
  }

  // Extract FAQs and add to main array
  const createdAt = new Date(ecData.publishDate);
  const lastUpdatedAt = updateDate || createdAt;
  const sections = cleanedContent
    .split(/<p><strong>(.*?)<\/strong><\/p>/g)
    .map(s => s.replace("<p>&nbsp;</p>", "").trim())
    .filter(s => s);

  for (let i = 0; i < sections.length - 1; i += 2) {
    const question = sections[i];
    const answer = sections[i + 1];

    if (question && answer) {
      const slug = createSlug(question);
      const id = `${_linkResolutionContext}/${slug}`;
      const disclaimer = "This FAQ is subject to the [disclaimer](https://commission.europa.eu/legal-notice_en#disclaimer) published on the European Commission's website.";

      faqs.push({
        id,
        _linkResolutionContext,
        type: FAQ,
        status: "official",
        _pageTitle: question,
        question,
        questionHtml: renderInlineMarkdown(question),
        answer,
        answerHtml: "", // Populated after link resolution
        parents: [],
        _listed: true,  // Internal: Prevents these FAQs from appearing in the "unlisted" filter
        permalink: `/faq/${id}/`,
        createdAt,
        lastUpdatedAt,
        _isNew: isNew(createdAt),
        _recentlyUpdated: recentlyUpdated(createdAt, lastUpdatedAt),
        author: "European Union",
        license: "CC-BY-4.0",
        licenseUrl: "https://commission.europa.eu/legal-notice_en#copyright-notice",
        srcUrl: "https://ec.europa.eu/commission/presscorner/detail/en/qanda_22_5375",
        source: "“Cyber Resilience Act - Questions and Answers”",
        disclaimer,
        disclaimerHtml: renderInlineMarkdown(disclaimer)
      });
    }
  }
}

async function fetchOfficialFAQs(faqs, lists, rootList) {
  const result = await parsePDFFAQs();
  faqs.push(...result.faqs);
  lists.push(...result.lists);
  result.rootList.parents.push(rootList);
  return result.rootList;
}

// ============================================================================
// Main Pipeline
// ============================================================================

// Orchestrate the complete data processing pipeline
async function processAllContent() {
  const entries = await fs.readdir(FAQ_DIR, { withFileTypes: true, recursive: true });

  let rootList;

  for (const entry of entries) {
    if (isFaq(entry)) {
      const file = await getMarkdownFile(entry);
      const faq = createFaq(file);
      faqs.push(faq);
    } else if (isGuidance(entry)) {
      const file = await getMarkdownFile(entry);
      const guidanceRequest = createGuidanceRequest(file);
      guidanceRequests.push(guidanceRequest);
    } else if (isList(entry)) {
      const file = await getREADME(entry);
      const list = createList(file);
      lists.push(list);
      if (list.id === ROOT_LIST_ID) { rootList = list; }
    }
  }

  // Fetch and add EC content (now handled by dynamic list system)
  await fetchAndAddECFaqs(faqs);

  // Fetch and add CRA implementation FAQs from PDF
  const officialFaqList = await fetchOfficialFAQs(faqs, lists, rootList);

  crossReferenceFaqsAndGuidanceRequests(faqs, guidanceRequests);

  // Cross-reference YAML-based lists and FAQs
  crossReferenceListsAndFaqs(lists, faqs);

  // Create, populate, and insert dynamic lists
  createAndInsertDynamicLists(lists, rootList, faqs);

  rootList.children.push(officialFaqList);

  calculateListCounts(lists);

  const internalLinkIndex = createInternalLinkIndex(faqs, lists, guidanceRequests);

  // Resolve links and render block markdown
  await resolveLinksThenRenderMarkdown(faqs, 'answer', 'answerHtml', internalLinkIndex);
  await resolveLinksThenRenderMarkdown(guidanceRequests, 'body', 'bodyHtml', internalLinkIndex);
  await resolveLinksThenRenderMarkdown(lists, 'description', 'descriptionHtml', internalLinkIndex);

  const acknowledgements = await processAcknowledgements(AUTHORS_PATH, CONTRIBUTORS_PATH);

  // Generate API documents using configuration from api.js
  const api = apiFormatter.generateApiDocuments(
    {
      FAQ: { ...RESOURCES.FAQ, data: faqs },
      GUIDANCE_REQUEST: { ...RESOURCES.GUIDANCE_REQUEST, data: guidanceRequests },
      LIST: { ...RESOURCES.LIST, data: lists }
    },
    API_CONFIG
  );

  return {
    faqs,
    guidanceRequests,
    lists,
    rootList,
    acknowledgements,
    api
  };
}

// ============================================================================
// Module Export
// ============================================================================

// Main entry point for 11ty data processing

module.exports = processAllContent;
