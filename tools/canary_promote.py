"""Canary auto-promote: make the canary build stable once it has been out >= 48 h, if nothing new went wrong.

The canary build (canary_of, one definition shared with tools/prune-releases.sh and the app's desktop/lib/canary.js,
pinned by tests/fixtures/canary_builds.json): the oldest non-draft pre-release newer than the current stable, created
within the last 7 days. The owner's app (test builds) stays on it for its trial instead of jumping to the newest build.

Rule (all must hold, else nothing changes):
  1. the candidate is the canary build, published at least 48 h ago;
  2. CI is green on its commit: every `build.yml` run for that commit completed with success (none = not green);
  3. no new problem was reported for it: no `telemetry` issue (any state) lists the candidate's version unless it
     also lists the current stable's version (a problem stable already has isn't new); and, when the candidate
     bundles a different Chrome extension than stable, no open `fill-failure` issue names the candidate's extension
     version but not stable's;
  4. positive evidence that it was used and worked (app reports, the website's GET /telemetry/version, read with the
     key in JOB_PILOTTO_TELEMETRY_KEY = the site's STATS_KEY): silence is not health.
       used:   daily health lines from >= 1 install on that exact version on >= 2 days, first to last >= 48 h apart;
       worked: >= 5 successful pipeline runs (health runsOk) and a failure rate at most 5 points above stable's
               (stable with < 5 counted runs: at most 10 %);
       clean:  no crash and no run_failed report for that version;
       fresh:  its last report is < 24 h old.
     No key, or the site can't be read: wait (fail closed).
Promotion itself is tools/release-stable.sh <tag> (reused, not duplicated). A canary that failed for sure (red CI,
a new problem issue, a crash or run_failed report) is dropped instead: its release page is deleted (the tag stays), so
the next build becomes the canary and the owner's app moves on to it.

  python3 tools/canary_promote.py --dry-run     # print the decision, the evidence numbers and why; change nothing
  python3 tools/canary_promote.py               # promote when the rule holds (the workflow does this daily)
  gh release list --json tagName,isPrerelease,isDraft,isLatest,createdAt | python3 tools/canary_promote.py --canary
                                                # print the canary's tag (or nothing); prune-releases.sh uses it
Reads GitHub with the `gh` CLI (GH_TOKEN in CI) and app reports with JOB_PILOTTO_TELEMETRY_KEY.
"""
import argparse
import base64
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = 'GarryOne/job-pilotto'
MIN_AGE = timedelta(hours=48)
CANARY_WINDOW = timedelta(days=7)   # a canary not promoted within 7 days is dropped; the next build takes over
# Builds older than this can't pass the trial (no run counts in health reports, or no Get Test Builds in the app),
# so they are never the canary and never block newer builds. Same value as desktop/lib/canary.js CANARY_FLOOR.
CANARY_FLOOR = '0.4.0-alpha.69'
ROOT = Path(__file__).resolve().parents[1]
TELEMETRY_URL = 'https://www.jobpilotto.workers.dev/telemetry/version'
KEY_ENV = 'JOB_PILOTTO_TELEMETRY_KEY'
MIN_HEALTH_DAYS = 2              # distinct days with a health line on the candidate
MIN_USED_SPAN = timedelta(hours=48)   # first to last health line
MIN_INSTALLS = 3                 # distinct installs on the build: one tester's luck proves nothing (the old rule needed one)
MIN_RUNS_OK = 30                 # successful pipeline runs: with none failing, 30 rule out a failure rate of 10 % at 95 % confidence (rule of three)
MIN_BASELINE_RUNS = 5            # stable needs this many counted runs to be a baseline for the failure rate
RC_MIN_RUNS = 3                  # gate 4: end-to-end runs on the candidate's own commit, all green ...
RC_MIN_SPAN = timedelta(hours=24)  # ... the first and the last at least this far apart (a one-off flake or a lucky hour proves nothing)
FAILURE_MARGIN = 0.05            # candidate failure rate may exceed stable's by at most 5 points
MAX_FAILURE_NO_BASELINE = 0.10   # stable with fewer than MIN_RUNS_OK counted runs: an absolute ceiling
MAX_SILENCE = timedelta(hours=24)  # its last report


