#!/usr/bin/env bash
# The one way to create a release that is not a desktop build: always a pre-release and never Latest (17 Oct 2026: a normal release for PR screenshots became "Latest" and the Download link pointed at it).
# PR images do not need a release at all: desktop/e2e/lib/evidence.mjs publishFiles (tools/pr-assets.mjs). Desktop builds are made by desktop.yml. Usage: tools/gh-release-create.sh <tag> [gh release create args]
set -euo pipefail
tag=${1:?usage: tools/gh-release-create.sh <tag> [args]}; shift
gh release create "$tag" --prerelease --latest=false "$@"
