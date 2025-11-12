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
const GUIDANCE_DIR = path.join(CACHE_DIR, "faq", "pending-guidance");

const EDIT_ON_GITHUB_ROOT = "https://github.com/orcwg/cra-hub/edit/main/"

// Timestamp constants (in days)
const NEW_CONTENT_THRESHOLD = 30;  // Content is "new" if created within 30 days
const RECENTLY_UPDATED_THRESHOLD = 14;  // Content is "recently updated" if modified within 14 days

const mdPlain = markdownIt().use(plainTextPlugin);

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

  return function getTimestampsForObj(fileObj) {
    return timestampMap.get(fileObj.posixPath);
  };
})(CACHE_DIR);

// ============================================================================
// Utility Functions - File Operations
// ============================================================================

// Read and parse multiple markdown files
function parseMarkdownFiles(files) {
  const parsedMarkdownFiles = files.map(file => {
    const fullPath = path.join(file.parentPath, file.name);
    const rawFile = fs.readFileSync(fullPath, "utf-8");
    const parsed = matter(rawFile);

    return {
      filename: file.name,
      path: path.relative(CACHE_DIR, file.parentPath),
      posixPath: path.relative(CACHE_DIR, fullPath).split(path.sep).join("/"),
      data: parsed.data,
      content: parsed.content.trim()
    };
  });

  return parsedMarkdownFiles;
}

// Read and parse multiple yml files
function parseYamlFiles(files) {
  const parsedYamlFiles = files.map(file => {
    const fullPath = path.join(file.parentPath, file.name);
    const rawFile = fs.readFileSync(fullPath, "utf-8");
    const parsedYaml = yaml.load(rawFile);

    return {
      filename: file.name,
      path: path.relative(CACHE_DIR, file.parentPath),
      posixPath: path.relative(CACHE_DIR, fullPath).split(path.sep).join("/"),
      data: parsedYaml
    }
  });

  return parsedYamlFiles;
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

// Get FAQ markdown files (excludes pending-guidance and root files)
function getFaqFiles(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true, recursive: true });

  faqFiles = files.filter(entry => {
    return entry.parentPath !== GUIDANCE_DIR &&  // Reject pending-guidance files
      entry.parentPath !== dir &&     // Reject files at the root of the FAQ
      entry.isFile() &&                     // Reject directories
      entry.name.endsWith('.md');           // Keep only markdown files
  });

  return faqFiles;
}

// Process a single FAQ
function getProcessedFaq(faq) {
  // Extract category and filename
  const category = path.basename(faq.path).split(path.sep).join("/");
  const filename = faq.filename.replace('.md', '');
  const id = `${category}/${filename}`;

  // Normalize status
  const status = faq.data.Status.replace(/^(⚠️|🛑|✅)\s*/, '').replace(" ", "-").trim().toLowerCase();
  const needsRefactoring = (/>\s*\[!WARNING\]\s*\n>\s*.*needs\s+refactoring/).test(faq.content);
  // Generate edit on github URL
  const editOnGithubUrl = new URL(`${faq.path}/${faq.filename}`, EDIT_ON_GITHUB_ROOT).href;

  // Extract question and answer
  const [question, answer] = splitMarkdownAtFirstH1(faq.content);

  // Set guidance ID
  const guidanceId = faq.data["guidance-id"] ? faq.data["guidance-id"].trim() : false;

  // Get git timestamps for this file
  const { createdAt, lastUpdatedAt } = getTimestampsForObj(faq);

  return {
    id,
    category,
    filename,
    posixPath: faq.posixPath,
    status,
    needsRefactoring,
    permalink: `/faq/${id}/`,
    editOnGithubUrl,
    relatedIssues: parseRelatedIssues(faq.data["Related issue"] || faq.data["Related issues"]), // Temporarily use both, remove once CRA-HUB source is normalized to Related issues.
    pageTitle: markdownToPlainText(question),
    question,
    answer,
    answerMissing: (answer.length == 0),
    guidanceId,
    relatedLists: [],
    createdAt,
    lastUpdatedAt,
    isNew: isNew(createdAt),
    recentlyUpdated: recentlyUpdated(createdAt, lastUpdatedAt)
  };
}


// Process all FAQ files into structured objects
function createProcessedFaqs(faqDir) {
  const faqFiles = getFaqFiles(faqDir);
  const rawFaqs = parseMarkdownFiles(faqFiles);
  const processedFaqs = rawFaqs.map(getProcessedFaq);

  return processedFaqs;
};

// ============================================================================
// Guidance Request Processing
// ============================================================================

// Get guidance request markdown files
function getGuidanceFiles(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  const guidanceFiles = files.filter(entry => {
    return entry.isFile() &&                     // Reject directories
      entry.name.endsWith('.md');           // Keep only markdown files
  });

  return guidanceFiles;
}

