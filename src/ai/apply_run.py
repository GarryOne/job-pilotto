"""Run one observable Codex browser fill and record its review handoff.

The trace and result may contain applicant data. They are stored only in a private directory
outside the repository. This runner audits Codex's report; it is not a browser security boundary.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse

from .kit import KIT_HEADING
from ..notion.client import DEFAULT_DATABASE_ID, Tracker, job_code

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / 'tools' / 'apply-run-result.schema.json'
GUARD = ROOT / 'tools' / 'browser-submit-guard.js'
FASTPATH = ROOT / 'tools' / 'browser-form-fastpath.js'
STATE_DIR = Path(os.getenv('JOB_PILOTTO_APPLY_RUN_DIR',
                           str(Path.home() / 'Library' / 'Application Support' / 'JobPilotto' / 'apply-runs')))
TIMEOUT = 45 * 60


def _private_dir(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.chmod(0o700)


def _write_json(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(data, stream, indent=2)
        stream.write('\n')


def _read_json(path):
    return json.loads(path.read_text()) if path.exists() else None


def _duration(intervals, started, ended):
    spans = []
    for interval in intervals:
        a = datetime.fromisoformat(interval['start'].replace('Z', '+00:00'))
        b = datetime.fromisoformat(interval['end'].replace('Z', '+00:00'))
        if a.tzinfo is None or b.tzinfo is None or not started <= a <= b <= ended:
            raise ValueError('invalid active fill interval')
        spans.append((a, b))
    spans.sort()
    if not spans or any(spans[i][0] < spans[i - 1][1] for i in range(1, len(spans))):
        raise ValueError('missing or overlapping active fill intervals')
    return round(sum((b - a).total_seconds() for a, b in spans) / 60, 2)


def audit(result, url, started, ended):
    """Accept only an explicit, complete, browser-checked handoff."""
    if result.get('status') != 'ready':
        unanswered = result.get('unanswered') or []
        if unanswered:
            return 'needs_user', None, 'owner input needed: ' + '; '.join(unanswered)[:300]
        return result.get('status', 'failed'), None, 'agent did not report a review-ready form'
    actual = urlparse(result.get('page_url', ''))
    if actual.scheme != 'https' or not actual.hostname:
        return 'needs_user', None, 'missing HTTPS browser form URL'
    checks = result.get('checks') or {}
    if not all(checks.get(k) is True for k in ('submit_untouched',
               'legal_acknowledgments_untouched', 'browser_form_inspected', 'guard_active')):
        return 'needs_user', None, 'submission, legal, or browser check missing'
    fields = result.get('fields') or []
    if not fields or result.get('form_field_count') != len(fields) or any(
                         not f.get('observed') or not f.get('matches_source') or not f.get('source')
                         for f in fields):
        return 'needs_user', None, 'field audit incomplete or mismatched'
    attachments = result.get('attachments') or []
    if not attachments or not any('resume' in a.get('label', '').lower() and a.get('present')
                                  for a in attachments):
        return 'needs_user', None, 'resume attachment was not verified'
    if result.get('unanswered') or any(not a.get('present') for a in attachments):
        return 'needs_user', None, 'unanswered fields or missing attachments'
    try:
        minutes = _duration(result.get('fill_intervals', []), started, ended)
    except (ValueError, TypeError, KeyError):
        return 'needs_user', None, 'active fill intervals invalid'
    return 'ready', minutes, ''


def _prompt(url):
    return (f'Read AGENTS.md and .claude/skills/apply-to-job/SKILL.md. Fill the application at {url} '
            'using its Notion kit, saved Profile/Application Answers, and CV. Use the Playwright MCP '
            'Chrome extension. Open a NEW browser tab for the job so the init-script guard loads. '
            'Before filling, verify window.__jobPilottoGuardActive is true; if not, stop and report '
            'failed. For plain text and static select fields, call window.__jobPilottoFillKnownFields '
            'with exact field IDs/names and sourced values in one browser evaluation, then use '
            'window.__jobPilottoAuditVisibleFields to identify gaps. Use your judgment only for '
            'skipped or unfamiliar widgets and questions. Never click Submit/Apply/Send, never '
            'unlock the guard, never check legal acknowledgments, '
            'never create an account, and leave unknown facts blank. Stop before submission. '
            'Inspect the actual rendered browser form after filling. Count every visible non-legal '
            'input as form_field_count and include each in fields. Compare every populated field '
            'against its source, check attachments, and list unanswered fields. Report only field '
            'labels and source names, not applicant values, in the structured result. The page_url '
            'must be the actual browser form URL. Record ISO-8601 intervals of your active form work '
            'only; exclude waiting for the user, setup, and any review pause. If any necessary fact '
            'or attestation is missing, status must be needs_user. Keep the browser tab open for '
            'the owner. Your final response must conform to the supplied output schema.')


def _mark(tracker, url, next_step, minutes=None):
    row = tracker.find(url)
    if not row:
        raise RuntimeError(f'No Applications row for {url}')
    props = {'Next step': {'rich_text': [{'text': {'content': next_step[:2000]}}]}}
    if minutes is not None:
        props['Form fill time (min)'] = {'number': minutes}
    tracker.update_page(row['id'], props)


def _essential_checks(kit):
    """Checks that need a personal eligibility answer before browser work starts."""
    words = ('eligib', 'sponsor', 'authoriz', 'work permit', 'visa', 'relocat',
             'required language', 'right to work')
    return [item for item in kit.get('check_before_sending', [])
            if any(word in item.casefold() for word in words)]


def _tracker():
    tracker = Tracker.from_env()
    if tracker:
        return tracker
    if sys.platform != 'darwin':
        return None
    secret = subprocess.run(['security', 'find-generic-password', '-a', os.getenv('USER', ''),
                             '-s', 'job-pilotto.notion.token', '-w'], capture_output=True,
                            text=True, check=False)
    token = secret.stdout.strip() if secret.returncode == 0 else ''
    return Tracker(token, os.getenv('NOTION_APPLICATIONS_DB') or DEFAULT_DATABASE_ID) if token else None


def run(url, tracker, *, codex=None, timeout=TIMEOUT):
    if urlparse(url).scheme != 'https':
        raise ValueError('An HTTPS job URL is required')
    _private_dir(STATE_DIR)
    state_path = STATE_DIR / f'{job_code(url)}.json'
    prior = _read_json(state_path)
    if prior and prior.get('status') == 'running':
        age = datetime.now(timezone.utc) - datetime.fromisoformat(prior['updated_at'])
        if age.total_seconds() >= 2 * 3600:
            prior['status'] = 'stale'
            prior['reason'] = 'run stopped reporting; inspect browser and trace before retrying'
            _write_json(state_path, prior)
    if prior and prior.get('status') in ('running', 'ready'):
        raise RuntimeError(f"Existing {prior['status']} run for this URL; inspect {state_path} first")
    row = tracker.find(url)
    if not row:
        raise RuntimeError('Prepare and save an application kit before starting a browser run')
    stage = (row['properties'].get('Stage', {}).get('select') or {}).get('name')
    if stage not in ('Saved', 'Applying'):
        raise RuntimeError(f'Cannot start a browser run for Stage {stage}')
    kit = tracker.read_kit(row['id'], KIT_HEADING)
    if not kit:
        raise RuntimeError('No application kit found for this job')
    tracker.mark({'url': url}, 'Applying')
    started = datetime.now(timezone.utc)
    state = {'url': url, 'status': 'running', 'started_at': started.isoformat(), 'updated_at': started.isoformat()}
    _write_json(state_path, state)
    checks = _essential_checks(kit)
    if checks:
        reason = 'owner input needed: ' + '; '.join(checks)[:300]
        state.update(status='needs_user', reason=reason)
        _write_json(state_path, state)
        _mark(tracker, url, reason)
        return state
    trace_path = STATE_DIR / f'{job_code(url)}.jsonl'
    result_path = STATE_DIR / f'{job_code(url)}.result.json'
    result_path.unlink(missing_ok=True)
    codex = codex or os.getenv('JOB_PILOTTO_CODEX_BIN', 'codex')
    npx = os.getenv('JOB_PILOTTO_NPX_BIN', 'npx')
    command = [codex, 'exec', '--json', '--output-schema', str(SCHEMA),
               '--output-last-message', str(result_path), '-C', str(ROOT),
               '-c', f'mcp_servers.playwright.command={json.dumps(npx)}',
               '-c', f'mcp_servers.playwright.args={json.dumps(["-y", "@playwright/mcp@0.0.82", "--extension", "--init-script", str(GUARD), "--init-script", str(FASTPATH)])}',
               _prompt(url)]
    try:
        agent_env = os.environ.copy()
        agent_env.pop('NOTION_TOKEN', None)
        with open(trace_path, 'w', opener=lambda p, f: os.open(p, f, 0o600)) as trace:
            completed = subprocess.run(command, cwd=ROOT, stdout=trace, stderr=subprocess.PIPE,
                                       text=True, timeout=timeout, check=False, env=agent_env)
        ended = datetime.now(timezone.utc)
        if completed.returncode:
            raise RuntimeError(f'Codex exited {completed.returncode}: {completed.stderr[-500:]}')
        result = _read_json(result_path)
        if not isinstance(result, dict):
            raise RuntimeError('Codex returned no structured result')
        status, minutes, reason = audit(result, url, started, ended)
        state.update(status=status, updated_at=ended.isoformat(), minutes=minutes,
                     reason=reason, field_count=len(result.get('fields', [])),
                     unanswered=result.get('unanswered', []), summary=result.get('summary', ''))
        _write_json(state_path, state)
        if status == 'ready':
            _mark(tracker, url, 'Ready for review — inspect the browser form and submit yourself', minutes)
        else:
            _mark(tracker, url, f'Form needs review: {reason or status}')
        return state
    except Exception as error:
        state.update(status='failed', updated_at=datetime.now(timezone.utc).isoformat(),
                     reason=str(error)[:500])
        _write_json(state_path, state)
        _mark(tracker, url, 'Browser run failed — inspect local run log before retrying')
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', nargs='?')
    parser.add_argument('--status', action='store_true', help='show saved run states')
    parser.add_argument('--report', metavar='URL', help='show field and attachment audit for one job')
    parser.add_argument('--reconcile', metavar='URL',
                        help='re-audit a completed local result and update its Notion Next step')
    parser.add_argument('--expire-hours', type=float, default=2,
                        help='mark running records older than this as stale when listing status')
    args = parser.parse_args(argv)
    if args.report:
        state = _read_json(STATE_DIR / f'{job_code(args.report)}.json')
        result = _read_json(STATE_DIR / f'{job_code(args.report)}.result.json')
        if not state or not result or state.get('url') != args.report:
            parser.error('no completed report for that job URL')
        print(f"{state['status']}: {args.report} ({state.get('minutes')} active minutes)")
        for field in result.get('fields', []):
            mark = '✓' if field.get('observed') and field.get('matches_source') else 'CHECK'
            print(f"  {mark} {field.get('label', '?')} — source: {field.get('source', '?')}")
        for item in result.get('attachments', []):
            print(f"  {'✓' if item.get('present') else 'CHECK'} attachment: {item.get('label', '?')}")
        for item in result.get('unanswered', []):
            print(f'  CHECK unanswered: {item}')
        return 0
    if args.reconcile:
        url = args.reconcile
        state_path = STATE_DIR / f'{job_code(url)}.json'
        state = _read_json(state_path)
        result = _read_json(STATE_DIR / f'{job_code(url)}.result.json')
        if not state or not result or state.get('url') != url:
            parser.error('no completed run for that URL')
        started = datetime.fromisoformat(state['started_at'])
        ended = datetime.fromisoformat(state['updated_at'])
        status, minutes, reason = audit(result, url, started, ended)
        state.update(status=status, minutes=minutes, reason=reason)
        tracker = _tracker()
        if not tracker:
            parser.error('NOTION_TOKEN is required')
        if status == 'ready':
            _mark(tracker, url, 'Ready for review — inspect the browser form and submit yourself', minutes)
        else:
            _mark(tracker, url, f'Form needs review: {reason or status}')
        _write_json(state_path, state)
        print(f'{status}: {url} — {reason}')
        return 0
    if args.status:
        _private_dir(STATE_DIR)
        now = datetime.now(timezone.utc)
        for path in sorted(STATE_DIR.glob('*.json')):
            if path.name.endswith('.result.json'):
                continue
            state = _read_json(path)
            if state.get('status') == 'running':
                age = (now - datetime.fromisoformat(state['updated_at'])).total_seconds() / 3600
                if age >= args.expire_hours:
                    state['status'] = 'stale'
                    state['reason'] = 'run stopped reporting; inspect trace and browser before retrying'
                    _write_json(path, state)
            print(f"{state['status']}: {state['url']} — {state.get('reason', '')}")
        return 0
    if not args.url:
        parser.error('provide a job URL or --status')
    tracker = _tracker()
    if not tracker:
        parser.error('NOTION_TOKEN is required')
    state = run(args.url, tracker)
    print(f"{state['status']}: {args.url} — {state.get('reason') or state.get('summary', '')}")
    return 0 if state['status'] == 'ready' else 1


if __name__ == '__main__':
    sys.exit(main())
