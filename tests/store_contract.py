"""The store contract: what every adapter (memory, sqlite, notion, any later one) must do, as one test mixin.

An adapter's own test file subclasses it with `make()` returning a fresh, empty `Stores`:
    class SqliteStoreTests(StoreContract, unittest.TestCase):
        def make(self): return sqlite.open_store({...a temp folder...})
Spec: docs/superpowers/specs/2026-10-09-store-adapters.md. Not a test file itself (no test_ prefix).
"""
import inspect

from src.stores import base

JOB = {'url': 'https://jobs.example.com/sre-1', 'title': 'Senior SRE', 'company': 'Acme', 'location': 'Zurich'}


class StoreContract:
    def make(self):
        raise NotImplementedError

    def setUp(self):
        self.s = self.make()

    def assertRecord(self, row, fields):
        self.assertEqual(set(row), set(fields), 'a record has exactly its fields')

    def test_every_method_takes_the_interfaces_parameter_names(self):
        """Callers (and `python -m src.stores call`) pass arguments by name: an adapter must use the same ones."""
        for entity in ('applications', 'events', 'matches', 'interviews', 'insights', 'employers', 'agent_runs',
                       'cron_runs', 'texts'):
            protocol = getattr(base, ''.join(part.title() for part in entity.split('_')))
            for name, method in vars(protocol).items():
                if name.startswith('_') or not callable(method):
                    continue
                want = [p for p in inspect.signature(method).parameters if p != 'self']
                have = getattr(getattr(self.s, entity), name, None)
                self.assertIsNotNone(have, f'{entity}.{name} is missing')
                self.assertEqual([p for p in inspect.signature(have).parameters], want, f'{entity}.{name}')

    # Applications

    def test_an_application_is_created_found_by_any_url_form_and_listed(self):
        row = self.s.applications.create(JOB, 'Saved')
        self.assertRecord(row, base.APPLICATION_FIELDS)
        self.assertTrue(row['id'])
        self.assertTrue(row['created_at'])
        self.assertEqual(row['stage'], 'Saved')
        self.assertEqual(self.s.applications.get(JOB['url'] + '/')['id'], row['id'])
        self.assertIsNone(self.s.applications.get('https://jobs.example.com/other'))
        self.assertEqual([r['id'] for r in self.s.applications.list()], [row['id']])
        self.assertEqual(self.s.applications.list(stages=['Applied']), [])

    def test_creating_the_same_job_twice_keeps_one_row(self):
        self.s.applications.create(JOB, 'Saved')
        self.s.applications.create({**JOB, 'url': JOB['url'] + '/'}, 'Saved')
        self.assertEqual(len(self.s.applications.list()), 1)

    def test_set_stage_creates_changes_then_writes_nothing(self):
        row, outcome = self.s.applications.set_stage(JOB, 'Saved')
        self.assertEqual(outcome, base.CREATED)
        row, outcome = self.s.applications.set_stage(JOB, 'Applied', today='2026-10-09')
        self.assertEqual((outcome, row['stage'], row['applied_on']), (base.CHANGED, 'Applied', '2026-10-09'))
        row, outcome = self.s.applications.set_stage(JOB, 'Applied', today='2026-10-10')
        self.assertEqual((outcome, row['applied_on']), (base.UNCHANGED, '2026-10-09'))
        self.assertEqual(self.s.applications.stages(), {base.url_key(JOB['url']): 'Applied'})

    def test_update_changes_only_the_given_fields_and_refuses_unknown_ones(self):
        row = self.s.applications.create(JOB, 'Saved')
        row = self.s.applications.update(row['id'], {'next_step': 'Call Anna', 'fit': 82})
        self.assertEqual((row['next_step'], row['fit'], row['title']), ('Call Anna', 82, 'Senior SRE'))
        with self.assertRaises(KeyError):
            self.s.applications.update(row['id'], {'no such field': 1})
        with self.assertRaises(KeyError):
            self.s.applications.update('missing', {'notes': 'x'})

    def test_updated_at_is_stamped_on_every_change_and_never_taken_from_the_caller(self):
        row = self.s.applications.create(JOB, 'Saved')
        self.assertTrue(row['updated_at'] >= row['created_at'][:19], row)
        for changed in (self.s.applications.update(row['id'], {'notes': 'x', 'updated_at': '2001-01-01T00:00:00+00:00'}),
                        self.s.applications.set_stage(JOB, 'Applied')[0], self.s.applications.get(JOB['url'])):
            self.assertTrue(changed['updated_at'] >= row['updated_at'][:19], changed)
            self.assertNotEqual(changed['updated_at'][:4], '2001')

    def test_sections_and_files_belong_to_their_job_and_go_with_it(self):
        row = self.s.applications.create(JOB, 'Saved')
        self.assertIsNone(self.s.applications.section(row['id'], 'Kit'))
        self.s.applications.set_section(row['id'], 'Kit', '## Cover letter\n\nDear Acme,')
        self.assertEqual(self.s.applications.section(row['id'], 'Kit'), '## Cover letter\n\nDear Acme,')
        self.s.applications.set_section(row['id'], 'Kit', 'v2')
        self.assertEqual(self.s.applications.section(row['id'], 'Kit'), 'v2')
        self.assertTrue(self.s.applications.attach(row['id'], 'cv.pdf', b'%PDF', 'application/pdf'))
        with self.assertRaises(KeyError):
            self.s.applications.set_section('missing', 'Kit', 'x')
        self.s.applications.delete(row['id'])
        self.assertIsNone(self.s.applications.get(JOB['url']))
        self.assertIsNone(self.s.applications.section(row['id'], 'Kit'))

    def test_sections_and_files_are_listed_for_a_move(self):
        row = self.s.applications.create(JOB, 'Saved')
        self.s.applications.set_section(row['id'], 'Kit', 'k')
        self.s.applications.set_section(row['id'], 'Prep', 'p')
        self.s.applications.attach(row['id'], 'cv.pdf', b'%PDF', 'application/pdf')
        self.assertEqual(self.s.applications.sections(row['id']), {'Kit': 'k', 'Prep': 'p'})
        self.assertEqual(self.s.applications.files(row['id']), [('cv.pdf', b'%PDF', 'application/pdf')])

    def test_put_keeps_a_copied_records_fields_and_dates_under_a_new_id(self):
        app = self.s.applications.put({**JOB, 'id': 'elsewhere-1', 'stage': 'Applied', 'applied_on': '2026-09-01',
                                       'created_at': '2026-08-30T10:00:00+00:00'})
        self.assertNotEqual(app['id'], 'elsewhere-1')
        self.assertEqual((app['stage'], app['applied_on'], app['created_at'][:10]), ('Applied', '2026-09-01', '2026-08-30'))
        event = self.s.events.put({'app_id': app['id'], 'kind': 'Applied', 'at': '2026-09-01', 'created_at': '2026-09-01T09:00:00+00:00'})
        self.assertEqual(self.s.events.list(app_id=app['id'])[0]['created_at'][:10], '2026-09-01')
        self.assertEqual(event['kind'], 'Applied')
        run = self.s.cron_runs.put({'kind': 'search', 'where': 'mac', 'status': 'Done', 'started_at': '2026-09-02T08:00:00+00:00',
                                    'finished_at': '2026-09-02T08:05:00+00:00', 'summary': '2 new jobs', 'progress': []})
        self.assertEqual((self.s.cron_runs.get(run['id'])['started_at'][:10], run['summary']), ('2026-09-02', '2 new jobs'))
        for table, values in ((self.s.interviews, {'app_id': app['id'], 'title': 'Call'}),
                              (self.s.insights, {'day': '2026-09-03', 'category': 'daily', 'title': 'T', 'body': 'b'}),
                              (self.s.employers, {'name': 'Acme', 'active': True}),
                              (self.s.agent_runs, {'url': JOB['url'], 'ats': 'workday'})):
            put = table.put({**values, 'created_at': '2026-09-04T00:00:00+00:00'})
            self.assertEqual({k: put[k] for k in values}, values)

    # Events

    def test_events_are_listed_by_job_and_kind_and_archived(self):
        app = self.s.applications.create(JOB, 'Applied')
        first = self.s.events.add(app['id'], 'Applied', '2026-10-01', source='app')
        self.assertRecord(first, base.EVENT_FIELDS)
        self.s.events.add(app['id'], 'Interview', '2026-10-05', interview_at='2026-10-08T10:00')
        self.assertEqual(len(self.s.events.list(app_id=app['id'])), 2)
        self.assertEqual([e['kind'] for e in self.s.events.list(kind='Interview')], ['Interview'])
        self.assertEqual(self.s.events.archive(app['id'], 'Interview'), 1)
        self.assertEqual([e['kind'] for e in self.s.events.list(app_id=app['id'])], ['Applied'])

    def test_an_event_with_a_source_id_is_added_once(self):
        app = self.s.applications.create(JOB, 'Applied')
        one = self.s.events.add(app['id'], 'Rejected', '2026-10-02', source='gmail', source_id='mail-1')
        two = self.s.events.add(app['id'], 'Rejected', '2026-10-02', source='gmail', source_id='mail-1')
        self.assertEqual(one['id'], two['id'])
        self.assertEqual(len(self.s.events.list(source_id='mail-1')), 1)

    def test_an_event_is_updated_and_keeps_what_it_moved_beside_its_interview_time(self):
        app = self.s.applications.create(JOB, 'Applied')
        event = self.s.events.add(app['id'], 'Interview scheduled', '2026-10-02', source='Notion edit',
                                  interview_at='2026-10-08T10:00:00+02:00')
        moved = {'fields': {'stage': ['Applied', 'Interview scheduled']}, 'from': 'Ana <ana@acme.test>', 'subject': 'Our call'}
        updated = self.s.events.update(event['id'], {'source_id': 'mail-2', 'source': 'Gmail', 'changes': moved})
        self.assertRecord(updated, base.EVENT_FIELDS)
        again = self.s.events.list(source_id='mail-2')[0]
        self.assertEqual((again['id'], again['source'], again['changes'], again['interview_at']),
                         (event['id'], 'Gmail', moved, '2026-10-08T10:00:00+02:00'))
        with self.assertRaises(KeyError):
            self.s.events.update(event['id'], {'not_a_field': 1})

    def test_a_question_is_an_event_on_no_job_with_the_job_it_would_pick(self):
        self.s.applications.create(JOB, 'Applied')
        asked = self.s.events.add('', 'Rejected', '2026-10-03T09:00:00+00:00', source='Gmail', source_id='mail-3', needs_you=True,
                                  suggested_job=JOB['url'], changes={'fields': {}, 'subject': 'Your application'})
        found = self.s.events.list(source_id='mail-3')[0]
        self.assertEqual((found['id'], found['app_id'], bool(found['needs_you']), found['suggested_job']),
                         (asked['id'], '', True, JOB['url']))
        self.assertEqual(found['changes']['subject'], 'Your application')

    # Matches

    def test_a_match_is_upserted_by_url_and_its_status_set(self):
        row = self.s.matches.upsert({**JOB, 'fit': 70, 'status': 'New'})
        self.assertRecord(row, base.MATCH_FIELDS)
        self.s.matches.upsert({**JOB, 'url': JOB['url'] + '/', 'fit': 85})
        self.assertEqual([(m['fit'], m['status']) for m in self.s.matches.list()], [(85, 'New')])
        self.s.matches.set_status(JOB['url'], 'Dismissed')
        self.assertEqual(len(self.s.matches.list(status='Dismissed')), 1)
        self.s.matches.remove(JOB['url'])
        self.assertEqual(self.s.matches.list(), [])

    # Interviews, insights, employers

    def test_an_interview_is_saved_updated_and_archived(self):
        app = self.s.applications.create(JOB, 'Interview')
        row = self.s.interviews.save(None, {'app_id': app['id'], 'title': 'First call', 'transcript': 'A: hi'})
        self.assertRecord(row, base.INTERVIEW_FIELDS)
        self.s.interviews.save(row['id'], {'review': '## Went well'})
        got = self.s.interviews.get(row['id'])
        self.assertEqual((got['transcript'], got['review']), ('A: hi', '## Went well'))
        self.assertEqual(len(self.s.interviews.list(app_id=app['id'])), 1)
        self.s.interviews.archive(row['id'])
        self.assertEqual(self.s.interviews.list(), [])

    def test_insight_rows_of_their_own_share_a_day_and_update_in_place(self):
        one = self.s.insights.add({'day': '2026-10-08', 'category': 'Process', 'title': 'A', 'fields': {'sample_size': 4}})
        self.s.insights.add({'day': '2026-10-08', 'category': 'Process', 'title': 'B'})
        self.assertEqual(sorted(i['title'] for i in self.s.insights.list(category='Process')), ['A', 'B'])
        kept = self.s.insights.update(one['id'], {'title': 'A2', 'fields': {'sample_size': 5}})
        self.assertEqual((kept['id'], kept['title'], kept['fields']), (one['id'], 'A2', {'sample_size': 5}))
        with self.assertRaises(KeyError):
            self.s.insights.update('missing', {'title': 'x'})
        with self.assertRaises(KeyError):
            self.s.insights.add({'day': '2026-10-08', 'category': 'Process', 'title': 'C', 'fields': {'colour': 'red'}})
        self.s.insights.save('2026-10-08', 'daily', 'D', 'b')
        self.s.insights.save('2026-10-08', 'daily', 'D2', 'c')
        self.assertEqual([i['title'] for i in self.s.insights.list(category='daily')], ['D2'])

    def test_one_insight_per_day_and_category_newest_first(self):
        self.s.insights.save('2026-10-07', 'daily', 'Old', 'a')
        self.s.insights.save('2026-10-08', 'daily', 'New', 'b')
        again = self.s.insights.save('2026-10-08', 'daily', 'Newer', 'c', {'sample_size': 3})
        self.assertRecord(again, base.INSIGHT_FIELDS)
        self.assertEqual([i['title'] for i in self.s.insights.list(category='daily')], ['Newer', 'Old'])
        self.assertEqual([i['title'] for i in self.s.insights.list(since='2026-10-08')], ['Newer'])
        self.assertEqual(len(self.s.insights.list(limit=1)), 1)

    def test_an_employer_is_added_once_by_name(self):
        row = self.s.employers.add({'name': 'Acme', 'careers_url': 'https://acme.example/jobs'})
        self.assertRecord(row, base.EMPLOYER_FIELDS)
        self.s.employers.add({'name': 'ACME'})
        self.assertEqual([e['name'] for e in self.s.employers.list()], ['Acme'])

    def test_find_employers_re_check_updates_the_one_row_by_name(self):
        first = self.s.employers.upsert({'name': 'Acme', 'tier': 'Tier 2', 'feed_status': 'Not checked'})
        again = self.s.employers.upsert({'name': 'ACME', 'ats': 'greenhouse', 'slug': 'acme', 'feed_status': 'Feed found', 'quality': 71})
        self.assertEqual(first['id'], again['id'])
        self.assertEqual((again['name'], again['tier'], again['ats'], again['quality']), ('Acme', 'Tier 2', 'greenhouse', 71))
        self.assertEqual(len(self.s.employers.list(active=None)), 1)
        with self.assertRaises(KeyError):
            self.s.employers.upsert({'name': 'Acme', 'not a field': 1})

    # Runs

    def test_an_agent_run_is_added_updated_and_listed_newest_first(self):
        first = self.s.agent_runs.add({'url': JOB['url'], 'ats': 'workday', 'outcome': 'filled'})
        self.assertRecord(first, base.AGENT_RUN_FIELDS)
        self.s.agent_runs.add({'url': JOB['url'], 'ats': 'greenhouse', 'outcome': 'partial'})
        self.s.agent_runs.update(first['id'], {'transcript': 'talk'})
        self.assertEqual([r['ats'] for r in self.s.agent_runs.list()], ['greenhouse', 'workday'])
        self.assertEqual(self.s.agent_runs.list(ats='workday')[0]['transcript'], 'talk')

    def test_an_agent_runs_fields_are_known_columns_and_it_is_found_by_id(self):
        run = self.s.agent_runs.add({'url': JOB['url'], 'ats': 'Claude', 'fields': {'turns': 12, 'model': 'opus'}})
        self.s.agent_runs.update(run['id'], {'outcome': 'submitted', 'fields': {'turns': 14, 'times_asked': 2}})
        got = self.s.agent_runs.get(run['id'])
        self.assertEqual((got['outcome'], got['fields']['turns']), ('submitted', 14))
        self.assertIsNone(self.s.agent_runs.get('missing'))
        with self.assertRaises(KeyError):
            self.s.agent_runs.add({'url': JOB['url'], 'fields': {'not a column': 1}})
        with self.assertRaises(KeyError):
            self.s.agent_runs.update(run['id'], {'fields': {'not a column': 1}})

    def test_a_cron_run_begins_reports_progress_and_finishes(self):
        run = self.s.cron_runs.begin('search', 'mac')
        self.assertRecord(run, base.CRON_RUN_FIELDS)
        self.assertEqual(run['status'], 'Running')
        self.s.cron_runs.progress(run['id'], 'Reading 12 feeds')
        done = self.s.cron_runs.finish(run['id'], 'Done', summary='3 new jobs', report='- a', result='msg')
        self.assertEqual((done['status'], done['summary'], done['progress']), ('Done', '3 new jobs', ['Reading 12 feeds']))
        self.assertTrue(done['finished_at'])
        self.assertEqual([r['id'] for r in self.s.cron_runs.list(kind='search')], [run['id']])
        self.assertEqual(self.s.cron_runs.list(kind='mail'), [])

    def test_a_run_keeps_its_trigger_and_numbers_and_refuses_an_unknown_number(self):
        run = self.s.cron_runs.begin('search', 'mac', {'trigger': 'button', 'mode': 'check'})
        self.assertEqual((run['trigger'], run['mode'], run['stats']), ('button', 'check', {}))
        done = self.s.cron_runs.finish(run['id'], 'Done', summary='3 new jobs', stats={'new_jobs': 3, 'ai_cost_usd': 0.12})
        self.assertEqual(done['stats'], {'new_jobs': 3, 'ai_cost_usd': 0.12})
        self.assertEqual(self.s.cron_runs.get(run['id'])['stats']['new_jobs'], 3)
        other = self.s.cron_runs.begin('mail', 'github')
        with self.assertRaises(KeyError):
            self.s.cron_runs.finish(other['id'], 'Done', stats={'not a stat': 1})

    def test_a_record_is_named_by_its_link_or_a_store_ref(self):
        run = self.s.cron_runs.begin('search', 'mac')
        named = self.s.link_or_ref('cron_runs', run['id'])
        if base.LINKS in self.s.caps:
            self.assertTrue(named.startswith('http'))
        else:
            self.assertEqual(base.parse_ref(named), ('cron_runs', run['id']))
        self.assertIsNone(base.parse_ref('https://www.notion.so/abc'))

    # Texts and the adapter

    def test_texts_are_whole_markdown_by_name_and_unknown_names_refused(self):
        self.assertEqual(self.s.texts.get('profile'), '')
        self.s.texts.set('profile', '# Igor\n\nSRE')
        self.s.texts.set('answers', 'Notice: 3 months')
        self.assertEqual((self.s.texts.get('profile'), self.s.texts.get('answers')), ('# Igor\n\nSRE', 'Notice: 3 months'))
        with self.assertRaises(KeyError):
            self.s.texts.get('search_settings')

    def test_the_adapter_names_itself_and_its_capabilities(self):
        self.assertTrue(self.s.name)
        self.assertLessEqual(set(self.s.caps), {base.LINKS, base.CLOUD, base.FILES})
        link = self.s.link(self.s.applications.create(JOB, 'Saved')['id'])
        self.assertEqual(link is not None, base.LINKS in self.s.caps)
