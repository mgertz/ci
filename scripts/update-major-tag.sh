#!/usr/bin/env bash
set -euo pipefail

# Also works on retries after a release succeeded but alias promotion failed.
# Use fetched main, not HEAD: an older queued run must not move aliases backwards.
release_tag="$(git tag --merged origin/main --list 'v*' --sort=-version:refname | awk '/^v[0-9]+\.[0-9]+\.[0-9]+$/ && !found { print; found = 1 }')"
if [ -z "$release_tag" ]; then
  exit 0
fi

version="${release_tag#v}"
major_tag="v${version%%.*}"
git tag --force "$major_tag" "${release_tag}^{commit}"
git push origin "refs/tags/$major_tag" --force
