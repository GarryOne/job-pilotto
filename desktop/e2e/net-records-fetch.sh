#!/usr/bin/env bash
# The pool's newest network records, decrypted on the CI runner only (the Mac's on the release net-records of the PRIVATE repo job-pilotto-internal (owner, 14 Oct 2026),
# read with NET_RECORDS_READ_TOKEN, the public repo's old release as a fallback; records-publish.mjs): bash net-records-fetch.sh <records dir>.
# ONLY the published release is read (owner, 15 Oct 2026): a record-sites run's CI artifact (net-records-<run>) is never fetched, so a recording reaches a replay only after it passed records-publish's guard. Needs NET_RECORD_KEY, GH_TOKEN and NET_RECORDS_READ_TOKEN on CI; on the Mac none (the Keychain key, the gh login). Used by site-replays-pr.yml and site-replays.yml.
set -u
out="${1:?usage: net-records-fetch.sh <records dir>}"
# Each run its own private folder, removed on any exit: two sessions fetching at once on the Mac shared /tmp/enc and /tmp/key.pem (15 Oct 2026), and an aborted run left the key behind.
work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/net-records.XXXXXX")"; trap 'rm -rf "$work"' EXIT
enc="$work/enc"; key="$work/key.pem"
mkdir -p "$out" "$enc"
# On the Mac the private repo is read with the person's own gh login when no read token is given (new sessions stopped at "no Mac records", 15 Oct 2026); CI passes its token.
[ -z "${NET_RECORDS_READ_TOKEN:-}" ] && [ -z "${CI:-}" ] && NET_RECORDS_READ_TOKEN="$(gh auth token 2>/dev/null || true)"
# ...and the private key from the Keychain item job-pilotto.capture.key (base64 of the PEM, as NET_RECORD_KEY), read here and never printed; it lives only in $work.
[ -z "${NET_RECORD_KEY:-}" ] && [ -z "${CI:-}" ] && command -v security >/dev/null && NET_RECORD_KEY="$(security find-generic-password -s job-pilotto.capture.key -w 2>/dev/null || true)"
umask 077 && printf '%s' "$NET_RECORD_KEY" | base64 -d > "$key"
mac_records() {   # the private repo first (its read-only token), then this repo's old public release
  [ -n "${NET_RECORDS_READ_TOKEN:-}" ] && GH_TOKEN="$NET_RECORDS_READ_TOKEN" gh release download net-records -R "${NET_RECORDS_REPO:-GarryOne/job-pilotto-internal}" --pattern 'net-records*' --dir "$enc/mac" >/dev/null 2>&1 && { echo "net-records-fetch: Mac records from ${NET_RECORDS_REPO:-GarryOne/job-pilotto-internal}"; return 0; }
  gh release download net-records --pattern 'net-records*' --dir "$enc/mac" >/dev/null 2>&1 && { echo "net-records-fetch: Mac records from this repo's release (fallback)"; return 0; }
  echo "net-records-fetch: no Mac records"; return 1
}
# every bundle on the release (records-publish.mjs adds one per publish; the first set is net-records.tgz.enc): each into mac/<bundle> (whereOf reads the mac/ folder), the newest record per row wins
if mac_records; then
  for k in "$enc"/mac/net-records*.k.enc; do
    [ -f "$k" ] || continue
    name="$(basename "$k" .k.enc)"
    openssl pkeyutl -decrypt -inkey "$key" -pkeyopt rsa_padding_mode:oaep -in "$k" -out "$enc/k" \
      && mkdir -p "$out/mac/$name" && openssl enc -d -aes-256-cbc -pbkdf2 -in "$enc/mac/$name.tgz.enc" -pass "file:$enc/k" | tar xz -C "$out/mac/$name" || true
    rm -f "$enc/k"
  done
fi
echo "net-records-fetch: $(find "$out" -name record.json | wc -l | tr -d ' ') records"
