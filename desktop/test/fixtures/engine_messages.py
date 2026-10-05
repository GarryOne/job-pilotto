"""Every message the engine writes that the desktop window draws as a card, made by the engine's own writers (sample data in,
the text the run's Notion page holds out: cron_runs.plain flattens the Telegram HTML). Printed as JSON {name: text}.
desktop/test/engine-message-contract.test.js feeds each one to its parser, so a format change on either side fails a test."""
import json
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src import daily, digest, scout, store as job_store
from src.ai import insights, interviews, mail
from src.notion import cron_runs

out = {}
plain = cron_runs.plain

out['weekly'] = plain(insights.weekly_message({
    'headline': 'Quiet week: 2 applications', 'finding': 'Replies came from fresh jobs', 'summary': 'You sent 2 applications.',
    'worked': ['Recruiter channel: 5 of 5'], 'change': ['Send the drafted kits', 'Log salary answers'], 'focus': 'Send kits scored 60+'},
    'https://app.notion.com/p/x'))
out['insight'] = plain(insights.message({
    'headline': 'Go appears in 40% of roles', 'category': 'Skills', 'basis': 'Jobs', 'confidence': 'Medium', 'sample_size': 12,
    'evidence': ['9 of 12 postings'], 'action': 'Add Go to your CV'}))
out['kits'] = plain(daily.kits_message([
    ({'title': 'Site Reliability Engineer', 'company': 'DeepJudge AG', 'url': 'https://jobs.example.com/1'}, None),
    ({'title': 'Senior SRE (x/f/m)', 'company': 'Doctolib', 'url': 'https://jobs.example.com/2'}, None)]))
out['interview'] = plain(interviews.message({
    'company': 'Huxley', 'round': 'Recruiter screen', 'summary': 'A first call about the role and salary.',
    'strengths': ['Clear work authorisation'], 'practice': ['Prepare a principal-level narrative'], 'next_step': 'Send your updated CV.',
    'questions': [{'quality': 'weak', 'topic': 'Salary', 'better': 'State a range with reasons', 'question': 'Salary?'},
                  {'quality': 'strong', 'topic': 'Permit', 'better': '', 'question': 'Permit?'}]},
    None, 'https://app.notion.com/p/y', 0.0, stage='Interview scheduled'))
found = ({'name': 'Acme', 'tier': 'Tier 1'}, {'status': 'found', 'quality': 82, 'ats': 'greenhouse',
         'stats': {'relevant': 6, 'preferred': 2, 'places': ['Zurich', 'Remote']}})
out['scout'] = plain(scout.telegram_summary({'checked': 15, 'harvested': 0, 'queued': 4, 'total_feeds': 30, 'ideas': None},
                                            [found, ({'name': 'B', 'tier': ''}, {'status': 'none', 'quality': 0, 'ats': '', 'stats': {}})]))

# Windows will not delete a folder holding a database file that is still open: the connection is closed before the folder goes (WinError 32 broke the Windows build, 5 Oct 2026).
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
        job_store.import_watch_report(db, {'jobs': [{'company': 'Acme', 'id': '1', 'title': 'Site Reliability Engineer',
                                                     'location': 'Zurich', 'work_mode': 'Hybrid (stated)', 'url': 'https://example.test/jobs/1'}]})
        out['digest'] = plain(digest.format_digest(db)[0] if isinstance(digest.format_digest(db), tuple) else digest.format_digest(db))
    db.close()

text = lambda value: {'rich_text': [{'text': {'content': value}}]}
row = {'id': 'abc', 'url': 'https://app.notion.com/p/app', 'properties': {'Company': {'rich_text': [{'plain_text': 'Huxley', 'text': {'content': 'Huxley'}}]}, 'Job': {'title': [{'text': {'content': 'Principal SRE'}}]},
       'Next step': {'rich_text': [{'plain_text': 'Send the recruiter your updated CV.'}]}}}
event = {'summary': 'Interview with Huxley', 'hangoutLink': 'https://meet.example.com/x', 'attendees': [{'displayName': 'Sam Lee'}]}
start = datetime.fromisoformat('2026-10-06T08:30:00+02:00')
with mock.patch.object(interviews, 'stats_for_insights', return_value={'topics_answered_weakly': ['Salary expectations']}):
    out['mail_prep'] = plain(mail.prep_message(None, row, event, start, 'Tomorrow'))
scheduled = mail.tgcard.block(mail._head(row, 'Interview'), 'Tue 06 Oct · 08:30', mail.tgcard.fact('Event', 'Interview with Huxley'), mail.tgcard.fact('Source', 'Google Calendar'))
out['mail_updates'] = plain(mail.tgcard.card('Job emails & calendar', '1 update', [scheduled], emoji='📧'))
out['mail_none'] = plain(mail.tgcard.card('Gmail checked', 'No new job emails', [], emoji='📧'))
print(json.dumps(out))
