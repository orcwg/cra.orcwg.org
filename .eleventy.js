module.exports = async function (eleventyConfig) {
  // Copy asset files to output
  eleventyConfig.addPassthroughCopy("src/assets");

  // Copy API schema files to output
  eleventyConfig.addPassthroughCopy("src/api/schemas");

  // Import ES modules dynamically
  const markdownIt = require("markdown-it");
  
  const { default: markdownItGitHubAlerts } = await import("markdown-it-github-alerts");
  
  // Footnote plugin for markdown-it
  const markdownItFootnote = require("markdown-it-footnote");
  
  // Configure markdown-it with GitHub alerts and footnotes
  // Note: Link resolution now happens in the data layer (src/_data/data.js)
  // before markdown rendering, so no custom link plugin is needed here
  const md = markdownIt({
    html: true,
    linkify: true,
    typographer: true
  }).use(markdownItGitHubAlerts, { 
    markers: ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION", "ORC_REC"],
    titles: { "orc_rec": "ORC WG Recommendation" }
  }).use(markdownItFootnote);

  // Add markdown filter
  // Note: Link resolution now happens in data layer, so content already has resolved links
  eleventyConfig.addFilter("markdown", function (content) {
    if (!content) return "";
    return md.render(content);
  });

  // Add inline markdown filter (no paragraph wrapping)
  eleventyConfig.addFilter("markdownInline", function (content) {
    return md.renderInline(content || "");
  });

  // Add JSON API formatter filters
  const apiFormatter = require("./src/_data/utils/api-formatter.js");
  eleventyConfig.addFilter("formatFaqDocument", (faq) => JSON.stringify(apiFormatter.formatFaqDocument(faq), null, 2));
  eleventyConfig.addFilter("formatListDocument", (list) => JSON.stringify(apiFormatter.formatListDocument(list), null, 2));
  eleventyConfig.addFilter("formatGuidanceDocument", (guidance) => JSON.stringify(apiFormatter.formatGuidanceDocument(guidance), null, 2));
  eleventyConfig.addFilter("formatFaqCollection", (faqs, selfLink) => JSON.stringify(apiFormatter.formatFaqCollection(faqs, selfLink), null, 2));
  eleventyConfig.addFilter("formatListCollection", (lists, selfLink) => JSON.stringify(apiFormatter.formatListCollection(lists, selfLink), null, 2));
  eleventyConfig.addFilter("formatGuidanceCollection", (guidance, selfLink) => JSON.stringify(apiFormatter.formatGuidanceCollection(guidance, selfLink), null, 2));
  eleventyConfig.addFilter("formatApiIndex", (stats) => JSON.stringify(apiFormatter.formatApiIndex(stats), null, 2));

  // Add build timestamp in website footer
  eleventyConfig.addGlobalData("build", () => {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
      timeZoneName: "short",
    });

    return {
      formatted: formatter.format(now),
      iso: now.toISOString(),
      timestamp: now.getTime()
    };
  });

  return {
    dir: {
      input: "src",
      output: "_site"
    },
    // Enable strict mode for Nunjucks templates
    // This makes templates fail when accessing undefined variables
    nunjucksEnvironmentOptions: {
      throwOnUndefined: true
    }
  };
};