class EvidenceUnavailable(Exception):
    """The app reports couldn't be read: no key, or the site didn't answer."""


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


def _newer_than_stable(releases):
    stable = next((r for r in releases if r.get('isLatest')), None)
    stable_key = version_key(version_of(stable['tagName'])) if stable else None
    return stable, [r for r in releases if r.get('isPrerelease') and not r.get('isDraft')
                    and (stable is None or version_key(version_of(r['tagName'])) > stable_key)]


def canary_of(releases, now, window=CANARY_WINDOW, floor=CANARY_FLOOR):
    """The canary build: the oldest non-draft pre-release newer than the current stable, created within `window`,
    and not older than `floor` (builds that can't pass the trial never block newer ones).
    Same rule as desktop/lib/canary.js canaryOf (tests/fixtures/canary_builds.json pins both). None when there is none."""
    _, newer = _newer_than_stable(releases)
    recent = [r for r in newer if now - parse_time(r['createdAt']) < window
              and (not floor or version_key(version_of(r['tagName'])) >= version_key(floor))]
    return min(recent, key=lambda r: version_key(version_of(r['tagName'])), default=None)


def pick(releases, now, min_age=MIN_AGE):
    """(candidate, stable, reason): candidate is the canary once it is `min_age` old, else None and why."""
    stable, newer = _newer_than_stable(releases)
    if not newer:
        return None, stable, f"nothing newer than stable {stable['tagName'] if stable else '(none)'}"
    candidate = canary_of(releases, now)
    if not candidate:
        return None, stable, (f"no canary: every build newer than stable is over {CANARY_WINDOW.days} days old "
                                     f"or older than {CANARY_FLOOR} (can't pass the trial)")
    age = now - parse_time(candidate.get('publishedAt') or candidate['createdAt'])
    if age < min_age:
        return None, stable, (f"canary {candidate['tagName']} is {age.total_seconds() / 3600:.0f} h old "
                              f"(needs {int(min_age.total_seconds() // 3600)} h)")
    return candidate, stable, ''


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


def _rate(runs):
    total = (runs.get('ok') or 0) + (runs.get('failed') or 0)
    return (runs.get('failed') or 0) / total if total else 0.0


def usage_problems(candidate, stable, now):
    """(problems, summary): why the candidate's app reports aren't positive evidence yet ([] = they are), and one
    line of the numbers. `candidate`/`stable` are GET /telemetry/version entries (stable may be None)."""
    c = candidate or {}
    runs = c.get('runs') or {}
    events = c.get('events') or {}
    first, last = c.get('healthFirst'), c.get('healthLast')
    span = (parse_time(last) - parse_time(first)) if first and last else timedelta(0)
    seen = c.get('lastSeen') or last
    silent = (now - parse_time(seen)) if seen else None
    rate = _rate(runs)
    s_runs = (stable or {}).get('runs') or {}
    s_total = (s_runs.get('ok') or 0) + (s_runs.get('failed') or 0)
    baseline = s_total >= MIN_BASELINE_RUNS
    limit = _rate(s_runs) + FAILURE_MARGIN if baseline else MAX_FAILURE_NO_BASELINE
    summary = (f"app reports: {c.get('healthInstalls', 0)} install(s), health on {c.get('healthDays', 0)} day(s) over "
               f"{span.total_seconds() / 3600:.0f} h, runs {runs.get('ok', 0)} ok / {runs.get('failed', 0)} failed "
               f"({rate:.0%}; limit {limit:.0%}, stable {_rate(s_runs):.0%} of {s_total}), "
               f"crash {events.get('crash', 0)}, run_failed {events.get('run_failed', 0)}, "
               f"stuck {events.get('stuck', 0)}, form_issue {events.get('form_issue', 0)}, "
               f"last report {f'{silent.total_seconds() / 3600:.0f} h ago' if silent is not None else 'never'}")
    problems = []
    if (c.get('healthInstalls') or 0) < MIN_INSTALLS or (c.get('healthDays') or 0) < MIN_HEALTH_DAYS or span < MIN_USED_SPAN:
        problems.append(f"not used enough: needs >= {MIN_INSTALLS} installs with health reports on >= {MIN_HEALTH_DAYS} days spanning "
                        f">= {int(MIN_USED_SPAN.total_seconds() // 3600)} h")
    if (runs.get('ok') or 0) < MIN_RUNS_OK:
        problems.append(f"too few successful runs: {runs.get('ok') or 0} < {MIN_RUNS_OK}")
    elif rate > limit:
        problems.append(f"failure rate {rate:.0%} above {limit:.0%} "
                        f"({'stable ' + format(_rate(s_runs), '.0%') + ' + 5 points' if baseline else 'no stable baseline'})")
    if events.get('crash') or events.get('run_failed'):
        problems.append(f"problem reports for it: {events.get('crash', 0)} crash, {events.get('run_failed', 0)} run_failed")
    if silent is None or silent > MAX_SILENCE:
        problems.append(f"not fresh: no report in the last {int(MAX_SILENCE.total_seconds() // 3600)} h")
    return problems, summary


