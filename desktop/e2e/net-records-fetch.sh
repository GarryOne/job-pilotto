#!/usr/bin/env bash
# The pool's newest network records, decrypted on the CI runner only (the Mac's on the release net-records, records-publish.mjs; then the by-hand pool runs' of 14 days,
# net-records-<run>): bash net-records-fetch.sh <records dir>. Needs NET_RECORD_KEY and GH_TOKEN. Used by .github/workflows/replay-pr.yml (the same steps as replay-offline.yml's).
set -u
out="${1:?usage: net-records-fetch.sh <records dir>}"; enc="${RUNNER_TEMP:-/tmp}/enc"; key="${RUNNER_TEMP:-/tmp}/key.pem"
mkdir -p "$out" "$enc"
umask 077 && printf '%s' "$NET_RECORD_KEY" | base64 -d > "$key"
if gh release download net-records --pattern 'net-records.*' --dir "$enc/mac" >/dev/null 2>&1; then
  openssl pkeyutl -decrypt -inkey "$key" -pkeyopt rsa_padding_mode:oaep -in "$enc/mac/net-records.k.enc" -out "$enc/k" \
    && mkdir -p "$out/mac" && openssl enc -d -aes-256-cbc -pbkdf2 -in "$enc/mac/net-records.tgz.enc" -pass "file:$enc/k" | tar xz -C "$out/mac" || true
  rm -f "$enc/k"
fi
since=$(date -u -d '14 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-14d +%Y-%m-%dT%H:%M:%SZ)
gh run list --workflow "CI · Pool smoke (by hand)" --limit 60 --json databaseId,createdAt --jq ".[] | select(.createdAt >= \"$since\") | .databaseId" | while read -r id; do
  gh run download "$id" --name "net-records-$id" --dir "$enc/$id" >/dev/null 2>&1 || continue
  openssl pkeyutl -decrypt -inkey "$key" -pkeyopt rsa_padding_mode:oaep -in "$enc/$id/k.enc" -out "$enc/k" || continue
  mkdir -p "$out/$id" && openssl enc -d -aes-256-cbc -pbkdf2 -in "$enc/$id/net.tgz.enc" -pass "file:$enc/k" | tar xz -C "$out/$id" || true
  rm -f "$enc/k"
done
rm -f "$key"; rm -rf "$enc"
echo "net-records-fetch: $(find "$out" -name record.json | wc -l | tr -d ' ') records"
