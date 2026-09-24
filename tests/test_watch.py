import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from watch import database, scan, render


class WatchTests(unittest.TestCase):
    def test_dedup_changes_and_source_failures(self):
        sources = [{"company": "A", "board": "a"}, {"company": "B", "board": "b"}]
        job = {"id": 1, "title": "Site Reliability Engineer", "location": {"name": "Zurich"}, "absolute_url": "https://example.com/1"}
        def fetch(board):
            if board == "b":
                raise TimeoutError("test outage")
            return [job, {**job, "id": 2, "title": "Sales Manager"}]
        with tempfile.TemporaryDirectory() as tmp:
            with database(Path(tmp) / "db") as db:
                first = scan(sources, db, fetch)
                self.assertEqual(len(first["jobs"]), 1)
                self.assertEqual(first["jobs"][0]["status"], "new")
                self.assertFalse(first["sources"][1]["ok"])
                self.assertEqual(scan(sources, db, fetch)["jobs"][0]["status"], "seen")
                job["location"]["name"] = "<script>alert(1)</script>"
                changed = scan(sources, db, fetch)
                self.assertEqual(changed["jobs"][0]["status"], "changed")
                self.assertNotIn("<script>alert(1)</script>", render(changed))
            with database(Path(tmp) / "db") as db:
                self.assertEqual(scan(sources, db, fetch)["jobs"][0]["status"], "seen")

    def test_greenhouse_content_becomes_plain_text(self):
        from watch import plain_text
        self.assertEqual(plain_text("&lt;p&gt;Run &lt;b&gt;Kubernetes&lt;/b&gt; &amp;amp; Terraform&lt;/p&gt;"),
                         "Run Kubernetes & Terraform")
        self.assertEqual(plain_text(None), "")


if __name__ == "__main__":
    unittest.main()
