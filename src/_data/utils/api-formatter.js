// ============================================================================
// JSON:API Serializer
// ============================================================================
// Converts data pipeline output to JSON:API v1.1 format
// Resources are expected to have: type, id, and standard content fields
// Fields prefixed with _ are internal application state and excluded from API output

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Check if a value is a resource reference (object with type/id)
 */
function isResourceRef(value) {
  return value !== null && typeof value === 'object' && value.type !== undefined && value.id !== undefined;
}

/**
 * Format relationship reference (type + id only)
 */
function formatRelationshipRef(item) {
  return {type: item.type, id: item.id};
}

/**
 * Check if a value is a plain scalar or simple array (no nested objects except resource refs)
 */
function isSimpleValue(value) {
  if (value === null || value === undefined) return false;
  const type = typeof value;
  // Scalars: string, number, boolean
  if (type === 'string' || type === 'number' || type === 'boolean') return true;
  // Arrays of scalars
  if (Array.isArray(value)) {
    return value.every(item => typeof item !== 'object' || isResourceRef(item));
  }
  return false;
}

/**
 * Map resource type to collection name
 */
function getCollectionName(resourceType) {
  const typeMap = {
    'faq': 'faqs',
    'list': 'lists',
    'guidance-request': 'guidance-requests'
  };
  return typeMap[resourceType] || resourceType;
}

/**
 * Build links for a relationship's related resources
 */
function buildRelationshipLinks(resourceType, resourceIds, apiBase, domain) {
  const links = {};
  const collectionName = getCollectionName(resourceType);

  if (Array.isArray(resourceIds)) {
    // For to-many relationships, create links for each related resource
    links.related = resourceIds.map(id =>
      `${domain}${apiBase}/${collectionName}/${id}.json`
    );
  } else {
    // For to-one relationships, create a single link
    links.related = `${domain}${apiBase}/${collectionName}/${resourceIds}.json`;
  }

  return links;
}

/**
 * Automatically extract attributes and relationships from an object.
 * Attributes: simple scalars, arrays of scalars, and arrays of resource references
 * Relationships: objects with type+id (resource references)
 * Skip internal fields (prefixed with _), top-level type/id, fields handled in links/meta.
 */
function extractAttributesAndRelationships(obj, apiBase, domain) {
  const attributes = {};
  const relationships = {};

  // Fields that belong in meta, not attributes
  const metaFields = new Set([
    'license', 'licenseUrl', 'author', 'authorUrl', 'srcUrl',
    'createdAt', 'lastUpdatedAt', 'status', 'disclaimer', 'disclaimerHtml',
    'source'
  ]);

  for (const [key, value] of Object.entries(obj)) {
    // Skip internal/API-specific fields (prefixed with _)
    if (key.startsWith("_")) continue;
    // Skip top-level type and id (handled at resource level)
    if (key === 'type' || key === 'id') continue;
    // Skip fields handled in links object
    if (key === 'permalink') continue;
    // Skip fields handled in meta object
    if (metaFields.has(key)) continue;
    // Skip undefined
    if (value === undefined) continue;

    // Check if it's a resource reference (or array of)
    if (isResourceRef(value)) {
      const relationshipObj = {data: formatRelationshipRef(value)};
      relationshipObj.links = buildRelationshipLinks(value.type, value.id, apiBase, domain);
      relationships[key] = relationshipObj;
    } else if (Array.isArray(value) && value.length > 0 && isResourceRef(value[0])) {
      const relationshipObj = {data: value.map(formatRelationshipRef)};
      relationshipObj.links = buildRelationshipLinks(value[0].type, value.map(v => v.id), apiBase, domain);
      relationships[key] = relationshipObj;
    } else if (isSimpleValue(value)) {
      // It's a simple scalar or array of scalars
      attributes[key] = value;
    }
    // Skip complex nested objects
  }

  return {attributes, relationships};
}

// ============================================================================
// Document Wrapper
// ============================================================================

function createDocument(data, links = {}, meta = {}, apiMetadata = {}) {
  const doc = {
    jsonapi: {version: 1.1},
    data
  };

  if (Object.keys(links).length > 0) {
    doc.links = links;
  }

  doc.meta = {
    generatedAt: new Date().toISOString(),
    copyright: apiMetadata.copyright,
    ...meta
  };

  return doc;
}

