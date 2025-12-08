const fs = require('fs');
const path = require('path');
const { isNew, recentlyUpdated } = require('./utils/timestamp-helpers.js');
const { parseRelatedIssues } = require('./utils/issue-parser.js');

// Load configuration for list metadata
const craConfigPath = path.join(__dirname, 'official-faqs-config-lists.json');
const craConfig = JSON.parse(fs.readFileSync(craConfigPath, 'utf8'));

// Load configuration for FAQ metadata
const faqConfigPath = path.join(__dirname, 'official-faqs-config-faqs.json');
const faqConfig = JSON.parse(fs.readFileSync(faqConfigPath, 'utf8'));

const LINE_START = 72.024;
const LINE_END = LINE_START + 451;
const BOTTOM_MARGIN = 53.304;

const TITLE_SIZE = 20.04;
const SUB_TITLE_1_SIZE = 15.96;
const SUB_TITLE_2_SIZE = 14.04;
const BODY_TEXT_SIZE = 12;
const BODY_SUP_TEXT_SIZE = 6.96;
const FOOTNOTE_TEXT_SIZE = 9.96;
const FOOTNOTE_SUP_TEXT_SIZE = 6;

const LIST_BULLET = "•";

const BLOCK_BREAK_SIZE = BODY_TEXT_SIZE * 1.9;

// TOKENS

const _EMPTY = "EMPTY";
const _WHITE_SPACE = "WHITE_SPACE";
const _LIST_ITEM_START = "LIST_ITEM_START";
const _TITLE = "TITLE";
const _BODY_TEXT_ITALIC = "BODY_TEXT_ITALIC";
const _BODY_TEXT = "BODY_TEXT";
const _FOOTNOTE_INDEX = "FOOTNOTE_INDEX";
const _FOOTNOTE_CONTENT = "FOOTNOTE_CONTENT";
const _FOOTNOTE = "FOOTNOTE";
const _PAGE_NUM = "PAGE_NUM";

const _PARAGRAPH = "PARAGRAPH";
const _BLOCKQUOTE = "BLOCKQUOTE";
const _LIST_ITEM = "LIST_ITEM";

const FAQ = "faq";
const LIST = "list";

let regularFontName;

function identifyContentType(item, previous, pageNum) {
    if (item.str.trim() === "" + pageNum && item.transform[5] == BOTTOM_MARGIN) return _PAGE_NUM;
    if (item.str == "") return _EMPTY;
    if (item.str == " ") return _WHITE_SPACE;
    if (item.str.trim() == LIST_BULLET) return _LIST_ITEM_START;
    if (item.height == TITLE_SIZE) return _TITLE;
    if (item.height == SUB_TITLE_1_SIZE) return _TITLE;
    if (item.height == SUB_TITLE_2_SIZE) return _TITLE;
    if (item.height == BODY_TEXT_SIZE) {
      if (!regularFontName) {
        regularFontName = item.fontName;
      }
      return item.fontName == regularFontName ? _BODY_TEXT : _BODY_TEXT_ITALIC;
    }
    if (item.height == FOOTNOTE_SUP_TEXT_SIZE) return _FOOTNOTE_INDEX;
    if (item.height == FOOTNOTE_TEXT_SIZE) return _FOOTNOTE_CONTENT;
    if (item.height == BODY_SUP_TEXT_SIZE) return _FOOTNOTE;
    return 'UNKNOWN ' + item.height + " " + item.fontName;
}

// Parse PDF timestamps (D:YYYYMMDDHHmmSS format)
function parsePDFDate(pdfDateString) {
  const cleaned = pdfDateString
    .replace(/^D:/, '')
    .replace(/[+-]\d{2}'\d{2}'$/, '')
    .replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
  return new Date(cleaned);
}

async function parsePDFFAQs(pdfPath = path.join(__dirname, '../../FAQs_on_the_CRA_implementation_sTRdpBNlhitBjQbatAbYZtDejg_122331.pdf')) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const uint8Array = new Uint8Array(dataBuffer);

  // Use standard pdfjs-dist with DOM polyfills
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // Load the PDF document
  const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      useSystemFonts: true
  });

  const pdf = await loadingTask.promise;
  const metadata = await pdf.getMetadata();

  const creationDate = parsePDFDate(metadata.info.CreationDate);
  const modificationDate = parsePDFDate(metadata.info.ModDate);

  const { blocks, footnotes } = await parse(pdf);
  const result = buildTree(blocks, footnotes, creationDate, modificationDate);

  return result;
}

