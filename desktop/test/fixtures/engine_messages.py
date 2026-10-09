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
from src.ai import insights, interviews, mail, mail_calendar
from src.stores import memory
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
out['scout'] = plain(scout.telegram_summary({'checked': 15, 'first_time': 12, 'left': 52, 'harvested': 0, 'queued': 4, 'total_feeds': 30, 'ideas': None},
                                            [found, ({'name': 'B', 'tier': ''}, {'status': 'none', 'quality': 0, 'ats': '', 'stats': {}})]))

# Windows will not delete a folder holding a database file that is still open: the connection is closed before the folder goes (WinError 32 broke the Windows build, 5 Oct 2026).
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
        job_store.import_watch_report(db, {'jobs': [{'company': 'Acme', 'id': '1', 'title': 'Site Reliability Engineer',
                                                     'location': 'Zurich', 'work_mode': 'Hybrid (stated)', 'url': 'https://example.test/jobs/1'}]})
        out['digest'] = plain(digest.format_digest(db)[0] if isinstance(digest.format_digest(db), tuple) else digest.format_digest(db))
    db.close()

text = lambda value: {'rich_text': [{'text': {'content': value}}]}
PAGE = 'https://app.notion.com/p/app'  # the job's Notion page, as the Notion store links it
event = {'summary': 'Interview with Huxley', 'hangoutLink': 'https://meet.example.com/x', 'attendees': [{'displayName': 'Sam Lee'}]}
start = datetime.fromisoformat('2026-10-06T08:30:00+02:00')
# The prep message reads the job from the active store: here a memory store with the same job, and the Notion page link it names.
prep_store = memory.open_store({})
job = prep_store.applications.create({'url': 'https://example.test/jobs/huxley', 'title': 'Principal SRE', 'company': 'Huxley',
                                      'next_step': 'Send the recruiter your updated CV.'}, 'Interview scheduled')
prep_store.link = lambda record_id: PAGE
with mock.patch.object(mail_calendar, 'interview_stats', return_value={'topics_answered_weakly': ['Salary expectations']}):
    out['mail_prep'] = plain(mail.prep_message(prep_store, job, event, start, 'Tomorrow'))
scheduled = mail.tgcard.block(mail._head(job, 'Interview'), 'Tue 06 Oct · 08:30', mail.tgcard.fact('Event', 'Interview with Huxley'), mail.tgcard.fact('Source', 'Google Calendar'))
out['mail_updates'] = plain(mail.tgcard.card('Job emails & calendar', '1 update', [scheduled], emoji='📧'))
from src.ai import rejection
outcome = mail.tgcard.block(mail._head(job, 'Rejected'), 'Application rejected after consideration')
why = rejection.line(job, {'verdict': 'Hard skills', 'confidence': 'medium', 'summary': 'Staff-level role needing a deep data background (BigQuery, Spark); your experience is SRE/platform.'})
out['mail_rejected'] = plain(mail.tgcard.card('Job emails & calendar', '2 updates', [outcome, why], emoji='📧'))
out['mail_none'] = plain(mail.tgcard.card('Gmail checked', 'No new job emails', [], emoji='📧'))
# An interview's review as the store keeps it (src/stores/notion_interviews.py: to_markdown of the page's analysis blocks): what the app's
# review dialog reads (renderer/interview-review-view.js reviewParts): each question's verdict and the call's facts with their job marks.
from src.ai import interviews_blocks
from src.stores import notion_blocks
review = {'summary': 'A friendly screen; salary came up early.', 'strengths': ['Clear on-call story'], 'weaknesses': ['Vague on Kafka'],
          'signals': ['They want someone in the office twice a week'], 'red_flags': ['No Go experience'], 'practice': ['Prepare a Kafka example'],
          'facts': [{'field': 'salary_ask', 'value': 'CHF 140k', 'quote': 'I am looking at 140'}, {'field': 'location', 'value': 'Zürich', 'quote': ''}],
          'questions': [{'quality': 'strong', 'topic': 'On-call', 'question': 'Tell me about an incident', 'answer': 'The DNS outage', 'better': ''},
                        {'quality': 'weak', 'topic': 'Kafka', 'question': 'How do you size partitions?', 'answer': 'By throughput', 'better': 'Name the consumer count'},
                        {'quality': 'not_answered', 'topic': 'Go', 'question': 'Have you shipped Go?', 'answer': '', 'better': 'Say what you would learn first'}]}
merged = {'filled': [{'field': 'salary_ask'}], 'differs': [{'field': 'location', 'current': 'Basel'}]}
out['interview_review'] = notion_blocks.to_markdown(interviews_blocks.analysis_blocks(review, merged))
print(json.dumps(out))