# Problems about the evidence being thin (nobody ran it yet) versus about it being bad (it ran and went wrong): only the second always blocks.
BAD_EVIDENCE = ('problem reports for it', 'failure rate')


def rc_problems(runs, blockers, sha7, now):
    """Gate 4: why the candidate's own end-to-end runs aren't enough yet ([] = they are).
    `runs`: completed e2e.yml runs on its commit, newest first ({conclusion, createdAt}); cancelled/skipped say nothing.
    `blockers`: open `auto-ui` issues of severity high (any text naming this commit as the build tested)."""
    decided = [r for r in runs if r.get('conclusion') in ('success', 'failure')]
    problems = []
    for issue in blockers:
        problems.append(f"open high-severity finding #{issue['number']} on this build: {issue.get('title', '')[:80]}")
    if any(r['conclusion'] == 'failure' for r in decided[:RC_MIN_RUNS]):
        problems.append(f"end-to-end red in one of its last {RC_MIN_RUNS} runs on commit {sha7}")
    greens = [r for r in decided if r['conclusion'] == 'success']
    if len(greens) < RC_MIN_RUNS:
        problems.append(f"end-to-end ran green {len(greens)} time(s) on commit {sha7}, needs {RC_MIN_RUNS}")
    elif parse_time(greens[0]['createdAt']) - parse_time(greens[-1]['createdAt']) < RC_MIN_SPAN:
        problems.append(f"its green end-to-end runs span under {int(RC_MIN_SPAN.total_seconds() // 3600)} h")
    return problems


def blocking_findings(issues, sha7):
    """The open high-severity UI-loop issues whose text (body or a 'Build tested' comment) names this commit."""
    return [i for i in issues if i.get('state', 'OPEN') == 'OPEN' and f'@ {sha7}' in issue_text(i)
            and any((l.get('name') if isinstance(l, dict) else l) == 'severity:high' for l in i.get('labels') or [])]