function getProcessedGuidanceRequest(guidanceRequest) {
  // Set ID to basedir/filename-without-extension.
  const id = guidanceRequest.filename.replace('.md', '');

  // Normalize status
  const status = guidanceRequest.data.status.replace(/^(⚠️|🛑|✅)\s*/, '').replace(" ", "-").trim().toLowerCase();

  // Generate edit on github URL
  const editOnGithubUrl = new URL(`${guidanceRequest.path}/${guidanceRequest.filename}`, EDIT_ON_GITHUB_ROOT).href;

  // Extract title and body
  const [title, body] = splitMarkdownAtFirstH1(guidanceRequest.content);

  // Get git timestamps for this file
  const { createdAt, lastUpdatedAt } = getTimestampsForObj(guidanceRequest);

  return {
    id,
    posixPath: guidanceRequest.posixPath,
    status,
    permalink: `/pending-guidance/${id}/`,
    editOnGithubUrl,
    relatedIssue: guidanceRequest.data["Related issue"],
    pageTitle: markdownToPlainText(title),
    title,
    body,
    guidanceText: extractGuidanceText(body),
    createdAt,
    lastUpdatedAt,
    isNew: isNew(createdAt),
    recentlyUpdated: recentlyUpdated(createdAt, lastUpdatedAt)
  };
};

// Process all guidance request files into structured objects
function createProcessedGuidanceRequests(guidanceDir) {
  const guidanceFiles = getGuidanceFiles(guidanceDir);
  const guidanceRequests = parseMarkdownFiles(guidanceFiles);
  const processedGuidanceRequests = guidanceRequests.map(getProcessedGuidanceRequest);

  return processedGuidanceRequests;
};

// ============================================================================
// Curated List Processing
// ============================================================================

// Get README.yml files from FAQ subdirectories
function getCuratedListFiles(faqDir) {
  const files = fs.readdirSync(faqDir, { withFileTypes: true, recursive: true });

  const curatedListFiles = files.filter(entry => {
    return entry.isFile() &&                    // Only files
      entry.name === 'README.yml' &&            // Must be named README.yml
      entry.parentPath !== faqDir;              // Not at the root of FAQ directory
  });

  return curatedListFiles;
}

// Parse a curated list
function getProcessedCuratedList(curatedList) {
  const values = curatedList.data;
  const id = path.basename(curatedList.path).split(path.sep).join("/");

  // Normalize FAQ references so they match FAQ Ids. Allows for a curated list to reference FAQ in or out of its category
  const normalizedFaqRefs = values.faqs.map(faqRef => {
    if (faqRef.includes('/')) {
      return faqRef;
    } else {
      return `${id}/${faqRef}`;
    }
  });

  // Get git timestamps for this file
  const { createdAt, lastUpdatedAt } = getTimestampsForObj(curatedList);

  return {
    id,
    posixPath: curatedList.posixPath,
    title: values.title,
    icon: values.icon,
    faqs: normalizedFaqRefs,
    permalink: `/faq/${id}/`,
    description: values.description,
    createdAt,
    lastUpdatedAt,
    isNew: isNew(createdAt),
    recentlyUpdated: recentlyUpdated(createdAt, lastUpdatedAt)
  }
}

// Process list files and normalize FAQ references
function createLists(faqDir) {
  const rawListFiles = getCuratedListFiles(faqDir);
  const parsedLists = parseYamlFiles(rawListFiles);
  const lists = parsedLists.map(getProcessedCuratedList);

  return lists;
};

// ============================================================================
// Authors Processing
// ============================================================================

// Read and return AUTHORS.md content
function processAuthorsFile() {
  const authorsPath = path.join(FAQ_DIR, "AUTHORS.md");

  if (!fs.existsSync(authorsPath)) {
    throw new Error(`AUTHORS.md not found at ${authorsPath}. Ensure the cache is populated.`);
  }

  const rawContent = fs.readFileSync(authorsPath, "utf-8");
  const parsed = matter(rawContent);
  const content = parsed.content.trim();

  if (!content) {
    throw new Error(`AUTHORS.md at ${authorsPath} is empty or has no content after frontmatter.`);
  }

  return content;
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

// Link lists with their FAQs (bidirectional)
function crossReferenceListsAndFaqs(lists, faqs) {
  lists.forEach(list => {
    list.faqs = list.faqs.map(faqId => {
      const faqObject = faqs.find(faq => faq.id === faqId);
      faqObject.relatedLists.push(list);
      return faqObject;
    });
  });
}

// ============================================================================
// Main Pipeline
// ============================================================================

// Orchestrate the complete data processing pipeline
function processAllContent() {

  // 1. Get and parse FAQs
  const faqs = createProcessedFaqs(FAQ_DIR);

  // 2. Get and parse Guidance Requests
  const guidanceRequests = createProcessedGuidanceRequests(GUIDANCE_DIR);

  // 3. Enrich FAQs and Guidance Requests with their cross references
  crossReferenceFaqsAndGuidanceRequests(faqs, guidanceRequests);

  // 4. Get lists
  const lists = createLists(FAQ_DIR);

  // 5. Connect lists with FAQs
  crossReferenceListsAndFaqs(lists, faqs);

  // 6. Create internal link index for all content types
  const internalLinkIndex = createInternalLinkIndex(faqs, lists, guidanceRequests);

  // 7. Resolve all custom link syntax in markdown content
  faqs.forEach(faq => {
    const context = { category: faq.category };
    faq.answer = resolveLinks(faq.answer, context, internalLinkIndex, craReferences);
  });

  guidanceRequests.forEach(guidance => {
    const context = { category: 'pending-guidance' };
    guidance.body = resolveLinks(guidance.body, context, internalLinkIndex, craReferences);
  });

  // 8. Get and process AUTHORS.md
  const authorsContent = processAuthorsFile();

  return {
    faqs,
    guidance: guidanceRequests,
    lists,
    authorsContent
  };
}

// ============================================================================
// Module Export
// ============================================================================

// Main entry point for 11ty data processing

module.exports = processAllContent;