async function parse(pdf) {
  const blocks = [];
  const footnotes = {};
  let previous = null;
  let currentBlock = null;
  let currentFootnoteBlock = null;
  let IN_LIST = false;
  let IN_ITALICS = false;
  let IN_BODY_TEXT = false;
  
  function getCurrent() {
    return currentFootnoteBlock || currentBlock;
  }

  function handleLineBreak(lineBreak) {
    const current = getCurrent();
    if (lineBreak && current && !(/\-$/).test(current.text)) {
        current.text = current.text.trim() + " ";
    }
  }
  
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    let previousPos = null;
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    
    function flush(source) {
      // console.log("flush", source)
      if (currentBlock) {
        if (IN_ITALICS) {
          currentBlock.text = currentBlock.text.trim() + "_";
        }
        currentBlock.pageEnd = pageNum;
        blocks.push(currentBlock);
        currentBlock = null;
      }
      IN_ITALICS = false;
      flushFootnote(source);
    }
    
    function flushFootnote(source) {
      // console.log("flush footnote", source)
      if (currentFootnoteBlock) {
        currentFootnoteBlock.pageEnd = pageNum;
        footnotes[currentFootnoteBlock.number] = currentFootnoteBlock;
        currentFootnoteBlock = null;
      }
    }
    
    function Block(type, text = "") {
      return {
        pageStart: pageNum,
        pageEnd: null,
        type,
        text
      }
    }

    textContent.items.forEach(i => {
      const lineBreak = !previousPos || previousPos != i.transform[5];
      const blockBreak = (previousPos && previousPos - i.transform[5] > BLOCK_BREAK_SIZE) || (!previousPos && !IN_BODY_TEXT);
      const type = identifyContentType(i, previous, pageNum);
      //console.log(type, previousPos, "in body:", IN_BODY_TEXT, JSON.stringify(i))
      
      if (IN_LIST && i.transform[4] == LINE_START) {
        IN_LIST = false;
        flush(LINE_START);
      }
      switch (type) {
        case _PAGE_NUM:
        case _EMPTY:
          break;
        case _WHITE_SPACE:
          let current = getCurrent();
          if (current) {
            current.text = current.text.trim() + " ";
          }
          break;
        case _LIST_ITEM_START:
          previousPos = i.transform[5]
          flush(type);
          currentBlock = new Block(_LIST_ITEM, "* ");
          IN_LIST = true;
          break;
        case _TITLE:
          if (blockBreak) {
            flush("BLOCK_BREAK");
          }
          previousPos = i.transform[5]
          if (currentBlock && currentBlock.type === type) {
            handleLineBreak(lineBreak);
            currentBlock.text += i.str;
          } else {
            flush(type);
            currentBlock = new Block(type, i.str);
          }
          break;
        case _BODY_TEXT:
          IN_BODY_TEXT = i.width + i.transform[4] > LINE_END;
          if (blockBreak) {
            flush("BLOCK_BREAK");
          }
          previousPos = i.transform[5]
          if (currentBlock && (currentBlock.type === _PARAGRAPH || currentBlock.type === _LIST_ITEM)) {
            if (IN_ITALICS) {
              IN_ITALICS = false;
              if ((/^[\w\(\d]/i).test(i.str)) {
                currentBlock.text = currentBlock.text.trim() + "_ " + i.str;
              } else {
                currentBlock.text = currentBlock.text.trim() + "_" + i.str;
              }
            } else {
              handleLineBreak(lineBreak);
              currentBlock.text += i.str;
            }
          } else {
            flush(type);
            currentBlock = new Block(_PARAGRAPH, i.str);
          }
          break;
        case _BODY_TEXT_ITALIC:
          IN_BODY_TEXT = i.width + i.transform[4] > LINE_END;
          if (blockBreak) {
            flush("BLOCK_BREAK");
          }
          previousPos = i.transform[5]
          if (currentBlock && (currentBlock.type === _PARAGRAPH || currentBlock.type === _LIST_ITEM)) {
            if (IN_ITALICS) {
              handleLineBreak(lineBreak);
              currentBlock.text += i.str;
            } else {
              const sep = (/["“‘]$/i).test(currentBlock.text.trim()) ? "_" : " _";
              currentBlock.text = currentBlock.text.trim() + sep + i.str;
              IN_ITALICS = true;
            }
          } else {
            flush(type);
            currentBlock = new Block(_PARAGRAPH, "_" + i.str);
            IN_ITALICS = true
          }
          break;
        case _FOOTNOTE_INDEX:
          previousPos = i.transform[5]
          flushFootnote(type);
          currentFootnoteBlock = new Block(_FOOTNOTE, "[^" + i.str.trim() + "]:");
          currentFootnoteBlock.number = i.str.trim();
          break;
        case _FOOTNOTE_CONTENT:
          previousPos = i.transform[5];
          if (currentFootnoteBlock) {
            handleLineBreak(lineBreak);
            currentFootnoteBlock.text += i.str;
          }
          break;
        case _FOOTNOTE:
          currentBlock.footnotes = currentBlock.footnotes || [];
          currentBlock.footnotes.push(i.str);
          currentBlock.text = currentBlock.text.trim() + "[^" + i.str + "]";
          break;
      }
      previous = type;
    });
  }
  flush("END");
  regularFontName = null;
  return { blocks, footnotes };
}

// Helper function to build hierarchical list ID
function buildListId(number) {
  const parts = number.split('.');
  const pathParts = [craConfig[""].slug]; // Start with root

  for (let i = 1; i <= parts.length; i++) {
    const partialSection = parts.slice(0, i).join('.');
    const config = craConfig[partialSection];
    pathParts.push(config.slug);
  }

  return pathParts.join('/');
}

function formatPageSource(pageStart, pageEnd) {
  const pageRange = pageStart === pageEnd
    ? pageStart
    : `${ pageStart }–${ pageEnd }`;
  return `“FAQs on the Cyber Resilience Act” p.${ pageRange } (PDF)`;
}

function buildTree(blocks, footnotes, createdAt, lastUpdatedAt) {
  const lists = [];
  const faqs = [];
  const category = "official";

  const paragraphs = blocks.filter(block => block.type === _PARAGRAPH);
  const disclaimer = paragraphs[2].text;

  // Create parent list for entire PDF
  const rootConfig = craConfig[""];
  const pdfParentList = {
    id: "official",
    type: LIST,
    title: rootConfig.title,
    pageTitle: rootConfig.title,
    icon: rootConfig.icon,
    description: "**Message from the European Commission**: _“" + paragraphs[1].text.trim() + "”_",
    permalink: `/faq/${rootConfig.slug}/`,
    children: [],
    parents: [],
    faqCount: 0,
    listCount: 0,
    countText: "",
    level: 0,
    showQuestionNumbers: true,
    createdAt,
    lastUpdatedAt,
    isNew: isNew(createdAt),
    recentlyUpdated: recentlyUpdated(createdAt, lastUpdatedAt)
  };

  lists.push(pdfParentList);

  // Collect all numbered titles and determine types
  const sections = blocks.map(block => {
      if (block.type !== _TITLE) return null;
      const match = block.text.match(/^(\d+(?:\.\d+)*)\s*(.*)$/);
      if (!match) return null;

      const number = match[1];
      const title = match[2].trim();
      const level = number.split('.').length;

      const section = {
        block,
        number,
        title,
        level,
        type: null // Will be determined
      };

      block.section = section;
      return section;
    })
    .filter(Boolean);

  // Determine types: leaf (FAQ) vs branch (list) based on whether there are deeper children
  sections.forEach((section, index) => {
    const hasDeepChildren = sections.slice(index + 1).some(nextSection =>
      nextSection.level > section.level &&
      nextSection.number.startsWith(section.number + '.')
    );

    section.type = hasDeepChildren ? LIST : FAQ;
  });

  // Second pass: build tree structure
  const itemStack = [pdfParentList]; // Start with PDF parent in stack
  let currentFaq = null;
  let currentContent = [];


  function finalizeCurrentFaq() {
    if (!currentFaq) return;

    // Set source with page numbering
    currentFaq.source = formatPageSource(currentFaq.pageStart, currentFaq.pageEnd);

    const parentList = itemStack[itemStack.length - 1];
    parentList.children.push(currentFaq);
    currentFaq.parents.push(parentList);
    faqs.push(currentFaq);
    currentFaq = null;
  }

  // Process all blocks
  blocks.forEach((block, blockIndex) => {
    if (block.type === _TITLE) {
      if (!block.section) return; // Skip non-numbered titles
      const section = block.section;
      const { text, pageStart } = section.block;

      // Finalize previous FAQ if exists
      finalizeCurrentFaq();

      // Adjust stack to current level (account for PDF parent at level 0)
      while (itemStack.length > section.level) {
        itemStack.pop();
      }

      if (section.type === LIST) {
        // Create list item
        const config = craConfig[section.number];
        const listId = buildListId(section.number);

        const newList = {
          id: listId,
          type: LIST,
          title: text,
          pageTitle: section.title,
          icon: config.icon,
          description: config.description,
          permalink: `/faq/${listId}/`,
          children: [],
          parents: [],
          faqCount: 0,
          listCount: 0,
          countText: "",
          level: section.level,
          showQuestionNumbers: true, // Official FAQs should show numbers in lists
          createdAt,
          lastUpdatedAt,
          isNew: isNew(createdAt),
          recentlyUpdated: recentlyUpdated(createdAt, lastUpdatedAt)
        };

        // Add to parent
        const parentList = itemStack[itemStack.length - 1];
        parentList.children.push(newList);
        newList.parents.push(parentList);
        lists.push(newList);
        itemStack.push(newList);
      } else {
        // Create FAQ item
        const faqNumber = section.number.replace(/\./g, '-');
        const faqId = `official/faq_${faqNumber}`;
        const faqPermalink = `/faq/${ faqId }/`;

        // Get FAQ config for related issues
        const currentFaqConfig = faqConfig[section.number];
        const relatedIssues = currentFaqConfig && currentFaqConfig.relatedIssues.join(', ') || "";
        currentFaq = {
          id: faqId,
          category,
          type: FAQ,
          status: "official",
          pageTitle: section.title,
          question: section.title, // Use title without number as default
          questionNumber: section.number,
          answer: "",
          parents: [],
          listed: true,
          permalink: faqPermalink,
          author: "European Union",
          license: "CC-BY 4.0",
          licenseUrl: "https://commission.europa.eu/legal-notice_en#copyright-notice",
          srcUrl: "https://ec.europa.eu/newsroom/dae/redirection/document/122331",
          source: null, // Will be set after page range is determined
          disclaimer: disclaimer, // Add disclaimer to all EU FAQs
          relatedIssues: parseRelatedIssues(relatedIssues),
          guidanceId: false,
          footnotes: [],
          pageStart,
          pageEnd: null, // Will be set when content is processed
          createdAt,
          lastUpdatedAt,
          isNew: isNew(createdAt),
          recentlyUpdated: recentlyUpdated(createdAt, lastUpdatedAt)
        };
      }
    } else if (block.type === _PARAGRAPH && currentFaq) {
      if (currentFaq.answer && !(/\n\n$/).test(currentFaq.answer)) {
        currentFaq.answer += "\n";
      }
      currentFaq.answer += block.text + "\n\n";
      if (block.footnotes) {
        currentFaq.footnotes.push(...block.footnotes);
      }
      currentFaq.pageEnd = block.pageEnd;
    } else if (block.type === _LIST_ITEM && currentFaq) {
      currentFaq.answer += block.text + "\n";
      if (block.footnotes) {
        currentFaq.footnotes.push(...block.footnotes);
      }
      currentFaq.pageEnd = block.pageEnd;
    }
  });

  // Finalize last FAQ if exists
  finalizeCurrentFaq();

  // Process footnotes for all FAQs
  faqs.forEach(faq => {
    if (faq.footnotes) {
      const footnoteTexts = faq.footnotes.map(footnoteNum => {
        const footnote = footnotes[footnoteNum];
        if (footnote) {
          return footnote.text;
        } else {
          throw new Error(`FAQ "${faq.question}" references footnote ${footnoteNum} but footnote content not found.`);
        }
      });

      if (footnoteTexts.length > 0) {
        faq.answer += "\n\n" + footnoteTexts.join("\n");
      }
    }
  });


  return { lists, faqs, rootList: pdfParentList };
}


// Export for use in other scripts
module.exports = { parsePDFFAQs };