def decide(releases, now, facts, min_age=MIN_AGE, require_beta=True):
    """{'promote': bool, 'tag': str|None, 'reasons': [...]}. `facts` reads GitHub (fake in tests):
    ci_runs(tag), e2e_runs(tag), blocking_issues(tag), telemetry(), fill_failures(), extension_version(tag), usage(version, stable_version).
    require_beta=False (no opt-in testers exist yet): thin app evidence is noted, not blocking; a crash, a failed run or a worse failure rate still block."""
    candidate, stable, why = pick(releases, now, min_age)
    if not candidate:
        return {'promote': False, 'tag': None, 'stable': stable and stable['tagName'], 'reasons': [why]}
    tag = candidate['tagName']
    version = version_of(tag)
    stable_version = version_of(stable['tagName']) if stable else ''
    age = (now - parse_time(candidate['publishedAt'])).total_seconds() / 3600
    reasons, ok = [f"candidate {tag}: out {age:.0f} h (>= {int(min_age.total_seconds() // 3600)} h)"], True
    runs = facts.ci_runs(tag)
    ci = ci_problem(runs)
    blocked = any(r.get('status') == 'completed' and r.get('conclusion') not in ('success', 'skipped', 'cancelled')
                  for r in runs)
    if ci:
        ok = False
        reasons.append(ci)
    else:
        reasons.append('CI green on its commit')
    sha7 = facts.sha(tag)[:7]
    rc = rc_problems(facts.e2e_runs(tag), blocking_findings(facts.blocking_issues(), sha7), sha7, now)
    if rc:
        ok = False
        reasons.extend(f"not proven yet: {why}" for why in rc)
    else:
        reasons.append(f"end-to-end green >= {RC_MIN_RUNS} times over >= {int(RC_MIN_SPAN.total_seconds() // 3600)} h on its commit, no open high-severity finding")
    ext = facts.extension_version(tag)
    stable_ext = facts.extension_version(stable['tagName']) if stable else ''
    problems = new_problems(version, stable_version, facts.telemetry(), facts.fill_failures(), ext, stable_ext)
    if problems:
        ok, blocked = False, True
        reasons.append('new problems reported: ' + ', '.join(f"#{p['number']} {p.get('title', '')[:80]}" for p in problems))
    else:
        reasons.append(f"no new telemetry{' or fill-failure' if ext and ext != stable_ext else ''} problem for {version}")
    try:
        usage = facts.usage(version, stable_version)
    except EvidenceUnavailable as error:
        if require_beta:
            ok = False
            reasons.append(f"no usage evidence: {error}")
        else:
            reasons.append(f"no usage evidence ({error}); not required while there are no beta testers")
    else:
        missing, summary = usage_problems(usage.get(version), usage.get(stable_version), now)
        events = (usage.get(version) or {}).get('events') or {}
        blocked = blocked or bool(events.get('crash') or events.get('run_failed'))
        reasons.append(summary)
        if not require_beta:
            thin = [why for why in missing if not why.startswith(BAD_EVIDENCE)]
            missing = [why for why in missing if why.startswith(BAD_EVIDENCE)]
            reasons.extend(f"thin app evidence, not required while there are no beta testers: {why}" for why in thin)
        if missing:
            ok = False
            reasons.extend(f"not proven yet: {why}" for why in missing)
        else:
            reasons.append('used and healthy for 48 h (app reports)')
    if blocked:
        reasons.append('failed for sure: drop this canary (release page deleted, tag kept), the next build takes over')
    return {'promote': ok, 'blocked': blocked, 'tag': tag, 'stable': stable and stable['tagName'], 'reasons': reasons}


