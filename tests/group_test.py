"""Tests for the status line grouper. Runs the exact GROUP_PY text from hooks/group.ts.

python3 tests/group_test.py
"""
import io, os, re, shutil, sys, tempfile, time, types, unittest

SRC = open(os.path.join(os.path.dirname(__file__), '..', 'hooks', 'group.ts'), encoding='utf-8').read()
PY = re.search(r'String\.raw`(.*)`', SRC, re.S).group(1)


def load(root):
    os.environ['PROGRESS_DIR'] = root
    mod = types.ModuleType('group')
    exec(compile(PY, 'group.py', 'exec'), mod.__dict__)
    return mod


def strip_links(s):
    return re.sub(r'\033\]8;;[^\033]*\033\\', '', s)


class Group(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.root, '.state'))
        self.g = load(self.root)

    def tearDown(self):
        shutil.rmtree(self.root)

    def write(self, rel, text):
        with open(os.path.join(self.root, rel), 'w') as f:
            f.write(text)

    def run_(self, text, now=None):
        return [strip_links(l) for l in self.g.main(io.StringIO(text), now or time.time())]

    def test_sections_in_order_with_todo_first(self):
        self.write('todo.txt', '[you]\nreview PR\nx old thing\n[mac]\nrun import\n')
        out = self.run_(
            '▶ build ████░░░░ 40.0% · 2/5\n'
            '✔ docs ████████ 100.0% · 5/5\n'
            '✖ error deploy · 3m\n'
            '▶ helper waiting · 1m\n'
            'Opus · ~/repo\n')
        self.assertEqual(out, [
            '▾ ☐ TO-DO',
            '  YOU: review PR',
            '  MAC: run import',
            '▾ ✖ PROBLEMS',
            '  ✖ error deploy · 3m',
            '▾ ▶ RUNNING',
            '  build ████░░░░ 40.0% · 2/5',
            '▾ ⏸ WAITING',
            '  helper waiting · 1m',
            '▾ ✔ DONE',
            '  docs ████████ 100.0% · 5/5',
            'Opus · ~/repo',
        ])

    def test_folded_sections(self):
        self.write('.state/folded.txt', 'todo\nrunning\n')
        self.write('todo.txt', '[a]\none\ntwo\n')
        out = self.run_('▶ j1 ██░░ 50.0%\n▶ j2 working · 1m\n')
        self.assertEqual(out, ['▸ ☐ TO-DO (2)', '▸ ▶ RUNNING (2)'])

    def test_duplicate_rows_merge(self):
        out = self.run_('▶ Build Docs working · 1m\n▶ build-docs ████░░░░ 40.0% · 2/5 · render · 1m\n')
        self.assertEqual(out, ['▾ ▶ RUNNING', '  build-docs ████░░░░ 40.0% · 2/5 · render · 1m'])

    def test_vanished_job_shows_finished_for_30_min(self):
        t = 1_800_000_000
        self.run_('▶ import ██░░ 50.0%\n', now=t)
        out = self.run_('', now=t + 60)
        self.assertEqual(out[0], '▾ ✔ DONE')
        self.assertTrue(out[1].startswith('  import · finished '))
        self.assertEqual(self.run_('', now=t + 31 * 60), [])

    def test_todo_hidden_done_links_and_free_headings(self):
        self.write('todo.txt', '# comment\nloose item\n[Team Alpha]\nx shipped\nopen site | https://example.com\n')
        raw = self.g.main(io.StringIO(''), time.time())
        self.assertIn('\033]8;;https://example.com\033\\open site\033]8;;\033\\', raw[2])
        self.assertEqual([strip_links(l) for l in raw], ['▾ ☐ TO-DO', '  TODO: loose item', '  TEAM ALPHA: open site'])

    def test_links_file_and_progress_file_default(self):
        self.write('links.txt', '# regex | url\n^deploy | http://localhost:3000\n')
        self.write('build.json', '{}')
        raw = self.g.main(io.StringIO('▶ deploy working · 1m\n▶ build ██░░ 50.0%\n▶ other working\n'), time.time())
        joined = '\n'.join(raw)
        self.assertIn('\033]8;;http://localhost:3000\033\\deploy\033]8;;\033\\', joined)
        self.assertIn('\033]8;;file://' + os.path.join(self.root, 'build.json') + '\033\\build\033]8;;\033\\', joined)
        self.assertIn('  other working', raw)


if __name__ == '__main__':
    unittest.main()
