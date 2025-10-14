const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const markdownIt = require("markdown-it");
const plainTextPlugin = require("markdown-it-plain-text");

const CACHE_DIR = path.join(__dirname, "..", "..", "_cache", "faq");
const OUTPUT_DIR = path.join(__dirname, "..", "..", "_tmp");

const mdPlain = markdownIt().use(plainTextPlugin);

// Helper function to convert markdown to plain text for page titles
function markdownToPlainText(markdownText) {
  if (!markdownText) return "";
  mdPlain.render(markdownText);
  return mdPlain.plainText;
}

// Pure file system operations
function walkAllFiles(dir, category = "") {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const subFiles = walkAllFiles(fullPath, entry.name);
      files.push(...subFiles);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push({
        fullPath,
        filename: entry.name,
        category
      });
    }
  }

  return files;
}


// Pure content parsing functions
function parseMarkdown(rawContent, filename, category) {
  const parsed = matter(rawContent);

  // Skip files with no gray-matter
  if (!parsed.data || Object.keys(parsed.data).length === 0) {
    return null;
  }

  const content = parsed.content.trim();

  // Parse question from first # heading
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const question = titleMatch ? titleMatch[1] : null;

  // Everything after the first heading is the body content
  let body = null;
  if (titleMatch) {
    const afterTitle = content.substring(content.indexOf(titleMatch[0]) + titleMatch[0].length).trim();
    body = afterTitle;
  } else {
    // Fallback: treat entire content as body if no title found
    body = content;
  }

  return {
    filename,
    category,
    frontmatter: parsed.data,
    question,
    body
  };
}

function extractGuidanceText(content) {
  if (!content) return "";

  const lines = content.split('\n');
  let isInGuidanceSection = false;
  let shouldStop = false;
  let guidanceLines = [];

  lines.forEach(line => {
    if (shouldStop) return;

    const trimmedLine = line.trim();

    // Check if we're entering the "Guidance Needed" section
    if (trimmedLine.match(/^#+\s*Guidance Needed/i)) {
      isInGuidanceSection = true;
      return;
    }

    // Check if we're entering another section (any heading)
    if (isInGuidanceSection && trimmedLine.match(/^#+\s/)) {
      shouldStop = true;
      return;
    }

    // Collect lines while in the guidance section
    if (isInGuidanceSection && trimmedLine) {
      guidanceLines.push(trimmedLine);
    }
  });

  // Join the guidance text and process markdown
  const rawText = guidanceLines
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Convert markdown to HTML and then strip HTML tags for clean text
  if (rawText) {
    const markdownIt = require("markdown-it")();
    const htmlContent = markdownIt.render(rawText);
    return htmlContent.replace(/<[^>]*>/g, "").trim();
  }

  return "";
}


// Data enrichment for FAQ items
function processFaqItem(parsedItem) {
  const { frontmatter, filename, category, question, body } = parsedItem;

  // Validate that FAQ has a question/title
  if (!question) {
    throw new Error(`FAQ ${category}/${filename} has no question/title. All FAQs must have a # heading in their markdown content.`);
  }

  // Normalize status by removing emojis and converting to lowercase
  const status = frontmatter.Status.replace(/^(⚠️|🛑|✅)\s*/, '').trim().toLowerCase();

  return {
    filename,
    category,
    ...frontmatter,
    status,
    question,
    answer: body,
    pageTitle: markdownToPlainText(question),
    hasAnswer: Boolean(body && body.trim().length > 0),
    permalink: `/faq/${category}/${filename.replace('.md', '')}/`
  };
}

// Data enrichment for guidance items
function processGuidanceItem(parsedItem) {
  const { frontmatter, filename, category, question, body } = parsedItem;

  // Extract title - prefer frontmatter, fallback to question, then filename
  let title = frontmatter.title || question;
  if (!title) {
    // Fallback to filename
    title = filename.replace('.md', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  return {
    filename,
    category,
    data: frontmatter,
    status: frontmatter.status,
    title,
    body,
    pageTitle: markdownToPlainText(title),
    guidanceText: extractGuidanceText(body),
    permalink: `/pending-guidance/${filename.replace('.md', '')}/`
  };
}

// Cross-reference enrichment
function enrichWithGuidance(faqItems, guidanceItems) {
  return faqItems.map(faqItem => {
    if (faqItem['guidance-id']) {
      const relatedGuidance = guidanceItems.find(guidance =>
        guidance.filename === faqItem['guidance-id'] + '.md'
      );

      return {
        ...faqItem,
        guidanceItem: relatedGuidance || null
      };
    }
    return faqItem;
  });
}

function enrichWithRelatedFaqs(guidanceItems, faqItems) {
  return guidanceItems.map(guidance => {
    // Find all related FAQs that reference this guidance
    const relatedFaqs = [];
    const guidanceKey = guidance.filename.replace('.md', '');

    for (const faqItem of faqItems) {
      if (faqItem['guidance-id'] === guidanceKey) {
        relatedFaqs.push({
          category: faqItem.category,
          filename: faqItem.filename,
          question: faqItem.question,
          permalink: faqItem.permalink
        });
      }
    }

    return {
      ...guidance,
      relatedFaqs,
      relatedFaq: relatedFaqs[0] || null // Keep for backward compatibility
    };
  });
}

// Data organization
function organizeFaqsByCategory(faqItems) {
  const result = {};

  for (const item of faqItems) {
    if (!result[item.category]) {
      result[item.category] = [];
    }

    // Remove category from individual item since it's now the key
    const { category, ...itemWithoutCategory } = item;
    result[item.category].push(itemWithoutCategory);
  }

  return result;
}

// Process AUTHORS.md
function processAuthorsFile() {
  const authorsPath = path.join(CACHE_DIR, "AUTHORS.md");

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

// Main content processing function
function processAllContent() {
  // Step 1: Extract all content
  const allFiles = walkAllFiles(CACHE_DIR);
  const parsedContent = allFiles
    .map(file => {
      const rawContent = fs.readFileSync(file.fullPath, "utf-8");
      const parsed = parseMarkdown(rawContent, file.filename, file.category);
      return parsed ? { ...parsed, fullPath: file.fullPath } : null;
    })
    .filter(Boolean);

  // Step 2: Classify and process content types
  const faqItems = [];
  const guidanceItems = [];

  for (const item of parsedContent) {
    if (item.frontmatter.type === 'guidance-request') {
      guidanceItems.push(processGuidanceItem(item));
    } else {
      faqItems.push(processFaqItem(item));
    }
  }

  // Step 3: Cross-reference and enrich
  const enrichedFaqs = enrichWithGuidance(faqItems, guidanceItems);
  const enrichedGuidance = enrichWithRelatedFaqs(guidanceItems, faqItems);

  // Step 4: Process authors
  const authorsContent = processAuthorsFile();

  return {
    faqs: enrichedFaqs,
    guidance: enrichedGuidance,
    faqsByCategory: organizeFaqsByCategory(enrichedFaqs),
    faqItems: enrichedFaqs, // Flat array for pagination
    authorsContent
  };
}

// Main export with debug output
module.exports = function () {
  const content = processAllContent();

  // Write to _tmp/faq.json for debugging/inspection
  try {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "faq.json"),
      JSON.stringify(content.faqsByCategory, null, 2),
      "utf-8"
    );
    console.log("✅ Wrote faq.json to _tmp/");
  } catch (err) {
    console.error("⚠️ Could not write faq.json:", err);
  }

  return content;
};