#!/usr/bin/env bash
# Installs Playwright's Chromium for CI: cached browser + cached apt packages, a stalled mirror cut and retried (used by every workflow that installs it).
# Usage: install.sh key|install <node|python> <full|shell|both>. Guarded by tests/test_playwright_install_action.py.
set -uo pipefail
step="$1"; runtime="$2"; mode="$3"

if [ "$runtime" = python ]; then pw=(playwright); else pw=(npx --no-install playwright); fi
case "$mode" in
  full) flag=(--no-shell) ;;
  shell) flag=(--only-shell) ;;
  both) flag=() ;;
  *) echo "playwright-browser: unknown mode '$mode'" >&2; exit 2 ;;
esac

if [ "$step" = key ]; then
  # Exact version in the key and no restore-keys: a cache never serves another version's browser. Unknown version = a key nothing shares.
  version="$("${pw[@]}" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
  image="${ImageVersion:-$(lsb_release -rs 2>/dev/null || uname -s)}"
  echo "key=${runtime}-${mode}-${RUNNER_OS}-${version:-unknown-${GITHUB_RUN_ID:-0}-${GITHUB_RUN_ATTEMPT:-0}}" >> "$GITHUB_OUTPUT"
  echo "image=${image}" >> "$GITHUB_OUTPUT"
  exit 0
fi

# Run a command, cut it after $1 seconds, retry once, then a last time without a cut (a slow mirror is better than none).
patient() {
  local secs="$1"; shift
  if timeout "$secs" "$@"; then return 0; fi
  echo "playwright-browser: '$*' stalled or failed, retrying once"
  if timeout "$secs" "$@"; then return 0; fi
  echo "playwright-browser: retrying without a cut"
  "$@"
}

if [ "$RUNNER_OS" = Linux ]; then
  # apt keeps its downloaded .deb files in the cached folder; a hit downloads nothing from the mirror.
  sudo mkdir -p /var/cache/pw-apt/partial && sudo chmod -R a+rwX /var/cache/pw-apt
  printf '%s\n' 'Dir::Cache::archives "/var/cache/pw-apt";' 'Acquire::Retries "3";' 'Acquire::http::Timeout "20";' 'Acquire::https::Timeout "20";' \
    | sudo tee /etc/apt/apt.conf.d/99playwright-cache >/dev/null
  start=$SECONDS
  patient 90 sudo env "PATH=$PATH" "${pw[@]}" install-deps chromium
  echo "playwright-browser: system packages in $((SECONDS - start)) s"
  sudo chmod -R a+rX /var/cache/pw-apt
fi

start=$SECONDS
patient 120 "${pw[@]}" install chromium ${flag[@]+"${flag[@]}"}
echo "playwright-browser: browser in $((SECONDS - start)) s"
