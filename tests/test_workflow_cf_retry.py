"""Every Cloudflare call in a workflow (a deploy, a secret put) goes through tools/cf-retry.sh: Cloudflare's API answered 504 twice on 12 Oct 2026 and failed the site's release."""
import os
import pathlib
import re
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
RETRY = ROOT / 'tools' / 'cf-retry.sh'
CALL = re.compile(r'wrangler@4 (deploy|secret put)|npm run deploy')


class CloudflareRetryTests(unittest.TestCase):
    def test_every_deploy_and_secret_put_in_the_workflows_retries(self):
        bare = []
        for workflow in sorted((ROOT / '.github' / 'workflows').glob('*.yml')):
            for number, line in enumerate(workflow.read_text().splitlines(), 1):
                code = line.split('#', 1)[0] if line.lstrip().startswith('#') else line
                if CALL.search(code) and 'cf-retry.sh' not in code:
                    bare.append(f'{workflow.name}:{number}: {line.strip()}')
        self.assertEqual(bare, [], 'a Cloudflare call without tools/cf-retry.sh')

    def run_retry(self, fails):
        with tempfile.TemporaryDirectory() as folder:
            count = pathlib.Path(folder) / 'count'
            script = f'n=$(cat "{count.as_posix()}" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "{count.as_posix()}"; [ $n -gt {fails} ]'
            result = subprocess.run(['bash', str(RETRY), 'bash', '-c', script], capture_output=True, text=True, timeout=30, env={**os.environ, 'CF_RETRY_WAIT': '0'})
            return result, int(count.read_text())

    def test_a_call_that_fails_twice_then_works_succeeds_on_the_third_try(self):
        result, tries = self.run_retry(fails=2)
        self.assertEqual((result.returncode, tries), (0, 3), result.stderr)
        self.assertIn('try 2 of 3', result.stderr)

    def test_a_call_that_keeps_failing_fails_after_three_tries(self):
        result, tries = self.run_retry(fails=9)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(tries, 3)


if __name__ == '__main__':
    unittest.main()
