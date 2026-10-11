# Source it, then `session_name` prints the name of the Claude session this process runs under. Owner: ship-speed (11 Oct 2026). Guarded by tests/test_session_name.py.
# Order: JOB_PILOTTO_SESSION (a caller that detached from its parents, like ship.sh --background, sets it first), JP_SESSION, then the same lookup the workspace hooks use
# (walk the parent processes to ~/.claude/sessions/<pid>.json and read its "name"; JP_SESSIONS_DIR points elsewhere for tests), else "?".
session_name() {
  local name="${JOB_PILOTTO_SESSION:-${JP_SESSION:-}}" pid="$$" dir="${JP_SESSIONS_DIR:-$HOME/.claude/sessions}" hops=0
  if [ -z "$name" ]; then
    while [ -n "$pid" ] && [ "$pid" != 1 ] && [ "$hops" -lt 12 ]; do
      if [ -f "$dir/$pid.json" ]; then name="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("name", ""))' "$dir/$pid.json" 2>/dev/null)"; break; fi
      pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"; hops=$((hops + 1))
    done
  fi
  echo "${name:-?}"
}
