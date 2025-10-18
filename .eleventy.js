module.exports = async function (eleventyConfig) {
  // Copy asset files to output
  eleventyConfig.addPassthroughCopy("src/assets");

  // Import ES modules dynamically
  const markdownIt = require("markdown-it");
  const { default: markdownItGitHubAlerts } = await import("markdown-it-github-alerts");

  // Configure markdown-it with GitHub alerts plugin
  const md = markdownIt({
    html: true,
    linkify: true,
    typographer: true
  }).use(markdownItGitHubAlerts);

  // Add markdown filter
  eleventyConfig.addFilter("markdown", function (content) {
    return md.render(content || "");
  });

  // Add inline markdown filter (no paragraph wrapping)
  eleventyConfig.addFilter("markdownInline", function (content) {
    return md.renderInline(content || "");
  });

  return {
    dir: {
      input: "src",
      output: "_site"
    }
  };
};
