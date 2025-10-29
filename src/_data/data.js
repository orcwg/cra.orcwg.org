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
const REPO_CONTRIBUTORS_FILE = path.join(CACHE_DIR, "repoContributors.json");

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
  if (!firsth1) return ['', content]; // Gracefully handle if no H1 is found
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

  const faqFiles = files.filter(entry => {
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
  const category = path.basename(faq.path);
  const filename = faq.filename.replace('.md', '');
  const id = `${ category }/${ filename }`;

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
    category: category,
    filename: filename,
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
// Contributor Processing
// ============================================================================

/**
 * Extracts unique contributors from FAQ frontmatter.
 * @param {Array} rawFaqs - Array of parsed FAQ markdown files.
 * @returns {Array} An array of contributor objects.
 */
function getFaqContributors(rawFaqs) {
  const contributors = new Map();

  rawFaqs.forEach(faq => {
    if (faq.data.contributors && Array.isArray(faq.data.contributors)) {
      faq.data.contributors.forEach(contributor => {
        const key = contributor.github?.toLowerCase();
        if (!key) return; // Skip contributors without a github handle

        if (!contributors.has(key)) {
          contributors.set(key, { ...contributor });
        }
      });
    }
  });

  return Array.from(contributors.values());
}

/**
 * Loads repository contributors from the cached JSON file.
 * @returns {Array} An array of contributor objects.
 */
function getRepoContributors() {
  if (!fs.existsSync(REPO_CONTRIBUTORS_FILE)) {
    console.warn(`[data.js] Contributor cache file not found at ${REPO_CONTRIBUTORS_FILE}. Run the cache update script.`);
    return [];
  }

  try {
    const rawData = fs.readFileSync(REPO_CONTRIBUTORS_FILE, "utf-8");
    const repoContributors = JSON.parse(rawData);

    // Normalize data (assuming from GitHub API) to match FAQ contributor structure
    return repoContributors.map(c => ({
      name: c.login, // Default name to login, can be overridden by FAQ data
      github: c.login,
      avatar_url: c.avatar_url,
      github_url: c.html_url
    }));
  } catch (error) {
    console.error(`[data.js] Error reading or parsing ${REPO_CONTRIBUTORS_FILE}:`, error);
    return [];
  }
}

/**
 * Merges FAQ and repository contributors, deduplicates, and adds contribution types.
 * @param {Array} faqContributors - Contributors from FAQ frontmatter.
 * @param {Array} repoContributors - Contributors from repository history.
 * @returns {Array} A sorted array of unique contributor objects.
 */
function mergeContributors(faqContributors, repoContributors) {
  const allContributors = new Map();

  // Process FAQ contributors first, as they may have more accurate names.
  faqContributors.forEach(c => {
    const key = c.github?.toLowerCase();
    if (!key) return;
    allContributors.set(key, {
      ...c,
      contributionTypes: ['FAQ']
    });
  });

  // Process repo contributors, merging with existing entries.
  repoContributors.forEach(c => {
    const key = c.github?.toLowerCase();
    if (!key) return;

    if (allContributors.has(key)) {
      const existing = allContributors.get(key);
      existing.contributionTypes.push('Repository');
      // Enrich existing data with details from repo info if missing
      existing.avatar_url = existing.avatar_url || c.avatar_url;
      existing.github_url = existing.github_url || c.github_url;
    } else {
      allContributors.set(key, {
        ...c,
        contributionTypes: ['Repository']
      });
    }
  });

  return Array.from(allContributors.values()).sort((a, b) => a.name.localeCompare(b.name));
}