// ============================================================================
// JSON:API Serializer
// ============================================================================
// Converts data pipeline output to JSON:API v1.1 format
// Resources are expected to have: type, id, _apiCollectionName, _apiSelfLink
// Fields prefixed with _ are internal and excluded from API output

const API_VERSION = "1.1";

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Check if a value is a resource reference (object with type/id)
 */
function isResourceRef(value) {
  return typeof value === 'object' && value.type !== undefined && value.id !== undefined;
}

/**
 * Serialize a value for JSON output
 */
function serializeValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(item => serializeValue(item));
  }
  return value;
}

/**
 * Format relationship reference (type + id only)
 */
function formatRelationshipRef(item) {
  return { type: item.type, id: item.id };
}

/**
 * Automatically extract attributes and relationships from an object.
 * Anything with type+id (or array of) becomes a relationship; everything else becomes an attribute.
 * Skip internal fields (prefixed with _), top-level type/id, and fields handled in links.
 */
function extractAttributesAndRelationships(obj) {
  const attributes = {};
  const relationships = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip internal/API-specific fields (prefixed with _)
    if (key.startsWith('_')) continue;
    // Skip top-level type and id (handled at resource level)
    if (key === 'type' || key === 'id') continue;
    // Skip fields handled in links object
    if (key === 'permalink') continue;
    // Skip null/undefined
    if (value === null || value === undefined) continue;

    // Check if it's a resource reference (or array of)
    if (isResourceRef(value)) {
      relationships[key] = { data: formatRelationshipRef(value) };
    } else if (Array.isArray(value) && value.length > 0 && isResourceRef(value[0])) {
      relationships[key] = { data: value.map(formatRelationshipRef) };
    } else {
      // It's an attribute
      const serialized = serializeValue(value);
      if (serialized !== undefined) {
        attributes[key] = serialized;
      }
    }
  }

  return { attributes, relationships };
}

// ============================================================================
// Document Wrapper
// ============================================================================

function createDocument(data, links = {}, meta = {}, apiMetadata = {}) {
  const doc = {
    jsonapi: { version: API_VERSION },
    data
  };

  if (Object.keys(links).length > 0) {
    doc.links = links;
  }

  doc.meta = {
    generatedAt: new Date().toISOString(),
    license: apiMetadata.license,
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
function buildResourceLinks(item) {
  const links = {
    self: item._apiSelfLink,
    ...(item.permalink && { html: item.permalink }),
    ...(item._editOnGithubUrl && { edit: item._editOnGithubUrl })
  };
  return links;
}

/**
 * Serialize a single resource into JSON:API format
 */
function serializeResource(item) {
  const { attributes, relationships } = extractAttributesAndRelationships(item);

  const resource = {
    type: item.type,
    id: item.id,
    attributes,
    links: buildResourceLinks(item)
  };

  if (Object.keys(relationships).length > 0) {
    resource.relationships = relationships;
  }

  return resource;
}

/**
 * Serialize an array of resources as a collection document
 */
function serializeCollection(resource, api) {
  return createDocument(
    resource.data.map(serializeResource),
    { self: `${api.base}/${resource.collectionName}.json` },
    { count: resource.data.length },
    api.metadata
  );
}

/**
 * Serialize a single resource as a document
 */
function serializeDocument(item, apiMetadata) {
  return createDocument(
    serializeResource(item),
    { self: item._apiSelfLink },
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
    resources.map(resource => [resource.collectionName, `${api.base}/${resource.collectionName}.json`])
  );

  const data = {
    ...api.index,
    links
  };

  return createDocument(
    data,
    { self: `${api.base}/index.json` },
    { statistics: stats },
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

  return {
    // API index/discovery endpoint
    index: serializeApiIndex(stats, api, resourcesArray),

    // Collections array for pagination in collection.njk template
    collections: resourcesArray.map(resource => ({
      collectionName: resource.collectionName,
      formatted: serializeCollection(resource, api)
    })),

    // Singletons array for pagination in singleton.njk template
    singletons: resourcesArray.flatMap(resource =>
      resource.data.map(item => ({
        collectionName: resource.collectionName,
        itemId: item.id,
        itemKey: item.id,
        formatted: serializeDocument(item, api.metadata)
      }))
    )
  };
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  generateApiDocuments
};
