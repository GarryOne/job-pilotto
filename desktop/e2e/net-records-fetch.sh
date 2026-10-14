#!/usr/bin/env bash
# The pool's newest network records, decrypted on the CI runner only (the Mac's on the release net-records of the PRIVATE repo job-pilotto-internal (owner, 14 Oct 2026),
# read with NET_RECORDS_READ_TOKEN, the public repo's old release as a fallback; records-publish.mjs; then the by-hand pool runs' of 14 days,
# net-records-<run>): bash net-records-fetch.sh <records dir>. Needs NET_RECORD_KEY, GH_TOKEN and NET_RECORDS_READ_TOKEN. Used by site-replays-pr.yml and site-replays.yml.
set -u
out="${1:?usage: net-records-fetch.sh <records dir>}"; enc="${RUNNER_TEMP:-/tmp}/enc"; key="${RUNNER_TEMP:-/tmp}/key.pem"
mkdir -p "$out" "$enc"
umask 077 && printf '%s' "$NET_RECORD_KEY" | base64 -d > "$key"
mac_records() {   # the private repo first (its read-only token), then this repo's old public release
  [ -n "${NET_RECORDS_READ_TOKEN:-}" ] && GH_TOKEN="$NET_RECORDS_READ_TOKEN" gh release download net-records -R "${NET_RECORDS_REPO:-GarryOne/job-pilotto-internal}" --pattern 'net-records.*' --dir "$enc/mac" >/dev/null 2>&1 && { echo "net-records-fetch: Mac records from ${NET_RECORDS_REPO:-GarryOne/job-pilotto-internal}"; return 0; }
  gh release download net-records --pattern 'net-records.*' --dir "$enc/mac" >/dev/null 2>&1 && { echo "net-records-fetch: Mac records from this repo's release (fallback)"; return 0; }
  echo "net-records-fetch: no Mac records"; return 1
}
if mac_records; then
  openssl pkeyutl -decrypt -inkey "$key" -pkeyopt rsa_padding_mode:oaep -in "$enc/mac/net-records.k.enc" -out "$enc/k" \
    && mkdir -p "$out/mac" && openssl enc -d -aes-256-cbc -pbkdf2 -in "$enc/mac/net-records.tgz.enc" -pass "file:$enc/k" | tar xz -C "$out/mac" || true
  rm -f "$enc/k"
fi
since=$(date -u -d '14 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-14d +%Y-%m-%dT%H:%M:%SZ)
# the workflow was "CI · Pool smoke (by hand)" until 15 Oct 2026: its runs' records (14 days) are read too
for workflow in "CI · Record sites (by hand)" "CI · Pool smoke (by hand)"; do
  gh run list --workflow "$workflow" --limit 60 --json databaseId,createdAt --jq ".[] | select(.createdAt >= \"$since\") | .databaseId" 2>/dev/null || true
done | sort -u | while read -r id; do
  gh run download "$id" --name "net-records-$id" --dir "$enc/$id" >/dev/null 2>&1 || continue
  openssl pkeyutl -decrypt -inkey "$key" -pkeyopt rsa_padding_mode:oaep -in "$enc/$id/k.enc" -out "$enc/k" || continue
  mkdir -p "$out/$id" && openssl enc -d -aes-256-cbc -pbkdf2 -in "$enc/$id/net.tgz.enc" -pass "file:$enc/k" | tar xz -C "$out/$id" || true
  rm -f "$enc/k"
done
rm -f "$key"; rm -rf "$enc"
echo "net-records-fetch: $(find "$out" -name record.json | wc -l | tr -d ' ') records"
