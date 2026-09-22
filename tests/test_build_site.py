import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_site import build_site


class PublishingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'assets').mkdir()
        (self.root / 'data').mkdir()
        (self.root / 'assets/app.js').write_text('export {};')
        for name in ('snapshot.json', 'manifest.json'):
            (self.root / 'data' / name).write_text('{}')
        (self.root / 'index.html').write_text('<script type="module" src="assets/app.js"></script>')

    def test_only_production_files_are_published(self):
        (self.root / 'private-note.txt').write_text('not a web asset')
        output = build_site(self.root)
        self.assertTrue((output / 'index.html').is_file())
        self.assertTrue((output / 'data/snapshot.json').is_file())
        self.assertTrue((output / '.nojekyll').is_file())
        self.assertFalse((output / 'private-note.txt').exists())
        self.assertTrue((self.root / 'index.html').is_file())

    def test_missing_resource_preserves_previous_output(self):
        output = build_site(self.root)
        original = (output / 'index.html').read_text()
        (self.root / 'index.html').write_text('<script src="assets/missing.js"></script>')
        with self.assertRaisesRegex(ValueError, 'no encontrado'):
            build_site(self.root)
        self.assertEqual((output / 'index.html').read_text(), original)

    def test_absolute_url_path_cannot_break_repository_pages(self):
        (self.root / 'index.html').write_text('<script src="/assets/app.js"></script>')
        with self.assertRaisesRegex(ValueError, 'rutas relativas'):
            build_site(self.root)


if __name__ == '__main__':
    unittest.main()
