#!/usr/bin/env bash
# The pool's newest records for a retry in the scheduled replay's gate job (the same lines as site-replays.yml's records step). Needs NET_RECORD_KEY, GH_TOKEN.
set -u
cd "$GITHUB_WORKSPACE"
mkdir -p records "$RUNNER_TEMP/enc"
umask 077 && printf '%s' "$NET_RECORD_KEY" | base64 -d > "$RUNNER_TEMP/key.pem"
# the Mac's records (records-publish.mjs, the release net-records), then the CI pool runs' (14 days); the newest record of each row is replayed
if gh release download net-records --pattern 'net-records.*' --dir "$RUNNER_TEMP/enc/mac" >/dev/null 2>&1; then
  openssl pkeyutl -decrypt -inkey "$RUNNER_TEMP/key.pem" -pkeyopt rsa_padding_mode:oaep -in "$RUNNER_TEMP/enc/mac/net-records.k.enc" -out "$RUNNER_TEMP/k" \
    && mkdir -p records/mac && openssl enc -d -aes-256-cbc -pbkdf2 -in "$RUNNER_TEMP/enc/mac/net-records.tgz.enc" -pass "file:$RUNNER_TEMP/k" | tar xz -C records/mac || true
  rm -f "$RUNNER_TEMP/k"
fi
since=$(date -u -d '14 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-14d +%Y-%m-%dT%H:%M:%SZ)
# the workflow was "CI · Pool smoke (by hand)" until 15 Oct 2026: its runs' records (14 days) are read too
for workflow in "CI · Record sites (by hand)" "CI · Pool smoke (by hand)"; do
  gh run list --workflow "$workflow" --limit 60 --json databaseId,createdAt --jq ".[] | select(.createdAt >= \"$since\") | .databaseId" 2>/dev/null || true
done | sort -u | while read -r id; do
  gh run download "$id" --name "net-records-$id" --dir "$RUNNER_TEMP/enc/$id" >/dev/null 2>&1 || continue
  openssl pkeyutl -decrypt -inkey "$RUNNER_TEMP/key.pem" -pkeyopt rsa_padding_mode:oaep -in "$RUNNER_TEMP/enc/$id/k.enc" -out "$RUNNER_TEMP/k" || continue
  mkdir -p "records/$id" && openssl enc -d -aes-256-cbc -pbkdf2 -in "$RUNNER_TEMP/enc/$id/net.tgz.enc" -pass "file:$RUNNER_TEMP/k" | tar xz -C "records/$id" || true
  rm -f "$RUNNER_TEMP/k"
done
rm -f "$RUNNER_TEMP/key.pem"; rm -rf "$RUNNER_TEMP/enc"
echo "replay-offline: $(find records -name record.json | wc -l) records from the pool runs"
