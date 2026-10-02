"""The end-to-end gate of tools/release-stable.sh: may this build be promoted, judging by the e2e runs GitHub lists (newest first)?

    gh run list ... --json conclusion,headSha,createdAt | python3 tools/e2e_gate.py <commit-sha> commit|latest
    -> green | red <sha7> | stale | none

`commit`: a human promotion needs a run of THIS build's commit. `latest`: the daily canary auto-promote cannot start a run, so the newest run stands in.
A cancelled or skipped run says nothing about the product, so it is no verdict. A green run older than two days no longer vouches for anything.
"""
import json
import sys
from datetime import datetime, timedelta, timezone

MAX_AGE = timedelta(days=2)


def verdict(runs, sha, mode, now=None):
    now = now or datetime.now(timezone.utc)
    decided = [run for run in runs if run.get('conclusion') in ('success', 'failure')]
    own = [run for run in decided if run.get('headSha') == sha]
    run = own[0] if own else (decided[0] if mode == 'latest' and decided else None)
    if run is None:
        return 'none'
    if run['conclusion'] != 'success':
        return f"red {run['headSha'][:7]}"
    if now - datetime.fromisoformat(run['createdAt'].replace('Z', '+00:00')) > MAX_AGE:
        return 'stale'
    return 'green'


if __name__ == '__main__':
    print(verdict(json.load(sys.stdin), sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'commit'))
