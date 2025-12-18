// Extract GitHub issue number from URL
// Returns the issue number or null if not found
function extractIssueNumber(issueUrl) {
  // Match GitHub issue URL pattern: /issues/123
  const match = issueUrl.match(/\/issues\/(\d+)/);
  return match ? match[1] : null;
}

// Parse related issues from frontmatter
// Input can be a single string or an array of strings
// Returns an array of issue objects with url and number
function parseRelatedIssues(relatedIssues) {
  if (!relatedIssues) {
    return [];
  }

  const issueUrls = relatedIssues.trim().split(/,\s*/);
  // Transform URLs to objects with url and number

  return issueUrls.map(url => ({
    type: "github",
    url: url,
    id: extractIssueNumber(url)
  }));
}

module.exports = {
  extractIssueNumber,
  parseRelatedIssues
};
