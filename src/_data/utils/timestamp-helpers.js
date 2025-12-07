// ============================================================================
// Timestamp Helper Functions
// ============================================================================

// Timestamp constants (in days)
const NEW_CONTENT_THRESHOLD = 30;  // Content is "new" if created within 30 days
const RECENTLY_UPDATED_THRESHOLD = 14;  // Content is "recently updated" if modified within 14 days

// Check if content is new (created within threshold)
function isNew(createdAt) {
  const daysAgo = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysAgo <= NEW_CONTENT_THRESHOLD;
}

// Check if content was recently updated (modified within threshold, but not counting initial creation)
function recentlyUpdated(createdAt, lastUpdatedAt) {
  // If creation and update dates are the same, it hasn't been updated since creation
  if (createdAt.getTime() === lastUpdatedAt.getTime()) return false;

  const daysAgo = (Date.now() - lastUpdatedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysAgo <= RECENTLY_UPDATED_THRESHOLD;
}

module.exports = {
  NEW_CONTENT_THRESHOLD,
  RECENTLY_UPDATED_THRESHOLD,
  isNew,
  recentlyUpdated
};