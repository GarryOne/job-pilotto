"""The 💡 Insights records the Reports page reads (insights.list), made by the engine's own writers with fictional data: a weekly
report (its body: src/ai/insights_text.weekly_blocks through the Notion codec), a process issue (src/ai/learning.publish) and a daily
insight (src/ai/insights.record). Printed as a JSON list, newest first. desktop/test/reports-view.test.js reads them, and
desktop/demo/reports.json is this output, so a writer's format change fails a test."""
import json
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src.ai import insights, insights_text, learning
from src.stores.notion_blocks import to_markdown


class Insights:
    def __init__(self):
        self.rows = []

    def add(self, record):
        self.rows.append({'id': f'ins-{len(self.rows) + 1}', 'created_at': '', **record, 'fields': record.get('fields') or {},
                          'body': record.get('body') or ''})
        return self.rows[-1]


class Stores:
    insights = Insights()


stores = Stores()
daily = insights.record({'category': 'Timing', 'headline': 'Replies come within 2 days of applying', 'basis': 'Applications',
                         'confidence': 'Low', 'sample_size': 10, 'evidence': ['6 of 7 replies within 2 days', '7 of 10 got a reply'],
                         'action': 'No reply after 3 days: treat it as a silent no and move on'}, date(2026, 10, 6), 'claude-sonnet-5-5', 0.01)
daily['fields']['feedback'] = 'Useful'
stores.insights.add(daily)
stores.insights.add(insights.record({'category': 'Skills', 'headline': 'Go appears in 40% of your best-fit jobs', 'basis': 'Jobs',
                                     'confidence': 'Medium', 'sample_size': 25, 'evidence': ['10 of 25 postings name Go'],
                                     'action': 'Add the Go service you ran to your CV'}, date(2026, 10, 7), 'claude-sonnet-5-5', 0.01))
issue = {'issue': 'Rejections cite missing Kubernetes depth', 'action': 'Lead the CV with the cluster you ran', 'applications': 3, 'employers': 2,
         'source_types': ['employer feedback', 'interview review'],
         'sources': [{'company': 'Example Cloud', 'role': 'SRE', 'source_type': 'employer feedback', 'url': 'https://jobs.example.com/1'},
                     {'company': 'Alpine Data', 'role': 'Platform Engineer', 'source_type': 'interview review', 'url': 'https://jobs.example.com/3'}],
         'support': [{'quote': 'We need deeper Kubernetes operations'}, {'quote': 'Asked twice about cluster upgrades'}]}
learning.publish(stores, [issue], datetime(2026, 10, 8), 'claude-sonnet-5-5')
report = {'headline': 'Quiet week: 2 applications, 1 interview', 'finding': 'Replies came only from jobs posted under 3 days ago',
          'summary': 'You sent 2 applications and had a first interview.', 'issues': [issue], 'worked': ['The recruiter channel: 2 of 2 replied'],
          'change': ['Send the 5 drafted kits', 'Apply within 3 days of posting'], 'focus': 'Five applications to fresh postings', 'confidence': 'Medium'}
stats = {'applications': {'applications': 12, 'applied_last_7_days': 2, 'outcomes': {'Rejected': 3}, 'interview_rate_of_decided': '25%'},
         'week': {'event_counts': {'Replied': 2}, 'insights_last_7_days': [{'date': '2026-10-06', 'category': 'Timing',
                  'headline': 'Replies come within 2 days of applying', 'feedback': 'Useful'}]},
         'market': {'open_jobs': 214, 'eligible': 120, 'language_blocked': 9, 'new_last_7_days': 31,
                    'technologies_in_good_fit_jobs': [{'tech': 'Kubernetes', 'jobs': 40, 'in_profile': True}, {'tech': 'Go', 'jobs': 10, 'in_profile': False}]}}
stores.insights.add({'day': '2026-10-09', 'category': insights.WEEKLY, 'title': report['headline'],
                     'body': to_markdown(insights_text.weekly_blocks(report, stats)),
                     'fields': {'basis': 'Both', 'confidence': report['confidence'], 'sample_size': 12, 'evidence': report['summary'],
                                'action': report['focus'], 'cost': 0.03, 'model': 'claude-sonnet-5-5'}})
print(json.dumps(list(reversed(stores.insights.rows)), ensure_ascii=False, indent=1))
