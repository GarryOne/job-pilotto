"""The AI contract (src/ai/providers/contract.py): every engine takes the same Anthropic-shaped params and answers in the same shape.

No network, no key, no CLI: adapters are fed recorded answers. A new engine in providers.ENGINES fails `test_every_engine_is_covered`
until it has a case in ENGINE_CASES here.
"""
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import engine, providers  # noqa: E402
from src.ai.providers import contract, schema  # noqa: E402
from src.ai.providers.anthropic_api import AnthropicApi  # noqa: E402

SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['answer'],
          'properties': {'answer': {'type': 'string', 'enum': ['yes', 'no']}, 'why': {'type': 'string'},
                         'items': {'type': 'array', 'maxItems': 3, 'items': {'type': 'object', 'required': ['n'],
                                                                            'properties': {'n': {'type': 'integer'}, 'note': {'type': 'string'}}}}}}
PNG = 'iVBORw0KGgo='
PARAMS = dict(model='claude-haiku-5-5', max_tokens=500,
              system=[{'type': 'text', 'text': 'Rules.'}, {'type': 'text', 'text': 'Profile.', 'cache_control': {'type': 'ephemeral'}}],
              messages=[{'role': 'user', 'content': [{'type': 'text', 'text': 'Is this a job page?'},
                                                     {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': PNG}}]}],
              output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}, 'effort': 'low'})


class RequestTests(unittest.TestCase):
    def test_the_callers_params_become_one_neutral_request(self):
        request = contract.request_from(PARAMS)
        self.assertEqual((request.model, request.max_tokens, request.system, request.effort), ('claude-haiku-5-5', 500, 'Rules.\n\nProfile.', 'low'))
        self.assertEqual(request.schema, SCHEMA)
        self.assertEqual(request.messages[0].parts[0], 'Is this a job page?')
        self.assertEqual(request.attachments, [contract.Attachment('image', 'image/png', PNG)])
        self.assertEqual(request.params, PARAMS)   # kept untouched for the Anthropic API

    def test_nothing_is_dropped_in_silence(self):
        for extra in ({'temperature': 0}, {'tools': [{'type': 'bash', 'name': 'bash'}]}, {'output_config': {'task_budget': 1}},
                      {'output_config': {'format': {'type': 'text'}}},
                      {'messages': [{'role': 'user', 'content': [{'type': 'tool_result', 'content': 'x'}]}]}):
            with self.subTest(extra=extra), self.assertRaises(TypeError):
                contract.request_from(dict(PARAMS, **extra))

    def test_web_search_and_a_pdf_are_part_of_it(self):
        request = contract.request_from(dict(PARAMS, tools=[{'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': 2}],
                                             messages=[{'role': 'user', 'content': [{'type': 'document', 'source': {
                                                 'type': 'base64', 'media_type': 'application/pdf', 'data': 'JVBERi0='}}]}]))
        self.assertEqual(request.web_search, 2)
        self.assertEqual(request.attachments[0].kind, 'pdf')


class AdapterTests(unittest.TestCase):
    def test_the_anthropic_api_gets_the_params_untouched(self):
        sent = []
        sdk = SimpleNamespace(messages=SimpleNamespace(create=lambda **p: sent.append(p) or 'the sdk response'))
        self.assertEqual(AnthropicApi(client=sdk).messages.create(**PARAMS), 'the sdk response')
        self.assertEqual(sent, [PARAMS])   # cache_control, effort, the image: as the caller wrote them

    def test_a_plan_limit_goes_to_the_users_fallback_once_and_stays_there(self):
        calls, logged = [], []

        class Plan(contract.Adapter):
            name, fallback_label = 'plan', 'your API key'

            def complete(self, request):
                calls.append('plan')
                raise contract.AiLimit('Plan limit reached.')

        api = SimpleNamespace(messages=SimpleNamespace(create=lambda **p: calls.append('api') or 'api answer'))
        client = Plan(fallback=lambda: api, log=logged.append)
        self.assertEqual([client.messages.create(**PARAMS) for _ in range(2)], ['api answer'] * 2)
        self.assertEqual(calls, ['plan', 'api', 'api'])
        self.assertTrue(client.fell_back)
        self.assertIn('Using your API key for the rest of this run', logged[0])

    def test_a_final_limit_never_falls_back(self):
        class Missing(contract.Adapter):
            def complete(self, request):
                raise contract.AiLimit('Not installed.', final=True)

        with self.assertRaises(contract.AiLimit):
            Missing(fallback=lambda: self.fail('no fallback for a missing engine')).messages.create(**PARAMS)

    def test_limits_count_as_the_ai_limit_everywhere(self):
        from src.ai import cost
        self.assertTrue(cost.limit_reached(contract.AiLimit('x')))
        self.assertTrue(cost.limit_reached(engine.CliLimitError('x')))
        self.assertFalse(cost.limit_reached(contract.AiUnavailable('x')))
        self.assertIn(contract.AiUnavailable, engine.transient_errors())


class RegistryTests(unittest.TestCase):
    def test_every_engine_is_covered(self):
        self.assertEqual(set(providers.ENGINES), set(ENGINE_CASES), 'a new engine needs a case in ENGINE_CASES')

    def test_each_engine_is_built_from_the_environment(self):
        for name, (env, kind) in ENGINE_CASES.items():
            with self.subTest(engine=name):
                import unittest.mock as mock
                with mock.patch('src.ai.providers.anthropic_api.sdk', lambda action='': 'sdk'):
                    client = engine.client(env)
                self.assertEqual(type(client).__name__, kind)
                self.assertEqual(client.name, name)
                self.assertEqual(client.family, providers.ENGINES[name].family)
                self.assertEqual(client.billing, providers.ENGINES[name].billing)

    def test_nothing_is_chosen_for_the_user(self):
        self.assertEqual(providers.choice({}), 'api')
        self.assertEqual(providers.choice({'JOB_PILOTTO_AI_ENGINE': 'auto'}), 'api')

    def test_a_fallback_stays_in_its_family(self):
        for item in providers.ENGINES.values():
            if item.fallback:
                with self.subTest(engine=item.name):
                    self.assertEqual(providers.ENGINES[item.fallback].family, item.family)
                    self.assertEqual(providers.ENGINES[item.fallback].billing, contract.API)


class SchemaTests(unittest.TestCase):
    def test_strict_lists_every_property_and_makes_the_optional_ones_nullable(self):
        out = schema.strict(SCHEMA)
        self.assertEqual(out['required'], ['answer', 'why', 'items'])
        self.assertEqual(out['properties']['answer']['type'], 'string')            # required: unchanged
        self.assertEqual(out['properties']['why']['type'], ['string', 'null'])
        self.assertNotIn('maxItems', json.dumps(out))
        inner = out['properties']['items']['items']
        self.assertEqual((inner['required'], inner['additionalProperties']), (['n', 'note'], False))

    def test_an_answer_to_the_strict_schema_reads_like_one_to_the_original(self):
        answer = {'answer': 'yes', 'why': None, 'items': [{'n': 1, 'note': None}]}
        back = schema.drop_nulls(answer, SCHEMA)
        self.assertEqual(back, {'answer': 'yes', 'items': [{'n': 1}]})
        self.assertEqual(schema.problems(back, SCHEMA), [])


# Each engine: the environment that picks it, and the adapter class it builds.
ENGINE_CASES = {
    'api': ({'ANTHROPIC_API_KEY': 'k'}, 'AnthropicApi'),
    'cli': ({'JOB_PILOTTO_AI_ENGINE': 'cli', 'JOB_PILOTTO_CLAUDE_BIN': sys.executable}, 'ClaudeCode'),
}

if __name__ == '__main__':
    unittest.main()
