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
    return re.sub(r'\033\]8;;[^\033\007]*(\033\\|\007)', '', s)


T0 = 1_800_000_000  # int(T0) % 10 == 0, so the spinner frame is ⠋


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
        return [strip_links(l) for l in self.g.main(io.StringIO(text), now or T0)]

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
            '  ⠋ build ████░░░░ 40.0% · 2/5 · in progress',
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
        self.assertEqual(out, ['▾ ▶ RUNNING', '  ⠋ build-docs ████░░░░ 40.0% · 2/5 · render · 1m'])

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
        raw = self.g.main(io.StringIO('▶ deploy working · 1m\n▶ build ██░░ 50.0%\n▶ other working\n'), T0)
        joined = '\n'.join(raw)
        self.assertIn('\033]8;;http://localhost:3000\033\\deploy\033]8;;\033\\', joined)
        self.assertIn('\033]8;;file://' + os.path.join(self.root, 'build.json') + '\033\\build\033]8;;\033\\', joined)
        self.assertIn('  ⠋ other working · in progress', raw)

    def test_headers_plain_without_clicks_flag(self):
        self.write('todo.txt', '[a]\none\n')
        self.write('.state/folded.txt', 'done\n')
        raw = self.g.main(io.StringIO('▶ j1 ██░░ 50.0%\n✔ d ████ 100.0%\n'), time.time())
        self.assertNotIn('progressbar://', '\n'.join(raw))
        self.assertEqual(raw[0], '▾ ☐ TO-DO')

    def test_headers_link_to_toggle_with_clicks_flag(self):
        self.write('.state/clicks-on', '')
        self.write('.state/folded.txt', 'done\n')
        self.write('todo.txt', '[a]\none\n')
        self.write('build.json', '{}')
        raw = self.g.main(io.StringIO('▶ build ██░░ 50.0%\n✔ d ████ 100.0%\n✖ error x · 1m\n▶ w waiting · 1m\n'), time.time())
        L = lambda key, text: '\033]8;;progressbar://toggle/' + key + '\007' + text + '\033]8;;\007'
        self.assertEqual(raw[0], L('todo', '▾ ☐ TO-DO'))
        self.assertIn(L('problems', '▾ ✖ PROBLEMS'), raw)
        self.assertIn(L('running', '▾ ▶ RUNNING'), raw)
        self.assertIn(L('waiting', '▾ ⏸ WAITING'), raw)
        self.assertIn(L('done', '▸ ✔ DONE (1)'), raw)
        # Job links keep their own form.
        self.assertIn('\033]8;;file://' + os.path.join(self.root, 'build.json') + '\033\\build\033]8;;\033\\', '\n'.join(raw))
        self.assertEqual([strip_links(l) for l in raw][:3], ['▾ ☐ TO-DO', '  A: one', '▾ ✖ PROBLEMS'])

    def test_spinner_frame_follows_the_clock(self):
        self.assertEqual(self.run_('▶ j ██░░ 50.0% · 1/2 · load · 1m\n', now=T0 + 3), ['▾ ▶ RUNNING', '  ⠸ j ██░░ 50.0% · 1/2 · load · 1m'])

    def test_stuck_after_11_minutes_with_unchanged_numbers(self):
        self.run_('▶ fast ██░░ 50.0% · 2/4 · 1m\n', now=T0)
        self.run_('▶ slow ██░░ 50.0% · 2/4 · 1m\n▶ fast ██░░ 50.0% · 2/4 · 1m\n', now=T0)
        out = self.run_('▶ fast ███░ 75.0% · 3/4 · 12m\n▶ slow ██░░ 50.0% · 2/4 · 12m\n', now=T0 + 11 * 60)
        self.assertEqual(out, [
            '▾ ▶ RUNNING',
            '  \033[33m⚠ stuck 11m\033[0m slow ██░░ 50.0% · 2/4 · 12m · in progress',
            '  ⠋ fast ███░ 75.0% · 3/4 · 12m · in progress',
        ])

    def test_not_stuck_when_numbers_change(self):
        for k in range(12):
            out = self.run_('▶ j ██░░ ' + str(k) + '/20 · ' + str(k) + 'm\n', now=T0 + k * 60)
        self.assertEqual(out[1], '  ⠋ j ██░░ 11/20 · 11m · in progress')

    def test_stuck_without_numbers_ignores_elapsed_time(self):
        self.run_('▶ helper working · 1m · 4 tools · Edit\n', now=T0)
        out = self.run_('▶ helper working · 12m · 4 tools · Edit\n', now=T0 + 11 * 60)
        self.assertIn('⚠ stuck 11m', out[1])

    def test_stuck_minutes_is_configurable(self):
        self.write('.state/stuck-minutes', '30\n')
        self.run_('▶ j ██░░ 1/2\n', now=T0)
        self.assertNotIn('stuck', self.run_('▶ j ██░░ 1/2\n', now=T0 + 20 * 60)[1])
        self.assertIn('stuck 31m', self.run_('▶ j ██░░ 1/2\n', now=T0 + 31 * 60)[1])


if __name__ == '__main__':
    unittest.main()
