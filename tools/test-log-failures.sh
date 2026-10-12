#!/usr/bin/env bash
# The failing tests of a node test log, in either reporter's shape (12 Oct 2026: the stop hook read only the by-file reporter's "✖ name (test/file)" lines, but its own
# affected-tests run writes TAP ("not ok N - name" + "location: '.../desktop/test/file:6:1'"), so the extension-fingerprint exemption never matched). Sourced by
# tools/stop-test-check.sh. Guard: tests/test_test_log_failures.py.
#   failing_files <log>   the failing test files, one per line, as test/<file> (sorted, unique)
#   failing_names <log>   the failing test names, one per line (at most 15)
failing_files() {
  { grep -E '^ *✖ ' "$1" 2>/dev/null | sed -nE 's/.*\((test\/[^)]*)\)$/\1/p'
    awk '/^ *not ok /{p=1; next} p && /location:/{sub(/.*\/desktop\//, ""); sub(/:[0-9]+:[0-9]+.*$/, ""); print; p=0}' "$1" 2>/dev/null; } | sort -u
}
failing_names() {
  { grep -E '^ *✖ ' "$1" 2>/dev/null | sed -E 's/ \([0-9.]+ms\)$//'
    grep -E '^ *not ok [0-9]+ - ' "$1" 2>/dev/null | sed -E 's/^ *not ok [0-9]+ - //; s/ # .*$//'; } | sort -u | head -15
}
