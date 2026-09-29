"""Canary auto-promote: make the newest desktop pre-release that has been out >= 48 h stable, if nothing new went wrong.

Rule (all must hold, else nothing changes):
  1. the candidate is the newest pre-release (not a draft) that is newer than the current stable and was published
     at least 48 h ago (tools/prune-releases.sh keeps that one "canary" build's release page alive);
  2. CI is green on its commit: every `build.yml` run for that commit completed with success (none = not green);
  3. no new problem was reported for it: no `telemetry` issue (any state) lists the candidate's version unless it
     also lists the current stable's version (a problem stable already has isn't new); and, when the candidate
     bundles a different Chrome extension than stable, no open `fill-failure` issue names the candidate's extension
     version but not stable's.
Promotion itself is tools/release-stable.sh <tag> (reused, not duplicated).

  python3 tools/canary_promote.py --dry-run     # print the decision and why, change nothing
  python3 tools/canary_promote.py               # promote when the rule holds (the workflow does this daily)
Reads GitHub with the `gh` CLI (GH_TOKEN in CI); needs no other secret.
"""
import argparse
import base64
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = 'GarryOne/job-pilotto'
MIN_AGE = timedelta(hours=48)
ROOT = Path(__file__).resolve().parents[1]


def version_of(tag):
    return tag[len('desktop-v'):] if tag.startswith('desktop-v') else tag


def version_key(version):
    """Sortable key for 0.4.0-alpha.42 style versions; a release (no suffix) sorts after its pre-releases."""
    core, _, pre = version.partition('-')
    nums = tuple(int(x) if x.isdigit() else 0 for x in core.split('.'))
    if not pre:
        return nums, (1,)
    return nums, (0,) + tuple((0, int(p), '') if p.isdigit() else (1, 0, p) for p in pre.split('.'))


def mentions(text, version):
    """True when `version` appears as a whole version in text (0.4.0-alpha.6 doesn't match 0.4.0-alpha.66)."""
    if not version:
        return False
    return re.search(r'(?<![\w.-])' + re.escape(version) + r'(?![\w-]|\.\w)', text or '') is not None


