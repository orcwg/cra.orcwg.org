// ============================================================================
// JSON:API v1.1 Formatter Utility
// ============================================================================
// Transforms internal FAQ data into JSON:API v1.1 compliant format
// Spec: https://jsonapi.org/format/

const markdownIt = require("markdown-it");
const markdownItFootnote = require("markdown-it-footnote");

// Configure markdown-it with footnotes
// Note: GitHub alerts plugin is loaded asynchronously but since this is used
// during the build process (not at module load time), it will be available
const md = markdownIt({
  html: true,
  linkify: true,
  typographer: true
}).use(markdownItFootnote);

// Initialize GitHub alerts plugin asynchronously
(async () => {
  const { default: markdownItGitHubAlerts } = await import("markdown-it-github-alerts");
  md.use(markdownItGitHubAlerts);
})();

const LICENSE_INFO = {
  name: "CC-BY-4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
  spdx: "CC-BY-4.0"
};

const COPYRIGHT = "ORC WG Contributors";
const WEBSITE_BASE = "https://cra.orcwg.org";
const API_BASE = "/api/v0";

// ============================================================================
// Document-Level Helpers
// ============================================================================

/**
 * Create top-level JSON:API document structure
 */
function createDocument(data, links = {}, meta = {}) {
  const doc = {
    jsonapi: {
      version: "1.1"
    },
    data
  };

  if (Object.keys(links).length > 0) {
    doc.links = links;
  }

  const documentMeta = {
    generatedAt: new Date().toISOString(),
    website: WEBSITE_BASE,
    documentation: `${WEBSITE_BASE}/api/docs/`,
    license: LICENSE_INFO,
    copyright: COPYRIGHT,
    ...meta
  };

  doc.meta = documentMeta;

  return doc;
}

// ============================================================================
// Resource Object Formatters
// ============================================================================

/**
 * Format FAQ as JSON:API resource object
 */
function formatFaqResource(faq) {
  const resource = {
    type: "faq",
    id: faq.id,
    attributes: {
      question: faq.question,
      answer: faq.answer,
      answerHtml: md.render(faq.answer || ""),
      status: faq.status,
      createdAt: faq.createdAt.toISOString(),
      lastUpdatedAt: faq.lastUpdatedAt.toISOString(),
      isNew: faq.isNew,
      recentlyUpdated: faq.recentlyUpdated,
      needsRefactoring: faq.needsRefactoring,
      answerMissing: faq.answerMissing
    },
    links: {
      self: `${API_BASE}/faqs/${faq.id}.json`,
      html: faq.permalink,
      edit: faq.editOnGithubUrl
    },
    meta: {
      license: LICENSE_INFO,
      copyright: COPYRIGHT,
      source: {
        repository: "https://github.com/orcwg/cra-hub",
        path: faq.posixPath,
        editUrl: faq.editOnGithubUrl
      }
    }
  };

  // Add relationships
  const relationships = {};

  // Parent lists relationship - expose all lists that include this FAQ
  if (faq.parents && faq.parents.length > 0) {
    relationships.lists = {
      links: {
        self: `${API_BASE}/faqs/${faq.id}/relationships/lists`
      },
      data: faq.parents.map(list => ({ type: "list", id: list.id }))
    };
  }
  // Related issues relationship
  if (faq.relatedIssues && faq.relatedIssues.length > 0) {
    relationships.relatedIssues = {
      data: faq.relatedIssues.map(issue => ({
        type: "github-issue",
        id: issue.number,
        meta: { url: issue.url }
      }))
    };
  }

  // Guidance request relationship
  if (faq.guidanceId) {
    const guidanceSlug = faq.guidanceId.replace('pending-guidance/', '');
    relationships.guidanceRequest = {
      links: {
        related: `${API_BASE}/guidance/${guidanceSlug}.json`
      },
      data: { type: "guidance-request", id: faq.guidanceId }
    };
  }

  if (Object.keys(relationships).length > 0) {
    resource.relationships = relationships;
  }

  return resource;
}

/**
 * Format list as JSON:API resource object
 */
function formatListResource(list) {
  const resource = {
    type: "list",
    id: list.id,
    attributes: {
      title: list.title,
      description: list.description,
      icon: list.icon,
      faqCount: list.faqCount,
      listCount: list.listCount,
      countText: list.countText,
      createdAt: list.createdAt.toISOString(),
      lastUpdatedAt: list.lastUpdatedAt.toISOString(),
      isNew: list.isNew,
      recentlyUpdated: list.recentlyUpdated
    },
    links: {
      self: `${API_BASE}/lists/${list.id}.json`,
      html: list.permalink
    },
    meta: {
      license: LICENSE_INFO,
      copyright: COPYRIGHT,
      source: {
        repository: "https://github.com/orcwg/cra-hub",
        path: list.posixPath
      }
    }
  };

  // Add relationships
  const relationships = {};

  // Child FAQs
  const childFaqs = list.children ? list.children.filter(child => child.type === 'faq') : [];
  if (childFaqs.length > 0) {
    relationships.faqs = {
      links: {
        self: `${API_BASE}/lists/${list.id}/relationships/faqs`,
        related: `${API_BASE}/lists/${list.id}.json`
      },
      data: childFaqs.map(faq => ({ type: "faq", id: faq.id }))
    };
  }

  // Sublists
  const sublists = list.children ? list.children.filter(child => child.type === 'list') : [];
  if (sublists.length > 0) {
    relationships.sublists = {
      data: sublists.map(sublist => ({ type: "list", id: sublist.id }))
    };
  }

  // Parent lists
  if (list.parents && list.parents.length > 0) {
    relationships.parentLists = {
      data: list.parents.map(parent => ({ type: "list", id: parent.id }))
    };
  }

  if (Object.keys(relationships).length > 0) {
    resource.relationships = relationships;
  }

  return resource;
}

