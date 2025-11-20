// ============================================================================
// Dependencies
// ============================================================================
const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const markdownIt = require("markdown-it");
const plainTextPlugin = require("markdown-it-plain-text");
const yaml = require("js-yaml");
const { resolveLinks } = require("./utils/link-resolver.js");
const craReferences = require("./craReferences.json");
const { execSync } = require("child_process");

// ============================================================================
// Constants
// ============================================================================

const CACHE_DIR = path.join(__dirname, "..", "..", "_cache");
const FAQ_DIR = path.join(CACHE_DIR, "faq");
const ROOT_DIR = path.join(__dirname, "..", "..");
const GUIDANCE_DIR = path.join(CACHE_DIR, "faq", "pending-guidance");
const AUTHORS_PATH = path.join(FAQ_DIR, "AUTHORS.md");
const CONTRIBUTORS_PATH = path.join(ROOT_DIR, "CONTRIBUTORS.md");

const EDIT_ON_GITHUB_ROOT = "https://github.com/orcwg/cra-hub/edit/main/"

// Timestamp constants (in days)
const NEW_CONTENT_THRESHOLD = 30;  // Content is "new" if created within 30 days
const RECENTLY_UPDATED_THRESHOLD = 14;  // Content is "recently updated" if modified within 14 days
const ROOT_LIST_ID = "faq";
const LIST_FILENAME = 'README.yml';

const FAQ = "faq";
const GUIDANCE_REQUEST = "guidance-request";
const LIST = "list";

const mdPlain = markdownIt().use(plainTextPlugin);

// ============================================================================
// Utility Functions - Path and URL
// ============================================================================

