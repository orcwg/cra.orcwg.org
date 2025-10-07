---
layout: layout.njk
title: Test Styling Page
permalink: "{% if env.BUILD_ENV == 'production' %}false{% else %}/test-styling/{% endif %}"
eleventyExcludeFromCollections: "{% if env.BUILD_ENV == 'production' %}true{% else %}false{% endif %}"
---

# Test Styling Page

This page demonstrates all the different styling elements used throughout the site.

---

## FAQ-Style Q&A Block

<article class="faq-main-content">
  <h1>What is this test page for?</h1>

  <p>This test page demonstrates all the different callout types, blockquotes, and other styling elements used in the CRA FAQ site. It helps us design and refine the visual appearance of different components.</p>

  <h2>Regular Blockquote</h2>

  <blockquote>
    <p>This is a regular blockquote. It should be styled differently from the FAQ card's blue accent. It can span multiple lines and contain various text.</p>
  </blockquote>

  <h2>GitHub Alert Callouts</h2>

  <blockquote class="markdown-alert markdown-alert-note">
    <p><strong>Note</strong><br>
    This is a NOTE callout. Useful for highlighting important information that users should be aware of.</p>
  </blockquote>

  <blockquote class="markdown-alert markdown-alert-tip">
    <p><strong>Tip</strong><br>
    This is a TIP callout. Great for providing helpful suggestions or best practices.</p>
  </blockquote>

  <blockquote class="markdown-alert markdown-alert-important">
    <p><strong>Important</strong><br>
    This is an IMPORTANT callout. Use this to draw attention to critical information.</p>
  </blockquote>

  <blockquote class="markdown-alert markdown-alert-warning">
    <p><strong>Warning</strong><br>
    This is a WARNING callout. Alerts users to potential issues or things to watch out for.</p>
  </blockquote>

  <blockquote class="markdown-alert markdown-alert-caution">
    <p><strong>Caution</strong><br>
    This is a CAUTION callout. Indicates something that could cause problems if not handled carefully.</p>
  </blockquote>

  <h2>Code Examples</h2>

  <p>Inline code: <code>const example = "test";</code></p>

  <pre><code>// Code block example
function testFunction() {
  return "This is a test";
}</code></pre>

  <h2>Lists</h2>

  <p>Here's an unordered list:</p>

  <ul>
    <li>First item with some text</li>
    <li>Second item with _emphasis_</li>
    <li>Third item with **bold text**</li>
  </ul>

  <p>And an ordered list:</p>

  <ol>
    <li>First step</li>
    <li>Second step</li>
    <li>Third step</li>
  </ol>

  <aside class="faq-warnings">
    <div class="faq-warning">
      <p><strong>This is a draft warning</strong> - This is how warnings appear at the bottom of FAQ answers.</p>
    </div>
  </aside>
</article>

---

## FAQ List Block (Category Section)

<div class="faq-index">
  <section class="category-section">
    <h2 class="category-title">Test Category</h2>
    <ul class="question-list">
      <li class="question-item">
        <a href="#" class="question-link">
          <span class="question-text">
            <p>What is the first test question?</p>
          </span>
        </a>
      </li>
      <li class="question-item">
        <a href="#" class="question-link">
          <span class="question-text">
            <p>What is the second test question?</p>
          </span>
        </a>
      </li>
      <li class="question-item">
        <a href="#" class="question-link">
          <span class="question-text">
            <p>What is the third test question?</p>
          </span>
        </a>
      </li>
    </ul>
  </section>
</div>

---

## Callouts in Regular Content (Outside FAQ Box)

Here's some regular text followed by callouts:

> [!NOTE]
> This is a NOTE callout outside of a FAQ box. It should still look good and be distinct from the page structure.

> [!IMPORTANT]
> This is an IMPORTANT callout with multiple paragraphs.
>
> It can contain **bold text**, *italic text*, and `inline code`.
>
> And links like [this one](#).

Regular paragraph after the callout.

> "This is a regular blockquote quote. It should look like a traditional quotation." - Test Author

---

## Typography Examples

### Headings

# Heading 1
## Heading 2
### Heading 3

### Lists

**Unordered List:**
- First item
- Second item
  - Nested item
  - Another nested item
- Third item

**Ordered List:**
1. First step
2. Second step
3. Third step

### Links and Text Styles

This is a paragraph with a [link](#), **bold text**, *italic text*, and `inline code`.

---

## Mixed Layout Test

<article class="faq-main-content">
  <h1>How do callouts look inside FAQ answers?</h1>

  <p>Here's a regular paragraph introducing the concept.</p>

  <blockquote class="markdown-alert markdown-alert-note">
    <p><strong>Note</strong><br>
    This NOTE appears within a FAQ answer. The styling should work well with the FAQ structure.</p>
  </blockquote>

  <p>Another paragraph between callouts.</p>

  <blockquote class="markdown-alert markdown-alert-warning">
    <p><strong>Warning</strong><br>
    This WARNING also appears within the FAQ answer. It should be visually distinct but harmonious.</p>
  </blockquote>

  <blockquote>
    <p>And here's a regular blockquote for comparison within the FAQ answer.</p>
  </blockquote>
</article>

---

## Guidance Page Example

<article class="faq-main-content faq-main-content--guidance">
  <h1>Example Guidance Request</h1>

  <h2>Guidance needed</h2>

  <p>Confirmation that the example guidance system works correctly with the new CSS structure.</p>

  <h2>Why this matters</h2>

  <p>This distinction is crucial for determining:</p>

  <ul>
    <li>Whether the warm color theme applies correctly</li>
    <li>Whether heading hierarchy is maintained</li>
    <li>Whether list bullets render inside the content area</li>
  </ul>

  <h2>Related FAQs</h2>

  <div class="related-faqs-inline">
    <ul>
      <li><a href="#">Example related FAQ with <em>italics</em></a></li>
      <li><a href="#">Another related FAQ with <strong>bold text</strong></a></li>
    </ul>
  </div>
</article>

<aside class="faq-warnings faq-warnings--guidance">
  <div class="faq-warning faq-guidance">
    <p><strong>Pending Guidance from EU Commission</strong></p>
    <p>This topic requires additional clarification from the European Commission. Guidance has been formally requested and is awaiting response.</p>
  </div>
</aside>
