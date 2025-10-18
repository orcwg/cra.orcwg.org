// ============================================================================
// Dependencies
// ============================================================================
const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const markdownIt = require("markdown-it");
const plainTextPlugin = require("markdown-it-plain-text");
const yaml = require("js-yaml");

// ============================================================================
// Constants
// ============================================================================
const CACHE_DIR = path.join(__dirname, "..", "..", "_cache");

const FAQ_DIR = path.join(CACHE_DIR, "faq");
const GUIDANCE_DIR = path.join(CACHE_DIR, "faq", "pending-guidance");

const EDIT_ON_GITHUB_ROOT = "https://github.com/orcwg/cra-hub/edit/main/"

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
      data: parsedYaml
    }
  });

  return parsedYamlFiles;
}

// ============================================================================
// FAQ Processing
// ============================================================================

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
  // Set ID to basedir/filename-without-extension.
  const id = path.join(path.basename(faq.path), faq.filename.replace('.md', ''));

  // Normalize status
  const status = faq.data.Status.replace(/^(⚠️|🛑|✅)\s*/, '').replace(" ", "-").trim().toLowerCase();

  // Generate edit on github URL
  const editOnGithubUrl = new URL(`${faq.path}/${faq.filename}`, EDIT_ON_GITHUB_ROOT).href;

  // Extract question and answer
  const [question, answer] = splitMarkdownAtFirstH1(faq.content);

  // Set guidance ID
  const guidanceId = faq.data["guidance-id"] ? faq.data["guidance-id"].trim() : false;

  return {
    id: id,
    status: status,
    permalink: `/faq/${id}/`,
    editOnGithubUrl: editOnGithubUrl,
    relatedIssue: faq.data["Related issue"],
    pageTitle: markdownToPlainText(question),
    question: question,
    answer: answer,
    answerMissing: (answer.length == 0),
    guidanceId: guidanceId,
    relatedLists: []
  };
}


// Process all FAQ files into structured objects
function createProcessedFaqs(faqDir) {
  const faqFiles = getFaqFiles(faqDir);
  const rawFaqs = parseMarkdownFiles(faqFiles);
  const processedFaqs = rawFaqs.map(faq => {
    return getProcessedFaq(faq);
  });

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

  return {
    id: id,
    status: status,
    permalink: `/${id}/`,
    editOnGithubUrl: editOnGithubUrl,
    relatedIssue: guidanceRequest.data["Related issue"],
    pageTitle: markdownToPlainText(title),
    title: title,
    body: body,
    guidanceText: extractGuidanceText(body),
  };
};

// Process all guidance request files into structured objects
function createProcessedGuidanceRequests(guidanceDir) {
  const guidanceFiles = getGuidanceFiles(guidanceDir);
  const guidanceRequests = parseMarkdownFiles(guidanceFiles);
  const processedGuidanceRequests = guidanceRequests.map(guidanceRequest => {
    return getProcessedGuidanceRequest(guidanceRequest);
  });

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
  const id = path.basename(curatedList.path);

  // Normalize FAQ references so they match FAQ Ids. Allows for a curated list to reference FAQ in or out of its category
  const normalizedFaqRefs = values.faqs.map(faqRef => {
    if (faqRef.includes('/')) {
      return faqRef;
    } else {
      return `${id}/${faqRef}`;
    }
  });

  return {
    id: id,
    title: values.title,
    icon: values.icon,
    faqs: normalizedFaqRefs,
    permalink: `/lists/${id}/`,
    description: values.description
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

  // 6. Get and process AUTHORS.md
  const authorsContent = processAuthorsFile();

  return {
    faqs: faqs,
    guidance: guidanceRequests,
    faqItems: faqs,
    lists: lists,
    authorsContent
  };
}

// ============================================================================
// Module Export
// ============================================================================

// Main entry point for 11ty data processing
module.exports = function () {
  const content = processAllContent();

  return content;
};