// Generate edit-on-GitHub URL for a file relative to CACHE_DIR
function getEditOnGithubUrl(relativePath) {
  return new URL(relativePath, EDIT_ON_GITHUB_ROOT).href;
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

// Extract GitHub issue number from URL
// Returns the issue number or null if not found
function extractIssueNumber(issueUrl) {
  // Match GitHub issue URL pattern: /issues/123
  const match = issueUrl.match(/\/issues\/(\d+)/);
  return match ? match[1] : null;
}

// Parse related issues from frontmatter
// Input can be a single string or an array of strings
// Returns an array of issue objects with url and number
function parseRelatedIssues(relatedIssues) {
  if (!relatedIssues) {
    return [];
  }

  const issueUrls = relatedIssues.trim().split(/,\s*/);
  // Transform URLs to objects with url and number

  return issueUrls.map(url => ({
    url: url,
    number: extractIssueNumber(url)
  }));
}

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

// Check if content is new (created within threshold)
function isNew(createdAt) {
  const daysAgo = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysAgo <= NEW_CONTENT_THRESHOLD;
}

// Check if content was recently updated (modified within threshold, but not counting initial creation)
function recentlyUpdated(createdAt, lastUpdatedAt) {
  // If creation and update dates are the same, it hasn't been updated since creation
  if (createdAt.getTime() === lastUpdatedAt.getTime()) return false;

  const daysAgo = (Date.now() - lastUpdatedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysAgo <= RECENTLY_UPDATED_THRESHOLD;
}

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

function getFile(file) {
  const fullPath = path.join(file.parentPath, file.name);
  const rawContent = fs.readFileSync(fullPath, "utf-8");
  const relativePath = path.relative(CACHE_DIR, fullPath);
  const posixPath = toPosixPath(relativePath);
  const { createdAt, lastUpdatedAt } = getTimestampsForObj(posixPath);

  return {
    filename: file.name,
    path: path.relative(CACHE_DIR, file.parentPath),
    fullPath,
    posixPath,
    editOnGithubUrl: getEditOnGithubUrl(relativePath),
    rawContent,
    createdAt,
    lastUpdatedAt,
    isNew: isNew(createdAt),
    recentlyUpdated: recentlyUpdated(createdAt, lastUpdatedAt)
  };
}

function getMarkdownFile(entry) {
  const file = getFile(entry);
  const parsed = matter(file.rawContent);
  file.frontmatter = parsed.data;
  file.content = parsed.content.trim();

  const posixPathWithoutExt = file.posixPath.replace(/\.md$/, "");
  file.permalink = "/" + posixPathWithoutExt + "/"; // backslash to make eleventy happy
  file.id = posixPathWithoutExt.replace(/^faq\//, "");
  file.category = file.id.replace(/\/[^\/]+$/, ""); // Extract directory path (everything before last slash)
  return file;
}

function getREADME(entry) { // cra-hub uses README.yml files to define FAQ lists
  const file = getFile(entry);
  file.yaml = yaml.load(file.rawContent);

  const posixDirPath = file.posixPath.replace(/\/README\.yml$/, "");
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

  guidanceRequests.forEach(guidance => {
    index[`guidance/${guidance.id}`] = guidance;
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
  const status = file.frontmatter.Status.replace(/^(⚠️|🛑|✅)\s*/, '').replace(" ", "-").trim().toLowerCase();
  const needsRefactoring = (/>\s*\[!WARNING\]\s*\n>\s*.*needs\s+refactoring/).test(file.content);

  // Extract question and answer
  const [question, answer] = splitMarkdownAtFirstH1(file.content);

  // Set guidance ID
  const guidanceId = file.frontmatter["guidance-id"] ? "pending-guidance/" + file.frontmatter["guidance-id"].trim() : false;

  return {
    ...file,
    type: FAQ,
    status,
    needsRefactoring,
    relatedIssues: parseRelatedIssues(file.frontmatter["Related issue"] || file.frontmatter["Related issues"]), // Temporarily use both, remove once CRA-HUB source is normalized to Related issues.
    pageTitle: markdownToPlainText(question),
    question,
    answer,
    answerMissing: (answer.length == 0),
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
  const status = file.frontmatter.status.replace(/^(⚠️|🛑|✅)\s*/, '').replace(" ", "-").trim().toLowerCase();

  // Extract title and body
  const [title, body] = splitMarkdownAtFirstH1(file.content);

  return {
    ...file,
    permalink: file.permalink.replace(/^\/faq/, ""), // Move guidance permalinks out of faq dir
    type: GUIDANCE_REQUEST,
    status,
    pageTitle: markdownToPlainText(title),
    title,
    body,
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
    pageTitle: markdownToPlainText(file.yaml.title),
    title: file.yaml.title,
    icon: file.yaml.icon,
    description: file.yaml.description,
    isRoot,
    parents: [], // Lists that include this list (filled during cross-referencing)
    faqCount: 0,
    listCount: 0
  }
}

// ============================================================================
// Authors Processing
// ============================================================================


// Read and return AUTHORS.md/CONTRIBUTORS.md content
function fetchAcknowledgementsFile(path) {

  if (!fs.existsSync(path)) {
    throw new Error(`File not found at ${path}.`);
  }

  const rawContent = fs.readFileSync(path, "utf-8");
  const parsed = matter(rawContent);
  const content = parsed.content.trim();


  if (!content) {
    throw new Error(`File at ${path} is empty or has no content after frontmatter.`);
  }

  return content;
}

// Read, curate and compose the data for the merge of the two files
function processAcknowledgements(authorsPath, contribPath) {
  // Extract the different names list in the bodies into arrays
  return {
    faqAuthors: extractNames(fetchAcknowledgementsFile(authorsPath)),
    websiteContributors: extractNames(fetchAcknowledgementsFile(contribPath))
  };
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
    // Skip if this list has no YAML definition (dynamic lists don't have YAML)
    if (!list.yaml?.faqs) {
      return;
    }

    const childRefs = normalizeReferenceIds(list.yaml.faqs, list.isRoot ? null : list.id);
    list.children = childRefs.map(itemRef => {
      // Check for dynamic list namespace (~dynamic/name)
      if (itemRef.startsWith('~dynamic/')) {
        const dynamicListId = itemRef.substring(9); // Remove '~dynamic/' prefix
        const sublist = lists.find(l => l.id === dynamicListId);
        if (sublist) {
          sublist.parents.push(list);
          return sublist;
        }
      }

      // Check if it's a regular list reference
      const sublist = lists.find(l => l.id === itemRef);
      if (sublist) {
        sublist.parents.push(list);
        return sublist;
      }

      // Otherwise treat as FAQ reference
      const faqObject = faqs.find(faq => faq.id === itemRef);
      if (faqObject) {
        faqObject.parents.push(list);
        faqObject.listed = true;  // Tag FAQ as listed in a YAML-based list
        return faqObject;
      }

      return null;
    }).filter(item => item !== null);
  });
}

// ============================================================================
// Dynamic Lists
// ============================================================================

// Dynamic list configurations
// Each list has metadata and filter functions to determine behavior

const DYNAMIC_LISTS = [
  {
    id: 'new',
    title: 'New FAQs',
    icon: '🌟',
    description: `FAQs added within the last ${NEW_CONTENT_THRESHOLD} days`,
    emptyMsg: "It seems there aren't any newly created FAQs",
    inclusionFilter: (faq) => faq.isNew,
    sortChildren: (a, b) => b.createdAt - a.createdAt,  // Newest first
    hideInAllFaqsFilter: () => true,  // Always hide in "All FAQs" view
    hideInTopicsFilter: (list) => list.children.length === 0,  // Hide if empty
    insertAt: 'top'  // Insert at top of root list
  },
  {
    id: 'recently-updated',
    title: 'Recently Updated FAQs',
    icon: '💫',
    description: `FAQs updated within the last ${RECENTLY_UPDATED_THRESHOLD} days`,
    emptyMsg: "It seems there aren't any recently updated FAQs",
    inclusionFilter: (faq) => faq.recentlyUpdated,
    sortChildren: (a, b) => b.lastUpdatedAt - a.lastUpdatedAt,  // Most recently updated first
    hideInAllFaqsFilter: () => true,  // Always hide in "All FAQs" view
    hideInTopicsFilter: (list) => list.children.length === 0,  // Hide if empty
    insertAt: 'top'  // Insert at bottom of root list
  },
  {
    id: 'unlisted',
    title: 'Unlisted FAQs',
    icon: '❌',
    description: 'FAQs not yet assigned to any list',
    emptyMsg: 'Great news! All FAQs are properly assigned to lists. There are currently no unlisted FAQs.',
    inclusionFilter: (faq) => !faq.listed,  // Include FAQs not tagged as listed
    sortChildren: null,  // No sorting
    hideInAllFaqsFilter: (list) => list.children.length === 0,  // Hide if empty
    hideInTopicsFilter: (list) => list.children.length === 0,  // Hide if empty
    insertAt: 'bottom'  // Insert at bottom of root list
  }
];

// Create a dynamic list from configuration
function createDynamicList(config) {
  return {
    type: LIST,
    id: config.id,
    permalink: `/faq/${config.id}/`,
    pageTitle: config.title,
    title: config.title,
    icon: config.icon,
    description: config.description,
    emptyMsg: config.emptyMsg,
    children: [], // Populated during cross-referencing
    parents: [], // Populated during cross-referencing
    faqCount: 0,
    listCount: 0
  };
}

// Populate dynamic lists based on FAQ properties and filter functions
function populateDynamicLists(lists, faqs) {
  // Build index of dynamic lists
  const dynamicListsIndex = {};
  DYNAMIC_LISTS.forEach(config => {
    const list = lists.find(l => l.id === config.id);
    if (list) {
      list.children.push(...faqs.filter(config.inclusionFilter));
      if (config.sortChildren) { list.children.sort(config.sortChildren); }
      dynamicListsIndex[config.id] = { list, config };
    }
  });

// Finalize dynamic lists metadata after population
function finalizeDynamicListMetadata(lists) {
  const dynamicListIds = DYNAMIC_LISTS.map(config => config.id);
  const dynamicLists = lists.filter(l => dynamicListIds.includes(l.id));

  dynamicLists.forEach(list => {
    // Find the config for this list
    const config = DYNAMIC_LISTS.find(c => c.id === list.id);

    // Calculate timestamps from children
    const { createdAt, lastUpdatedAt } = generateTimestamps(list.children);
    list.createdAt = createdAt;
    list.lastUpdatedAt = lastUpdatedAt;
    list.isNew = isNew(createdAt);
    list.recentlyUpdated = recentlyUpdated(createdAt, lastUpdatedAt);

    // Apply hideInTopicsFilter function from config
    if (config?.hideInTopicsFilter) {
      list.hideInTopics = config.hideInTopicsFilter(list);
    }

    // Apply hideInAllFaqsFilter function from config
    if (config?.hideInAllFaqsFilter) {
      list.hideInAllFaqs = config.hideInAllFaqsFilter(list);
    }
  });
}

// ============================================================================
// List Utilities
// ============================================================================

// Recursively count all descendants (FAQs and lists) at all nesting levels
function countListChildElementsRecursively(list) {
  let faqCount = 0;
  let listCount = 0;

  list.children.forEach(item => {
    if (item.type === 'faq') {
      faqCount++;
    } else if (item.type === 'list') {
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

// Resolve custom link syntax in content fields
function resolveLinksInContent(items, fieldName, internalLinkIndex) {
  items.forEach(item => {
    item[fieldName] = resolveLinks(item[fieldName], item.category, internalLinkIndex, craReferences);
  });
}

// ============================================================================
// Main Pipeline
// ============================================================================

// Orchestrate the complete data processing pipeline
function processAllContent() {
  const entries = fs.readdirSync(FAQ_DIR, { withFileTypes: true, recursive: true });

  const faqs = entries.filter(isFaq).map(getMarkdownFile).map(createFaq);
  const guidanceRequests = entries.filter(isGuidance).map(getMarkdownFile).map(createGuidanceRequest);
  const lists = entries.filter(isList).map(getREADME).map(createList);
  const rootList = lists.find(list => list.id === ROOT_LIST_ID);

  crossReferenceFaqsAndGuidanceRequests(faqs, guidanceRequests);

  // Create dynamic lists BEFORE cross-referencing so they can be referenced in YAML files
  const dynamicLists = DYNAMIC_LISTS.map(createDynamicList);

  // Add dynamic lists to the lists array so they can be found during cross-referencing
  lists.push(...dynamicLists);

  // Add dynamic list IDs to root's YAML (only those not manually placed)
  // Use ~dynamic/ namespace to distinguish from regular lists
  // Separate into top and bottom insertions based on insertAt property
  const topInsertions = [];
  const bottomInsertions = [];

  DYNAMIC_LISTS.forEach(config => {
    const reference = `~dynamic/${config.id}`;
    // Only auto-add if not already manually placed
    if (!rootList.yaml.faqs.includes(reference)) {
      if (config.insertAt === 'top') {
        topInsertions.push(reference);
      } else {
        bottomInsertions.push(reference);
      }
    }
  });

  // Add top insertions in reverse order (so first in array appears first in list)
  rootList.yaml.faqs.unshift(...topInsertions.reverse());

  // Add bottom insertions in order (so first in array appears first after regular items)
  rootList.yaml.faqs.push(...bottomInsertions);

  // Cross-reference YAML-based lists and FAQs
  crossReferenceListsAndFaqs(lists, faqs);

  // Populate dynamic lists based on FAQ properties
  populateDynamicLists(lists, faqs);

  // Finalize dynamic list metadata (timestamps, hideInTopics, etc.)
  finalizeDynamicListMetadata(lists);

  calculateListCounts(lists);

  const internalLinkIndex = createInternalLinkIndex(faqs, lists, guidanceRequests);

  resolveLinksInContent(faqs, 'answer', internalLinkIndex);
  resolveLinksInContent(guidanceRequests, 'body', internalLinkIndex);

  const acknowledgements = processAcknowledgements(AUTHORS_PATH, CONTRIBUTORS_PATH);

  return {
    faqs,
    guidance: guidanceRequests,
    lists,
    rootList,
    acknowledgements
  };
}

// ============================================================================
// Module Export
// ============================================================================

// Main entry point for 11ty data processing

module.exports = processAllContent;
