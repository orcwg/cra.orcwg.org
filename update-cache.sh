#!/bin/bash
set -e

REPO_URL="https://github.com/orcwg/cra-hub.git"
BRANCH="${1:-main}"

if [ -d "_cache/.git" ]; then
  echo "🔄 Updating cache (branch: $BRANCH)..."
  cd _cache && git fetch origin && git checkout $BRANCH && git pull --rebase origin $BRANCH && cd ..
else
  echo "📥 Cloning repo (branch: $BRANCH)..."
  git clone --branch $BRANCH $REPO_URL _cache
fi