// ============================================================================
// Resource Serializers
// ============================================================================

/**
 * Build links for a resource
 */
function buildResourceLinks(item, apiBase, collectionName, domain) {
  const links = {
    self: `${domain}${apiBase}/${collectionName}/${item.id}.json`,
    ...(item.permalink && {html: `${domain}${item.permalink}`})
  };
  return links;
}

/**
 * Serialize a single resource into JSON:API format
 */
function serializeResource(item, apiBase, collectionName, domain) {
  const {attributes, relationships} = extractAttributesAndRelationships(item, apiBase, domain);

  const resource = {
    type: item.type,
    id: item.id,
    attributes,
    links: buildResourceLinks(item, apiBase, collectionName, domain)
  };

  if (Object.keys(relationships).length > 0) {
    resource.relationships = relationships;
  }

  // Add resource metadata (license, attribution, timestamps, status)
  const metaFields = [
    'author',
    'authorUrl',
    'srcUrl',
    'createdAt',
    'lastUpdatedAt',
    'status',
    'disclaimer',
    'disclaimerHtml',
    'source'
  ];

  const meta = {};

  if (item.license && item.licenseUrl) {
    meta.license = {
      name: item.license,
      url: item.licenseUrl
    };
  }

  metaFields.forEach(field => {
    if (item[field]) {
      meta[field] = item[field];
    }
  });

  if (Object.keys(meta).length > 0) {
    resource.meta = meta;
  }

  return resource;
}

/**
 * Serialize an array of resources as a collection document
 */
function serializeCollection(resource, api) {
  return createDocument(
    resource.data.map(item => serializeResource(item, api.base, resource.collectionName, api.domain)),
    {self: `${api.domain}${api.base}/${resource.collectionName}.json`},
    {count: resource.data.length},
    api.metadata
  );
}

/**
 * Serialize a single resource as a document
 */
function serializeDocument(item, apiBase, collectionName, domain, apiMetadata) {
  return createDocument(
    serializeResource(item, apiBase, collectionName, domain),
    {self: `${domain}${apiBase}/${collectionName}/${item.id}.json`},
    {},
    apiMetadata
  );
}

// ============================================================================
// API Index
// ============================================================================

/**
 * Generate the API index with links to all collections
 */
function serializeApiIndex(stats, api, resources) {
  const links = Object.fromEntries(
    resources.map(resource => [resource.collectionName, `${api.domain}${api.base}/${resource.collectionName}.json`])
  );

  const data = {
    ...api.index,
    links
  };

  return createDocument(
    data,
    {self: `${api.domain}${api.base}/index.json`},
    {statistics: stats},
    api.metadata
  );
}

// ============================================================================
// Main API Generation
// ============================================================================

/**
 * Generate all API documents from RESOURCE_TYPES configuration
 *
 * Expected inputs:
 * - resources: { FAQ: { type, collectionName, data }, ... }
 * - api: { base: "/api/v0", index: {...}, metadata: {...} }
 */
function generateApiDocuments(resources, api) {
  const resourcesArray = Object.values(resources);

  const stats = Object.fromEntries(
    resourcesArray.map(resource => [`${resource.type}Count`, resource.data.length])
  );

  // Build unified endpoints array combining collections and singletons
  const endpoints = [
    // Collection endpoints - one per resource type
    ...resourcesArray.map(resource => ({
      type: 'collection',
      collectionName: resource.collectionName,
      permalink: `${api.base}/${resource.collectionName}.json`,
      data: serializeCollection(resource, api)
    })),

    // Individual resource endpoints - one per item
    ...resourcesArray.flatMap(resource =>
      resource.data.map(item => ({
        type: 'singleton',
        collectionName: resource.collectionName,
        itemId: item.id,
        itemKey: item.id,
        permalink: `${api.base}/${resource.collectionName}/${item.id}.json`,
        data: serializeDocument(item, api.base, resource.collectionName, api.domain, api.metadata)
      }))
    )
  ];

  return {
    // API index/discovery endpoint
    index: serializeApiIndex(stats, api, resourcesArray),

    // Unified endpoints array for pagination in api.njk template
    endpoints
  };
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  generateApiDocuments
};
