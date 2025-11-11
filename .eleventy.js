module.exports = async function (eleventyConfig) {
  // Copy asset files to output
  eleventyConfig.addPassthroughCopy("src/assets");

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
  }).use(markdownItGitHubAlerts).use(markdownItFootnote);

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
    };
  });

  return {
    dir: {
      input: "src",
      output: "_site"
    }
  };
};
