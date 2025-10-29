#!/bin/bash
set -e

REPO_URL="https://github.com/orcwg/cra-hub.git"

if [ -d "_cache/.git" ]; then
  echo "🔄 Updating cache..."
  cd _cache && git pull --rebase && cd ..
else
  echo "📥 Cloning repo..."
  git clone $REPO_URL _cache
fi

#!/bin/bash
set -e

REPO_URL="https://github.com/orcwg/cra-hub.git"
CACHE_DIR="_cache"

# Step 1: Clone or update the cached repository
if [ -d "$CACHE_DIR/.git" ]; then
  echo "🔄 Updating cache..."
  # Use -C to operate on the repo without changing the current directory
  git -C "$CACHE_DIR" pull --rebase
else
  echo "📥 Cloning repo..."
  git clone "$REPO_URL" "$CACHE_DIR"
fi
echo "✅ Cache updated."

# Step 2: Fetch repository contributors and save to JSON
echo "👥 Fetching repository contributors..."
CONTRIBUTORS_FILE="src/_data/repoContributors.json"

# Get unique authors from git log in the cached repository,
# parse their names and emails, and save as a JSON array.
# Using 'jq' for robust JSON creation and deduplication.
# Expected output format for JSON:
# [{ "name": "Author Name", "email": "author@example.com" }, ...]
git -C "$CACHE_DIR" log --pretty=format:'%aN <%aE>' \
  | jq -R '
      [
        inputs
        # Filter out any potential empty lines
        | select(length > 0)
        # Use a regex to robustly capture name and email.
        # This handles variations in spacing and is safer than splitting.
        | capture("^(?<name>.+?) *<(?<email>.+?)>$")
      ]
      # Deduplicate the list of contributors based on their email address,
      # keeping the first entry encountered for each email.
      | unique_by(.email)
    ' > "$CONTRIBUTORS_FILE"

echo "✅ Repository contributors saved to $CONTRIBUTORS_FILE"