def parse_time(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def issue_text(issue):
    return '\n'.join([issue.get('title') or '', issue.get('body') or ''] +
                     [c.get('body') or '' for c in issue.get('comments') or []])


def pick(releases, now, min_age=MIN_AGE):
    """(candidate, stable, reason): candidate is None when there is nothing to promote yet."""
    stable = next((r for r in releases if r.get('isLatest')), None)
    stable_key = version_key(version_of(stable['tagName'])) if stable else None
    newer = [r for r in releases if r.get('isPrerelease') and not r.get('isDraft')
             and (stable is None or version_key(version_of(r['tagName'])) > stable_key)]
    if not newer:
        return None, stable, f"nothing newer than stable {stable['tagName'] if stable else '(none)'}"
    newer.sort(key=lambda r: version_key(version_of(r['tagName'])), reverse=True)
    aged = [r for r in newer if now - parse_time(r['publishedAt']) >= min_age]
    if not aged:
        oldest = min(newer, key=lambda r: parse_time(r['publishedAt']))
        hours = (now - parse_time(oldest['publishedAt'])).total_seconds() / 3600
        return None, stable, (f"no pre-release is {int(min_age.total_seconds() // 3600)} h old yet "
                              f"(oldest newer than stable: {oldest['tagName']}, {hours:.0f} h)")
    return aged[0], stable, ''


def ci_problem(runs):
    """Why CI isn't green for these build.yml runs of one commit, or '' when it is."""
    if not runs:
        return 'no CI run (build.yml) found for its commit'
    bad = [r for r in runs if r.get('status') != 'completed' or r.get('conclusion') != 'success']
    if bad:
        r = bad[0]
        return f"CI not green on its commit: build.yml {r.get('conclusion') or r.get('status')} ({r.get('html_url', '')})"
    return ''


def new_problems(version, stable_version, telemetry, fill_failures, ext_version='', stable_ext_version=''):
    """Issues that report a problem in `version` that the stable version doesn't have."""
    found = []
    for issue in telemetry:
        text = issue_text(issue)
        if mentions(text, version) and not mentions(text, stable_version):
            found.append(issue)
    if ext_version and ext_version != stable_ext_version:
        for issue in fill_failures:
            text = issue_text(issue)
            if issue.get('state', 'OPEN') == 'OPEN' and mentions(text, ext_version) and not mentions(text, stable_ext_version):
                found.append(issue)
    return found


def decide(releases, now, facts, min_age=MIN_AGE):
    """{'promote': bool, 'tag': str|None, 'reasons': [...]}. `facts` reads GitHub (fake in tests):
    ci_runs(tag), telemetry(), fill_failures(), extension_version(tag)."""
    candidate, stable, why = pick(releases, now, min_age)
    if not candidate:
        return {'promote': False, 'tag': None, 'stable': stable and stable['tagName'], 'reasons': [why]}
    tag = candidate['tagName']
    version = version_of(tag)
    stable_version = version_of(stable['tagName']) if stable else ''
    age = (now - parse_time(candidate['publishedAt'])).total_seconds() / 3600
    reasons, ok = [f"candidate {tag}: out {age:.0f} h (>= {int(min_age.total_seconds() // 3600)} h)"], True
    ci = ci_problem(facts.ci_runs(tag))
    if ci:
        ok = False
        reasons.append(ci)
    else:
        reasons.append('CI green on its commit')
    ext = facts.extension_version(tag)
    stable_ext = facts.extension_version(stable['tagName']) if stable else ''
    problems = new_problems(version, stable_version, facts.telemetry(), facts.fill_failures(), ext, stable_ext)
    if problems:
        ok = False
        reasons.append('new problems reported: ' + ', '.join(f"#{p['number']} {p.get('title', '')[:80]}" for p in problems))
    else:
        reasons.append(f"no new telemetry{' or fill-failure' if ext and ext != stable_ext else ''} problem for {version}")
    return {'promote': ok, 'tag': tag, 'stable': stable and stable['tagName'], 'reasons': reasons}


class GitHub:
    """The facts, read with the gh CLI."""

    def __init__(self, repo=REPO):
        self.repo = repo

    def _gh(self, *args):
        return subprocess.run(['gh', *args], capture_output=True, text=True, check=True).stdout

    def releases(self):
        return json.loads(self._gh('release', 'list', '-R', self.repo, '-L', '100', '--json',
                                   'tagName,isDraft,isPrerelease,isLatest,publishedAt,createdAt'))

    def ci_runs(self, tag):
        sha = self._gh('api', f'repos/{self.repo}/commits/{tag}', '-q', '.sha').strip()
        data = json.loads(self._gh('api', f'repos/{self.repo}/actions/workflows/build.yml/runs?head_sha={sha}&per_page=20'))
        return data.get('workflow_runs', [])

    def _issues(self, label, state):
        return json.loads(self._gh('issue', 'list', '-R', self.repo, '--label', label, '--state', state, '-L', '300',
                                   '--json', 'number,title,state,body,comments'))

    def telemetry(self):
        return self._issues('telemetry', 'all')

    def fill_failures(self):
        return self._issues('fill-failure', 'open')

    def extension_version(self, tag):
        try:
            data = json.loads(self._gh('api', f'repos/{self.repo}/contents/extension/manifest.json?ref={tag}'))
            return json.loads(base64.b64decode(data['content']))['version']
        except (subprocess.CalledProcessError, KeyError, ValueError):
            return ''


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--dry-run', action='store_true', help='print the decision and why; change nothing')
    parser.add_argument('--repo', default=REPO)
    args = parser.parse_args(argv)
    github = GitHub(args.repo)
    result = decide(github.releases(), datetime.now(timezone.utc), github)
    verdict = ('PROMOTE ' + result['tag']) if result['promote'] else 'WAIT (no promotion)'
    print(f"Canary auto-promote: {verdict}")
    print(f"Current stable: {result['stable'] or '(none)'}")
    for reason in result['reasons']:
        print(f"- {reason}")
    if result['promote']:
        if args.dry_run:
            print(f"Dry run: would run tools/release-stable.sh {result['tag']}")
        else:
            subprocess.run([str(ROOT / 'tools' / 'release-stable.sh'), result['tag']], check=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
