const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const markdownIt = require("markdown-it");
const plainTextPlugin = require("markdown-it-plain-text");
const yaml = require("js-yaml");
const curatedLists = require("../../_tmp/curatedLists");

const CACHE_DIR = path.join(__dirname, "..", "..", "_cache");
const OUTPUT_DIR = path.join(__dirname, "..", "..", "_tmp");

const FAQ_DIR = path.join(CACHE_DIR, "faq");
const GUIDANCE_DIR = path.join(CACHE_DIR, "faq", "pending-guidance");

const EDIT_ON_GITHUB_ROOT = "https://github.com/orcwg/cra-hub/edit/main/"

const mdPlain = markdownIt().use(plainTextPlugin);

// Helper function to convert markdown to plain text for page titles
function markdownToPlainText(markdownText) {
  mdPlain.render(markdownText);
  return mdPlain.plainText.trim();
}

// Helper function to extract the guidance request abstract
function extractGuidanceText(content) {
  const lines = content.split('\n');

  // Find the start and end of the Guidance Needed section
  const guidanceStart = lines.findIndex(line =>
    line.trim().match(/^#+\s*Guidance Needed/i)
  );

  // Find the next heading after guidance section starts
  const guidanceEnd = lines.findIndex((line, index) =>
    index > guidanceStart && line.trim().match(/^#+\s/)
  );

  // Extract lines between start and end
  const endIndex = guidanceEnd === -1 ? lines.length : guidanceEnd;
  const guidanceLines = lines
    .slice(guidanceStart + 1, endIndex)
    .filter(line => line);

  // Convert to plain text
  const rawText = guidanceLines.join(' ');
  return markdownToPlainText(rawText).trim();
}

// Process AUTHORS.md
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

// Utility to fetch file paths from FAQ directory
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

// Takes an array of files from readdirSync, returns array of file objects with
// filename, front-matter data and md content.
function getParsedFiles(files) {
  return files.map(file => {
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
}

// Creates the array containing the FAQs.
function createProcessedFaqs(faqDir) {
  const faqFiles = getFaqFiles(faqDir);
  const rawFaqs = getParsedFiles(faqFiles);

  return rawFaqs.map(faq => {
    // Set ID to basedir/filename-without-extension.
    const id = path.join(path.basename(faq.path), faq.filename.replace('.md', ''));

    // Normalize status
    const status = faq.data.Status.replace(/^(⚠️|🛑|✅)\s*/, '').replace(" ", "-").trim().toLowerCase();

    // Generate edit on github URL
    const editOnGithubUrl = new URL(`${faq.path}/${faq.filename}`, EDIT_ON_GITHUB_ROOT).href;

    // Extract question and answer
    const questionMatch = faq.content.match(/^#\s+(.+)$/m);
    const question = questionMatch[1].trim(); // Extract just the text without the #
    const answer = faq.content.replace(questionMatch[0], '').trim();

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
      guidanceId: guidanceId
    };
  });
};

// Creates the array containing the guidance requests.
function getGuidanceFiles(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  const guidanceFiles = files.filter(entry => {
    return entry.isFile() &&                     // Reject directories
      entry.name.endsWith('.md');           // Keep only markdown files
  });

  return guidanceFiles;
}

function createProcessedGuidanceRequests(guidanceDir) {
  const guidanceFiles = getGuidanceFiles(guidanceDir);
  const guidanceRequests = getParsedFiles(guidanceFiles);
  return guidanceRequests.map(guidance => {
    // Set ID to basedir/filename-without-extension.
    const id = guidance.filename.replace('.md', '');

    // Normalize status
    const status = guidance.data.status.replace(/^(⚠️|🛑|✅)\s*/, '').replace(" ", "-").trim().toLowerCase();

    // Generate edit on github URL
    const editOnGithubUrl = new URL(`${guidance.path}/${guidance.filename}`, EDIT_ON_GITHUB_ROOT).href;

    // Extract title and body
    const titleMatch = guidance.content.match(/^#\s+(.+)$/m);
    const title = titleMatch[1].trim(); // Extract just the text without the #
    const body = guidance.content.replace(titleMatch[0], '').trim();

    return {
      id: id,
      status: status,
      permalink: `/${id}/`,
      editOnGithubUrl: editOnGithubUrl,
      relatedIssue: guidance.data["Related issue"],
      pageTitle: markdownToPlainText(title),
      title: title,
      body: body,
      guidanceText: extractGuidanceText(body),
    };
  });
};

// Connects FAQ and related guidance request objects
function connectRelatedGuidanceAndFaqs(guidanceRequests, faqs) {
  guidanceRequests.forEach(guidanceRequest => {
    guidanceRequest.relatedFaqs = [];
    relatedFaqs = faqs.filter(faq => (faq.guidanceId == guidanceRequest.id));
    relatedFaqs.forEach(relatedFaq => {
      guidanceRequest.relatedFaqs.push(relatedFaq);
      relatedFaq.relatedGuidanceRequest = guidanceRequest;
      relatedFaq.hasGuidanceId = true;
    })
  });
};

// Gets and parses curated list files
function getCuratedListFiles(faqDir) {
  const files = fs.readdirSync(faqDir, { withFileTypes: true, recursive: true });

  const curatedListFiles = files.filter(entry => {
    return entry.isFile() &&                    // Only files
      entry.name === 'README.yml' &&            // Must be named README.yml
      entry.parentPath !== faqDir;              // Not at the root of FAQ directory
  });

  return curatedListFiles.map(file => {
    const fullPath = path.join(file.parentPath, file.name);
    const rawFile = fs.readFileSync(fullPath, "utf-8");
    const parsedYaml = yaml.load(rawFile);

    return {
      filename: file.name,
      path: path.relative(CACHE_DIR, file.parentPath),
      data: parsedYaml
    };
  });
}

// Parses curated list files and normalizes FAQ references
function createCuratedLists(faqDir) {
  const rawCuratedListFiles = getCuratedListFiles(faqDir);
  const result = [];

  for (const listFile of rawCuratedListFiles) {
    const listKey = path.basename(listFile.path);
    const listConfig = listFile.data;
    const normalizedFaqRefs = [];

    // Normalize FAQ references to always include category/filename format
    for (const faqRef of listConfig.faqs) {
      let normalizedRef;

      if (faqRef.includes('/')) {
        // Already in "category/filename" format
        normalizedRef = faqRef;
      } else {
        // Missing category - use the list's category (basename of path)
        normalizedRef = `${listKey}/${faqRef}`;
      }

      normalizedFaqRefs.push(normalizedRef);
    }

    result.push({
      key: listKey,
      value: {
        ...listConfig,
        faqRefs: normalizedFaqRefs
      }
    });
  }

  return result;
};

// Connects curated lists with FAQs
function connectCuratedListsAndFaqs(curatedLists, faqs) {
  for (const list of curatedLists) {
    const listItems = [];

    // Build items array for this list
    for (const faqRef of list.value.faqRefs) {
      const faqItem = faqs.find(faq => faq.id === faqRef);

      if (faqItem) {
        listItems.push(faqItem);

        // Add this list to the FAQ's relatedLists array
        if (!faqItem.relatedLists) {
          faqItem.relatedLists = [];
        }
        faqItem.relatedLists.push(list);
      }
    }

    // Add items and count to the list
    list.value.items = listItems;
    list.value.count = listItems.length;
  }
};


// Main data pipeline function
function processAllContent() {

  // 1. Get and parse FAQs
  const faqs = createProcessedFaqs(FAQ_DIR);

  // 2. Get and parse Guidance Requests
  const guidanceRequests = createProcessedGuidanceRequests(GUIDANCE_DIR);

  // 3. Enrich FAQs and Guidance Requests with their cross references
  connectRelatedGuidanceAndFaqs(guidanceRequests, faqs);

  // 4. Get curated lists
  const curatedLists = createCuratedLists(FAQ_DIR);

  // 5. Connect curated lists with FAQs
  connectCuratedListsAndFaqs(curatedLists, faqs);

  // 6. Get and process AUTHORS.md
  const authorsContent = processAuthorsFile();

  return {
    faqs: faqs,
    guidance: guidanceRequests,
    faqItems: faqs,
    curatedLists: curatedLists,
    authorsContent
  };
}

// Main export with debug output
module.exports = function () {
  const content = processAllContent();

  return content;
};