class GitHub:
    """The facts, read with the gh CLI."""

    def __init__(self, repo=REPO, key=None, url=TELEMETRY_URL):
        self.repo, self.key, self.url = repo, key, url

    def _gh(self, *args):
        return subprocess.run(['gh', *args], capture_output=True, text=True, check=True).stdout

    def releases(self):
        return json.loads(self._gh('release', 'list', '-R', self.repo, '-L', '100', '--json',
                                   'tagName,isDraft,isPrerelease,isLatest,publishedAt,createdAt'))

    def ci_runs(self, tag):
        sha = self._gh('api', f'repos/{self.repo}/commits/{tag}', '-q', '.sha').strip()
        data = json.loads(self._gh('api', f'repos/{self.repo}/actions/workflows/build.yml/runs?head_sha={sha}&per_page=20'))
        return data.get('workflow_runs', [])

    def sha(self, tag):
        return self._gh('api', f'repos/{self.repo}/commits/{tag}', '-q', '.sha').strip()

    def e2e_runs(self, tag):
        """Completed end-to-end runs on the tag's commit, newest first (the gate's own, the soak's top-ups, scheduled ones on main at that commit)."""
        data = json.loads(self._gh('api', f'repos/{self.repo}/actions/workflows/e2e.yml/runs?head_sha={self.sha(tag)}&status=completed&per_page=30'))
        return [{'conclusion': r.get('conclusion'), 'createdAt': r['created_at']} for r in data.get('workflow_runs', [])]

    def blocking_issues(self):
        return json.loads(self._gh('issue', 'list', '-R', self.repo, '--label', 'auto-ui', '--label', 'severity:high', '--state', 'open', '-L', '300',
                                   '--json', 'number,title,state,body,comments,labels'))

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

    def usage(self, version, stable_version):
        """The website's app-report evidence for both versions (GET /telemetry/version, key as a Bearer header)."""
        if not self.key:
            raise EvidenceUnavailable(f'{KEY_ENV} is not set (the site\'s stats key), so usage can\'t be checked')
        query = {'v': version, **({'compare': stable_version} if stable_version else {})}
        request = urllib.request.Request(f'{self.url}?{urllib.parse.urlencode(query)}', headers={
            'Authorization': f'Bearer {self.key}', 'User-Agent': 'job-pilotto-canary', 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.loads(response.read())
        except urllib.error.HTTPError as error:
            raise EvidenceUnavailable(f'app reports answered HTTP {error.code}'
                                      + (' (wrong key, or the endpoint isn\'t deployed yet)' if error.code == 404 else ''))
        except (urllib.error.URLError, OSError, ValueError) as error:
            raise EvidenceUnavailable(f'app reports unreachable: {error}')
        if not data.get('ok') or not isinstance(data.get('versions'), dict):
            raise EvidenceUnavailable(f"app reports gave no data: {data.get('error', 'unexpected answer')}")
        return data['versions']


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--dry-run', action='store_true', help='print the decision and why; change nothing')
    parser.add_argument('--repo', default=REPO)
    parser.add_argument('--candidate', action='store_true', help="print the canary build's tag at any age (empty when none), for the workflow's end-to-end top-up runs")
    parser.add_argument('--canary', action='store_true',
                        help="read `gh release list --json tagName,isPrerelease,isDraft,isLatest,createdAt` on stdin, "
                             "print the canary build's tag (empty when none)")
    args = parser.parse_args(argv)
    if args.canary:
        found = canary_of(json.load(sys.stdin), datetime.now(timezone.utc))
        print(found['tagName'] if found else '')
        return 0
    if args.candidate:
        found = canary_of(GitHub(args.repo).releases(), datetime.now(timezone.utc))
        print(found['tagName'] if found else '')
        return 0
    github = GitHub(args.repo, key=os.environ.get(KEY_ENV, '').strip() or None)
    result = decide(github.releases(), datetime.now(timezone.utc), github, require_beta=os.environ.get('JOB_PILOTTO_REQUIRE_BETA', '') == 'on')
    verdict = ('PROMOTE ' + result['tag']) if result['promote'] else 'WAIT (no promotion)'
    print(f"Canary auto-promote: {verdict}")
    print(f"Current stable: {result['stable'] or '(none)'}")
    for reason in result['reasons']:
        print(f"- {reason}")
    if result['promote']:
        if args.dry_run:
            print(f"Dry run: would run tools/release-stable.sh {result['tag']}")
        else:
            subprocess.run([str(ROOT / 'tools' / 'release-stable.sh'), result['tag']], check=True, env={**os.environ, 'E2E_NO_START': '1'})   # it cannot start a run, nor wait 15 minutes for one
    elif result.get('blocked'):
        if args.dry_run:
            print(f"Dry run: would drop the canary {result['tag']} (gh release delete, tag kept)")
        else:
            subprocess.run(['gh', 'release', 'delete', result['tag'], '-R', args.repo, '--yes'], check=True)
            print(f"Dropped the canary {result['tag']}: the next build is the canary now")
    return 0


if __name__ == '__main__':
    sys.exit(main())
