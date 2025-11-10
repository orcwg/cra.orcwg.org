module.exports = async function (eleventyConfig) {
  // Copy asset files to output
  eleventyConfig.addPassthroughCopy("src/assets");

  // Import ES modules dynamically
  const markdownIt = require("markdown-it");
  
  const { default: markdownItGitHubAlerts } = await import("markdown-it-github-alerts");
  
  // Footnote plugin for markdown-it
  const markdownItFootnote = require("markdown-it-footnote");
  
  // Plugin to add internal links to markdown-it's reference system
  function markdownItInternalLinks(md) {
    // Preprocessing rule to convert [[Article X]] syntax to markdown links
    md.core.ruler.before('normalize', 'convert_cra_autolinks', function(state) {
      const craRefs = state.env?.craReferences || {};
      const internalLinks = state.env?.internalLinks || {};
      const baseUrl = 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L_202402847';
      
      function mdLink(text, url, title) {
        title = title ? ` "${ title.replace(/"/g, '&quot;') }"` : "";
        return `[${ text }](${ url }${ title })`;
      }

      const patterns = [
        // Internal FAQ references [[category/filename]]
        [/\[\[([a-z0-9-]+\/[a-z0-9-]+)\]\]/gi, (match, faqId) => {
          const faq = internalLinks[faqId];
          if (faq) {
            return mdLink(faq.pageTitle, faq.permalink, `💬 FAQ: ${ faq.pageTitle }`);
          }
          return match; // Return unchanged if no match found
        }],
        // Category list references [[category]]
        [/\[\[([a-z0-9-]+)\]\]/gi, (match, categoryName) => {
          const listId = `lists/${ categoryName }`;
          const list = internalLinks[listId];
          if (list) {
            const icon = list.icon ? `${ list.icon } ` : '';
            const linkText = `${ icon }${ list.title } FAQ list`;
            return mdLink(linkText, list.permalink, `${ linkText } - ${ list.description }`);
          }
          return match; // Return unchanged if no match found
        }],
        // CRA Article references [[Article 17(3)]]
        [/\[\[(ARTICLE|ART\.)\s+(\d+)(\([^)]*\))?\]\]/gi, (match, type, num, subsection) => {
          const displayText = `Article ${ num }${ subsection || '' }`;
          const title = craRefs.articleTitles[num] || "Unknown article";
          return mdLink(displayText, `${ baseUrl }#art_${ num }`, `⚖️ Article ${ num } - ${ title }`);
        }],
        // CRA Annex references [[Annex I]]
        [/\[\[ANNEX\s+([IVX]+)\]\]/gi, (match, num) => {
          num = num.toUpperCase();
          const title = craRefs.annexTitles[num] || "Unknown annex";
          return mdLink(`Annex ${ num }`, `${ baseUrl }#anx_${ num }`, `⚖️ Annex ${ num } - ${ title }`);
        }],
        // CRA Recital references [[Recital 42]]
        [/\[\[(RECITAL|REC\.)\s+(\d+)\]\]/gi, (match, type, num) => {
          return mdLink(`Recital ${ num }`, `${ baseUrl }#rct_${ num }`, `⚖️ Recital ${ num }`);
        }]
      ];

      // Apply all patterns to the source text
      patterns.forEach(([regex, replacer]) => {
        state.src = state.src.replace(regex, replacer);
      });
    });

    md.core.ruler.after('inline', 'convert_relative_md_links', function(state) {
      const internalLinks = state.env?.internalLinks || {};
      const currentContext = state.env?.currentContext;

      if (!currentContext || !currentContext.category) return;

      // Find and convert relative .md links in parsed tokens
      function processTokens(tokens) {
        tokens.forEach(token => {
          if (token.type === 'link_open') {
            const hrefIndex = token.attrIndex('href');
            if (hrefIndex >= 0) {
              const href = token.attrGet('href');

              // Check for relative paths ending in .md or README.yml
              if (href.match(/^\.\.?\/.*\.(md|yml)$/i)) {
                // Normalize the path relative to current category
                const path = require('path');
                const currentPath = `faq/${ currentContext.category }`;
                const resolvedPath = path.posix.resolve('/', currentPath, href);

                // Extract category and filename from resolved path
                const pathMatch = resolvedPath.match(/^\/faq\/([^/]+)\/(.+)\.(md|yml)$/);
                if (pathMatch) {
                  const [, targetCategory, filename, extension] = pathMatch;

                  let targetId;
                  if (extension === 'md') {
                    targetId = `${ targetCategory }/${ filename }`;
                  } else if (extension === 'yml' && filename === 'README') {
                    targetId = `lists/${ targetCategory }`;
                  }

                  if (targetId) {
                    const item = internalLinks[targetId];
                    if (item) {
                      token.attrSet('href', item.permalink);
                      if (item.pageTitle) {
                        // FAQ object
                        token.attrSet('title', `💬 FAQ: ${ item.pageTitle }`);
                      } else if (item.title) {
                        // List object
                        token.attrSet('title', `💬 FAQ list: ${ item.title }`);
                      }
                    }
                  }
                }
              }
            }
          }

          if (token.children) {
            processTokens(token.children);
          }
        });
      }

      processTokens(state.tokens);
    });
  }

  // Configure markdown-it with GitHub alerts plugin and internal links
  const md = markdownIt({
    html: true,
    linkify: true,
    typographer: true
  }).use(markdownItGitHubAlerts).use(markdownItInternalLinks).use(markdownItFootnote);

  // Add markdown filter
  eleventyConfig.addFilter("markdown", function (content, context = null) {
    if (!content) return "";

    // Pass internal links, CRA references, and context to markdown parser environment
    const env = {
      internalLinks: this.ctx.data.internalLinks,
      craReferences: this.ctx.craReferences,
      currentContext: context
    };

    return  md.render(content, env);
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
