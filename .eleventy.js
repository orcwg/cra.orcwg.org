module.exports = async function (eleventyConfig) {
  // Copy asset files to output
  eleventyConfig.addPassthroughCopy("src/assets");

  // Import ES modules dynamically
  const markdownIt = require("markdown-it");
  const { default: markdownItGitHubAlerts } = await import("markdown-it-github-alerts");

  // Plugin to add internal links to markdown-it's reference system
  function markdownItInternalLinks(md) {
    md.core.ruler.after('block', 'add_internal_references', function(state) {
      const internalLinks = state.env?.internalLinks;
      if (!internalLinks) return;

      state.env.references = state.env.references || {};

      // Add internal links to references
      Object.entries(internalLinks).forEach(([key, linkData]) => {
        state.env.references[md.utils.normalizeReference(key)] = {
          href: linkData.permalink,
          title: `${linkData.type}: ${linkData.title}`
        };
      });

      // Wrap references in proxy to handle CRA legal references and missing links
      state.env.references = new Proxy(state.env.references, {
        get(target, prop) {
          const craRefs = state.env.craReferences || {};
          const baseUrl = 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L_202402847';

          const createRef = (fragment, title) => {
            const ref = { href: `${baseUrl}#${fragment}`, title };
            target[prop] = ref;
            return ref;
          };

          // Check for CRA legal references
          const patterns = [
            [/^(ARTICLE|ART\.?)\s+(\d+)[^\]]*$/i, (m) => {
              const num = m[2];
              const title = craRefs.articleTitles[num] || "Unknown title";
              return [`art_${num}`, `CRA Article ${num}: ${title}`];
            }],
            [/^ANNEX\s+([IVX]+)[^\]]*$/i, (m) => {
              const num = m[1].toUpperCase();
              const title = craRefs.annexTitles[num] || "Unknown title";
              return [`anx_${num}`, `CRA Annex ${num}: ${title}`];
            }],
            [/^(RECITAL|REC\.?)\s+(\d+)$/i, (m) => {
              const num = m[2];
              return [`rct_${num}`, `CRA Recital ${num}`];
            }]
          ];

          for (const [regex, handler] of patterns) {
            const match = prop.match(regex);
            if (match) {
              const [fragment, title] = handler(match);
              return createRef(fragment, title);
            }
          }

          return target[prop];
        }
      });
    });
  }

  // Configure markdown-it with GitHub alerts plugin and internal links
  const md = markdownIt({
    html: true,
    linkify: true,
    typographer: true
  }).use(markdownItGitHubAlerts).use(markdownItInternalLinks);

  // Add markdown filter
  eleventyConfig.addFilter("markdown", function (content) {
    if (!content) return "";

    // Pass internal links and CRA references to markdown parser environment
    const env = {
      internalLinks: this.ctx.data.internalLinks,
      craReferences: this.ctx.data.craReferences
    };

    return md.render(content, env);
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
