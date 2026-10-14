#!/usr/bin/env bash
# The pool's newest records for a retry in the scheduled replay's gate job: the one fetch script (desktop/e2e/net-records-fetch.sh), so every reader takes the same bundles
# (14 Oct 2026: this file kept its own copy and still read the public repo's old release after the records moved to the private one). Needs NET_RECORD_KEY, GH_TOKEN, NET_RECORDS_READ_TOKEN.
set -u
cd "$GITHUB_WORKSPACE"
bash desktop/e2e/net-records-fetch.sh records
echo "replay-offline: $(find records -name record.json | wc -l) records from the pool runs"
