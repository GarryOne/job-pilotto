#!/usr/bin/env bash
# The desktop release's title, short enough for GitHub's release list (it cuts titles at ~20 characters):
# the version, then the date (the tag is desktop-v<version>).   0.5.3 -> "0.5.3 · 3 Oct"
# Usage: release-title.sh <version> [YYYY-MM-DD]
set -euo pipefail
export LC_ALL=C   # English month names
version="${1:?usage: $0 <version> [date]}"
day="$(date -u -d "${2:-today}" '+%-d %b' 2>/dev/null || date -u -j -f %Y-%m-%d "${2:-$(date -u +%F)}" '+%-d %b')"
echo "$version · $day"
