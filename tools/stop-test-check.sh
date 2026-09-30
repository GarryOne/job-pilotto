#!/usr/bin/env bash
# Claude Code Stop hook (.claude/settings.json): before Claude says it's done, run the test suites that match the
# files changed vs origin/main in each worktree this session touched, the way CI runs them, and send failures back.
#   src/ tests/ tools/ config/ templates/ -> Python, as CI sees it (JOB_PILOTTO_DISABLE=..., no Keychain credentials)
#   desktop/ -> desktop npm test    worker/ extension/ -> worker npm test    site/ -> site npm test
#   a file added, removed or renamed anywhere -> desktop's CODEMAP test
# Uses Python >= 3.11 and Node 22 (nvm) whatever is first on PATH. Each suite is time-boxed; a tree state that
# already passed is not tested again. Exit 2 + stderr keeps Claude working on the failure (once per stop chain).
# Manual run: echo '{"cwd":"<worktree>"}' | tools/stop-test-check.sh
set -uo pipefail

input="$(cat)"
jqr() { jq -r "$1" <<<"$input" 2>/dev/null; }
cwd="$(jqr '.cwd // ""')"; transcript="$(jqr '.transcript_path // ""')"; again="$(jqr '.stop_hook_active // false')"
limit="${JOB_PILOTTO_STOP_TIMEBOX:-240}"   # seconds per suite
cache="${TMPDIR:-/tmp}/job-pilotto-stop-hook"; mkdir -p "$cache"

# Worktrees to check: the session's cwd, the project dir, and every worktree this session's tool calls named.
dirs=("$cwd" "${CLAUDE_PROJECT_DIR:-}")
if [ -f "$transcript" ]; then
  while IFS= read -r p; do dirs+=("$p"); done < <(
    tail -n 4000 "$transcript" | jq -r 'select(.type=="assistant") | .message.content[]?
      | select(.type=="tool_use") | .input | (.file_path // .notebook_path // empty), (.command // empty)' 2>/dev/null |
      grep -oE '(/[^[:space:]"'"'"'`;|&()]+)' | grep -E '\.claude/worktrees/|/job-pilotto' |
      sed -E 's#(\.claude/worktrees/[^/]+).*#\1#' | sort -u | head -50)
fi
repos=()
for d in "${dirs[@]}"; do
  [ -n "$d" ] || continue
  while [ ! -d "$d" ] && [ "$d" != "/" ] && [ -n "$d" ]; do d="$(dirname "$d")"; done
  top="$(git -C "$d" rev-parse --show-toplevel 2>/dev/null)" || continue
  [ -f "$top/src/daily.py" ] && [ -d "$top/worker" ] || continue   # only this project
  case " ${repos[*]-} " in *" $top "*) ;; *) repos+=("$top") ;; esac
