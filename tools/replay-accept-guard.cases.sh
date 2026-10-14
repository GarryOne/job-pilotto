#!/bin/bash
# Cases for replay-accept-guard.py: expect "block" or "pass" for a Bash command. Run: bash tools/replay-accept-guard.cases.sh (tests/test_replay_accept_guard.py runs it).
H=$(dirname "$0")/replay-accept-guard.py; fail=0; T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
check() { # expect, command
  local got; python3 -c 'import json,sys; print(json.dumps({"tool_name":"Bash","cwd":sys.argv[2],"tool_input":{"command":sys.argv[1]}}))' "$2" "$T" | python3 "$H" 2>/dev/null
  [ $? -eq 2 ] && got=block || got=pass
  [ "$got" = "$1" ] && echo "ok   $1: $2" || { echo "FAIL want $1 got $got: $2"; fail=1; }
}
printf 'Replay-accept: row a — on purpose\n' > "$T/body.md"; printf 'looks fine\n' > "$T/plain.md"
check block 'gh pr comment 755 --body "Replay-accept: Lever row — a CV was counted twice"'
check block 'gh pr comment 755 -b "replay-accept: all moved"'
check block 'gh issue comment 755 --body "Replay-accept: x"'
check block "gh api repos/o/r/issues/755/comments -f body='Replay-accept: x'"
check block 'gh pr comment 755 --body-file body.md'
check block 'gh api repos/o/r/issues/755/comments -F body=@body.md'
check block $'gh pr comment 755 --body-file - <<\'EOF\'\nReplay-accept: a — b\nEOF'
check block 'cd x && gh pr review 755 --comment --body "Replay-accept: a"'
check pass  'REPLAY_ACCEPT_OK=1 gh pr comment 755 --body "Replay-accept: a — the owner asked"'
check pass  'gh pr comment 755 --body-file plain.md'
check pass  'gh pr comment 755 --body "the gate is red; the owner decides"'
check pass  'grep -rn "Replay-accept:" desktop/e2e'
check pass  'git commit -m "Docs: how a Replay-accept: line works"'
check pass  'gh pr view 755 --json comments'
exit $fail