/**
 * Format guidance request as JSON:API resource object
 */
function formatGuidanceResource(guidance) {
  const resource = {
    type: "guidance-request",
    id: guidance.id,
    attributes: {
      title: guidance.title,
      body: guidance.body,
      bodyHtml: md.render(guidance.body || ""),
      guidanceText: guidance.guidanceText,
      status: guidance.status,
      createdAt: guidance.createdAt.toISOString(),
      lastUpdatedAt: guidance.lastUpdatedAt.toISOString(),
      isNew: guidance.isNew,
      recentlyUpdated: guidance.recentlyUpdated
    },
    links: {
      self: `${API_BASE}/guidance/${guidance.id.replace('pending-guidance/', '')}.json`,
      html: guidance.permalink,
      edit: guidance.editOnGithubUrl
    },
    meta: {
      license: LICENSE_INFO,
      copyright: COPYRIGHT,
      source: {
        repository: "https://github.com/orcwg/cra-hub",
        path: guidance.posixPath,
        editUrl: guidance.editOnGithubUrl
      }
    }
  };

  // Add relationships
  const relationships = {};

  // Related FAQs
  if (guidance.relatedFaqs && guidance.relatedFaqs.length > 0) {
    relationships.relatedFaqs = {
      data: guidance.relatedFaqs.map(faq => ({ type: "faq", id: faq.id }))
    };
  }

  if (Object.keys(relationships).length > 0) {
    resource.relationships = relationships;
  }

  return resource;
}

// ============================================================================
// Collection Formatters
// ============================================================================

/**
 * Format collection of FAQs
 */
function formatFaqCollection(faqs, selfLink) {
  const data = faqs.map(formatFaqResource);
  const links = {
    self: selfLink
  };
  const meta = {
    count: faqs.length
  };

  return createDocument(data, links, meta);
}

/**
 * Format collection of lists
 */
function formatListCollection(lists, selfLink) {
  const data = lists.map(formatListResource);
  const links = {
    self: selfLink
  };
  const meta = {
    count: lists.length
  };

  return createDocument(data, links, meta);
}

/**
 * Format collection of guidance requests
 */
function formatGuidanceCollection(guidanceRequests, selfLink) {
  const data = guidanceRequests.map(formatGuidanceResource);
  const links = {
    self: selfLink
  };
  const meta = {
    count: guidanceRequests.length
  };

  return createDocument(data, links, meta);
}

// ============================================================================
// Single Resource Document Formatters
// ============================================================================

/**
 * Format single FAQ document
 */
function formatFaqDocument(faq) {
  const data = formatFaqResource(faq);
  const links = {
    self: `${API_BASE}/faqs/${faq.id}.json`
  };

  return createDocument(data, links);
}

/**
 * Format single list document
 */
function formatListDocument(list) {
  const data = formatListResource(list);
  const links = {
    self: `${API_BASE}/lists/${list.id}.json`
  };

  return createDocument(data, links);
}

/**
 * Format single guidance document
 */
function formatGuidanceDocument(guidance) {
  const data = formatGuidanceResource(guidance);
  const links = {
    self: `${API_BASE}/guidance/${guidance.id.replace('pending-guidance/', '')}.json`
  };

  return createDocument(data, links);
}

// ============================================================================
// API Index Formatter
// ============================================================================

/**
 * Create API discovery/index document
 */
function formatApiIndex(stats) {
  const data = {
    type: "api-index",
    id: "v0",
    attributes: {
      version: "1.1",
      apiVersion: "v0",
      description: "JSON:API v1.1 endpoints for CRA FAQ content (v0 - unstable, may change)"
    },
    links: {
      self: `${API_BASE}/index.json`,
      documentation: `${WEBSITE_BASE}/api/docs/`,
      website: WEBSITE_BASE,
      faqs: `${API_BASE}/faqs.json`,
      lists: `${API_BASE}/lists.json`,
      guidance: `${API_BASE}/guidance.json`
    }
  };

  const meta = {
    statistics: stats
  };

  return createDocument(data, { self: `${API_BASE}/index.json` }, meta);
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  formatFaqDocument,
  formatListDocument,
  formatGuidanceDocument,
  formatFaqCollection,
  formatListCollection,
  formatGuidanceCollection,
  formatApiIndex,
  LICENSE_INFO,
  COPYRIGHT,
  API_BASE
};