done
[ ${#repos[@]} -gt 0 ] || exit 0

# Toolchain like CI (Python 3.12, Node 20/22): a stale Node 16 / Python 3.9 on PATH fails suites for no reason.
py=python3
for c in python3.12 python3.13 python3.11 python3; do
  if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then py="$c"; break; fi
done
node22="$(ls -d "$HOME"/.nvm/versions/node/v22.* 2>/dev/null | sort -V | tail -1)"
[ -n "$node22" ] && export PATH="$node22/bin:$PATH"
tbin="$(command -v gtimeout || command -v timeout || true)"
boxed() { if [ -n "$tbin" ]; then "$tbin" -k 10 "$limit" "$@"; else "$@"; fi; }

report=""; timeouts=""; notes=""
for repo in "${repos[@]}"; do
  git -C "$repo" rev-parse -q --verify origin/main >/dev/null || continue
  base="$(git -C "$repo" merge-base HEAD origin/main 2>/dev/null)" || continue
  status="$(git -C "$repo" diff --name-status "$base" 2>/dev/null)"
  untracked="$(git -C "$repo" ls-files --others --exclude-standard 2>/dev/null)"
  files="$( { cut -f2- <<<"$status" | tr '\t' '\n'; printf '%s\n' "$untracked"; } | sed '/^$/d' | sort -u)"
  [ -n "$files" ] || continue

  suites=()
  grep -qE '^(src|tests|tools|config|templates)/|^requirements[^/]*\.txt$' <<<"$files" && suites+=(python)
  grep -q '^desktop/' <<<"$files" && suites+=(desktop)
  grep -qE '^(worker|extension)/' <<<"$files" && suites+=(worker)
  grep -q '^site/' <<<"$files" && suites+=(site)
  if [ -n "$untracked" ] || grep -qE '^[ADR]' <<<"$status"; then
    case " ${suites[*]-} " in *" desktop "*) ;; *) suites+=(codemap) ;; esac
  fi
  [ ${#suites[@]} -gt 0 ] || continue

  # Same tree as a run that already passed (or already failed and was reported): don't run again.
  key="$( { echo "$repo ${suites[*]}"; git -C "$repo" rev-parse HEAD; git -C "$repo" diff "$base";
    [ -n "$untracked" ] && (cd "$repo" && tr '\n' '\0' <<<"$untracked" | xargs -0 shasum 2>/dev/null); } | shasum | cut -c1-16)"
  [ -f "$cache/$key.pass" ] && continue
  if [ -f "$cache/$key.fail" ]; then report+="$(cat "$cache/$key.fail")"$'\n'; continue; fi

  logs="$(mktemp -d)"; pids=()
  for s in "${suites[@]}"; do
    case "$s" in
      python) cmd=(env JOB_PILOTTO_DISABLE=mail,notion,telegram,google_jobs "$py" -m unittest discover -s tests -q); dir="$repo" ;;
      codemap) cmd=(node --test test/codemap.test.js); dir="$repo/desktop" ;;
      *) cmd=(npm test --silent); dir="$repo/$s" ;;
    esac
    if [ "$s" != python ] && [ ! -e "$dir/node_modules" ]; then
      notes+="$s not tested in $repo: no node_modules (run npm ci there in the owner's terminal, or tools/worktree.sh links them)."$'\n'
      continue
    fi
    out="$logs/$s.log"; [ "$s" = python ] && out=/dev/null   # unittest reports on stderr; the tests' prints are noise
    ( cd "$dir" && boxed "${cmd[@]}" >"$out" 2>>"$logs/$s.log"; echo $? >"$logs/$s.code" ) &
    pids+=($!)
  done
  [ ${#pids[@]} -gt 0 ] && wait "${pids[@]}"

  failed=""
  for s in "${suites[@]}"; do
    [ -f "$logs/$s.code" ] || continue
    code="$(cat "$logs/$s.code")"
    if [ "$code" = 124 ] || [ "$code" = 137 ]; then timeouts+="$s in $repo took over ${limit}s (not counted as a failure). "; continue; fi
    [ "$code" = 0 ] && continue
    case "$s" in
      python) how="JOB_PILOTTO_DISABLE=mail,notion,telegram,google_jobs $py -m unittest discover -s tests" ;;
      codemap) how="cd desktop && node --test test/codemap.test.js (new/removed file: node desktop/scripts/codemap.mjs)" ;;
      *) how="cd $s && npm test" ;;
    esac
    failed+="--- $s failed (exit $code). Reproduce in $repo: $how"$'\n'
    failed+="$(grep -E '^(FAIL|ERROR):|^# fail|npm (ERR|error)' "$logs/$s.log" | sort -u | head -20)"$'\n'
    if [ "$s" = python ]; then   # the unittest failure blocks (====== FAIL: ... traceback), not the tests' prints
      failed+="$(awk '/^={40,}$/{p=1} p' "$logs/$s.log" | head -60)"$'\n'
    else failed+="$(grep -A14 -E '^not ok' "$logs/$s.log" | head -45)"$'\n'; [ -n "$(grep -m1 '^not ok' "$logs/$s.log")" ] || failed+="$(tail -n 25 "$logs/$s.log")"$'\n'; fi
  done
  rm -rf "$logs"
  if [ -z "$failed" ]; then
    [ -z "$timeouts" ] && touch "$cache/$key.pass"
  else
    printf '%s' "$failed" >"$cache/$key.fail"; report+="$failed"
  fi
done
find "$cache" -type f -mtime +2 -delete 2>/dev/null

msg=""
[ -n "$timeouts" ] && msg+="Stop hook: $timeouts"
[ -n "$notes" ] && msg+="Stop hook: $notes"
if [ -n "$report" ] && [ "$again" != true ]; then
  {
    echo "Tests that match your changes fail the way CI runs them (Python without credentials, Node 22). Fix them"
    echo "(or say clearly why they are unrelated) before saying you're done."
    printf '%s' "$report" | head -c 6000
    [ -n "$msg" ] && echo "$msg"
  } >&2
  exit 2
fi
[ -n "$report" ] && msg+="Stop hook: tests still fail (reported once already): $(printf '%s' "$report" | grep -E '^--- ' | tr '\n' ' ')"
[ -n "$msg" ] && jq -n --arg m "$msg" '{systemMessage: $m}'
exit 0
