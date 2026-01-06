/**
 * API Formatter - Transforms content into API-friendly format
 *
 * Each API page object contains:
 * - endpoint: URL path to the JSON endpoint (e.g., /api/v0/faqs/category/slug.json)
 * - content: { links, data } object for JSON output
 */

const API_BASE_URL = "https://cra.orcwg.org";
const API_VERSION = "v0";

// Fields that should be used to build API links (extracted and not included in data)
// See https://www.iana.org/assignments/link-relations/link-relations.xhtml
const LINK_FIELDS = {
  srcUrl: "via",
  licenseUrl: "license",
  authorUrl: "author",
  editOnGithubUrl: "edit"
};

// Fields that reference other content items
const RELATION_FIELDS = ["parents", "children", "relatedFaqs", "relatedGuidanceRequest", "relatedIssues"];

/**
 * Convert a single item to an API reference
 */
function toApiReference(item) {
  return {
    id: item.id,
    type: item.type,
    url: `${API_BASE_URL}/api/${API_VERSION}/${item.type}s/${item.id}.json`
  };
}

/**
 * Convert item to collection list format
 * Shows: type, id, title/question, url
 */
function toCollectionItem(item) {
  const result = {
    type: item.type,
    id: item.id,
    url: `${API_BASE_URL}/api/${API_VERSION}/${item.type}s/${item.id}.json`
  };

  // Add title/question with proper key name based on type
  if (item.type === 'faq') {
    result.question = item.question;
  } else {
    result.title = item.title;
  }

  return result;
}

/**
 * Transform a relation field (array or single) into API references
 */
function serializeRelation(value) {
  return Array.isArray(value) ? value.map(toApiReference) : toApiReference(value);
}

/**
 * Serialize an item for API output, filtering and transforming fields
 */
function serializeItem(item) {
  const serialized = {};

  for (const [key, value] of Object.entries(item)) {
    // Skip undefined and internal fields
    if (key.startsWith('_')) {
      continue;
    }

    // Skip link fields (they're used to build the links section instead)
    if (key in LINK_FIELDS) {
      continue;
    }

    // Handle relation fields (parents, children, etc.)
    if (RELATION_FIELDS.includes(key)) {
      serialized[key] = serializeRelation(value);
      continue;
    }

    // Handle GitHub issue references
    if (key === 'relatedIssues') {
      serialized[key] = serializeRelatedIssues(value);
      continue;
    }

    // Include all other scalar values
    serialized[key] = value;
  }

  return serialized;
}

/**
 * Build the links section of an API response
 */
function buildLinks(item, collectionName) {
  const links = {
    self: `${API_BASE_URL}/api/${API_VERSION}/${collectionName}/${item.id}.json`,
    html: `${API_BASE_URL}/${item.permalink}`,
    collection: `${API_BASE_URL}/api/${API_VERSION}/${collectionName}.json`
  };

  // Add optional links if they exist on the item
  for (const [fieldName, linkName] of Object.entries(LINK_FIELDS)) {
    if (item[fieldName]) {
      links[linkName] = item[fieldName];
    }
  }

  return links;
}

/**
 * Create an API page object for a single item
 */
function createApiPage(item, collectionName) {
  return {
    endpoint: `/api/${API_VERSION}/${collectionName}/${item.id}.json`,
    payload: {
      links: buildLinks(item, collectionName),
      data: serializeItem(item)
    }
  };
}

/**
 * Transform content collections into API pages
 *
 * @param {Object} dataSources - { collectionName: items[] }
 * @returns {Array} API page objects
 */
function createApiArray(dataSources) {
  const apiPages = [];

  // create individual item endpoints
  for (const [collectionName, items] of Object.entries(dataSources)) {
    const pages = items.map(item => createApiPage(item, collectionName));
    apiPages.push(...pages);
  }

  // create collection endpoints
  for (const collectionName of Object.keys(dataSources)) {
    const collectionItems = dataSources[collectionName];
    apiPages.push({
      endpoint: `/api/${API_VERSION}/${collectionName}.json`,
      payload: {
        links: {
          self: `${API_BASE_URL}/api/${API_VERSION}/${collectionName}.json`
        },
        data: {
          items: collectionItems.map(item => toCollectionItem(item))
        }
      }
    });
  }

  // Create root API endpoint
  const rootLinks = {};
  const selfLink = `${API_BASE_URL}/api/${API_VERSION}/index.json`;
  rootLinks['self'] = selfLink;
  for (const collectionName of Object.keys(dataSources)) {
    rootLinks[collectionName] = `${API_BASE_URL}/api/${API_VERSION}/${collectionName}.json`;
  }
  apiPages.push({
    endpoint: `/api/${API_VERSION}/index.json`,
    payload: {
      links: rootLinks,
      data: {}
    }
  });

  return apiPages;
}

module.exports = { createApiArray };
