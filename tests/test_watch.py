import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources.feeds import database, scan, render


class WatchTests(unittest.TestCase):
    def test_dedup_changes_and_source_failures(self):
        sources = [{"company": "A", "board": "a"}, {"company": "B", "ats": "lever", "slug": "b"}]
        job = {"id": "1", "title": "Site Reliability Engineer", "location": "Zurich", "url": "https://example.com/1",
               "remote": False}
        def fetch(source):
            if source.get("slug") == "b":
                raise TimeoutError("test outage")
            return [job, {**job, "id": "2", "title": "Sales Manager"},
                    {**job, "id": "3", "location": "Toronto, Canada"},
                    {**job, "id": "4", "location": "Remote (EMEA)", "remote": True}]
        with tempfile.TemporaryDirectory() as tmp:
            with database(Path(tmp) / "db") as db:
                first = scan(sources, db, fetch)
                # Sales title dropped; Toronto dropped; remote EMEA kept.
                self.assertEqual(sorted(j["id"] for j in first["jobs"]), ["1", "4"])
                self.assertEqual(first["jobs"][0]["status"], "new")
                self.assertFalse(first["sources"][1]["ok"])
                self.assertEqual(scan(sources, db, fetch)["jobs"][0]["status"], "seen")
                job["location"] = "Zurich <script>alert(1)</script>"
                changed = scan(sources, db, fetch)
                self.assertEqual([j["status"] for j in changed["jobs"] if j["id"] == "1"], ["changed"])
                self.assertNotIn("<script>alert(1)</script>", render(changed))
            with database(Path(tmp) / "db") as db:
                self.assertEqual(scan(sources, db, fetch)["jobs"][0]["status"], "seen")

    def test_remote_must_be_open_to_europe(self):
        from src.sources.feeds import wanted_location
        self.assertTrue(wanted_location({"location": "Remote (EMEA)"}))
        self.assertTrue(wanted_location({"location": "Zürich, Switzerland"}))
        self.assertTrue(wanted_location({"location": "London, England, GBR"}))
        self.assertTrue(wanted_location({"location": "Anywhere", "remote": True}))
        self.assertFalse(wanted_location({"location": "USA - Remote", "remote": True}))
        self.assertFalse(wanted_location({"location": "Remote, Canada"}))
        self.assertFalse(wanted_location({"location": "Toronto, Canada"}))
        self.assertTrue(wanted_location({"location": "Remote - US; London, UK"}))

    def test_greenhouse_content_becomes_plain_text(self):
        from src.sources.feeds import plain_text
        self.assertEqual(plain_text("&lt;p&gt;Run &lt;b&gt;Kubernetes&lt;/b&gt; &amp;amp; Terraform&lt;/p&gt;"),
                         "Run Kubernetes & Terraform")
        self.assertEqual(plain_text(None), "")


if __name__ == "__main__":
    unittest.main()
