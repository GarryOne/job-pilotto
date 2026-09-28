#!/usr/bin/env bash
# The desktop release's title, short enough for GitHub's release list (it cuts titles at ~20 characters):
# the phase and build number first, then the date. The full version stays in the tag (desktop-v<version>).
#   0.2.0-alpha.60 -> "Alpha 60 · 28 Sep"      0.3.0-beta.2 -> "Beta 2 · 28 Sep"      1.0.1 -> "1.0.1 · 28 Sep"
# Usage: release-title.sh <version> [YYYY-MM-DD]
set -euo pipefail
export LC_ALL=C   # English month names
version="${1:?usage: $0 <version> [date]}"
day="$(date -u -d "${2:-today}" '+%-d %b' 2>/dev/null || date -u -j -f %Y-%m-%d "${2:-$(date -u +%F)}" '+%-d %b')"
if [[ "$version" =~ -([a-z]+)\.([0-9]+)$ ]]; then
  phase="${BASH_REMATCH[1]}" build="${BASH_REMATCH[2]}"
  echo "$(printf '%s' "${phase:0:1}" | tr '[:lower:]' '[:upper:]')${phase:1} $build · $day"
else
  echo "$version · $day"
fi
