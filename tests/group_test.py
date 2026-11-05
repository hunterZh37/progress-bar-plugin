"""Tests for the status line grouper and the events log. Runs the exact GROUP_PY text from hooks/group.ts
and EVENTS_PY from hooks/events.ts.

python3 tests/group_test.py
"""
import io, json, os, re, shutil, subprocess, sys, tempfile, time, types, unittest

SRC = open(os.path.join(os.path.dirname(__file__), '..', 'hooks', 'group.ts'), encoding='utf-8').read()
PY = re.search(r'String\.raw`(.*)`', SRC, re.S).group(1)
EV_SRC = open(os.path.join(os.path.dirname(__file__), '..', 'hooks', 'events.ts'), encoding='utf-8').read()
EV_PY = re.search(r'EVENTS_PY = String\.raw`(.*)`', EV_SRC, re.S).group(1)
CP_SRC = open(os.path.join(os.path.dirname(__file__), '..', 'hooks', 'checkpoint.ts'), encoding='utf-8').read()
CP_PY = re.search(r'CHECKPOINT_PY = String\.raw`(.*)`', CP_SRC, re.S).group(1)


def load(root, lib=None):
    """The grouper as group.py. With lib, it sits in that folder beside events.py, as setup installs it."""
    os.environ['PROGRESS_DIR'] = root
    mod = types.ModuleType('group')
    if lib:
        with open(os.path.join(lib, 'events.py'), 'w') as f:
            f.write(EV_PY)
        mod.__dict__['__file__'] = os.path.join(lib, 'group.py')
    exec(compile(PY, 'group.py', 'exec'), mod.__dict__)
    return mod


def load_events(root):
    os.environ['PROGRESS_DIR'] = root
    mod = types.ModuleType('events')
    exec(compile(EV_PY, 'events.py', 'exec'), mod.__dict__)
    return mod


def strip_links(s):
    return re.sub(r'\033\]8;;[^\033\007]*(\033\\|\007)', '', s)


T0 = 1_800_000_000  # int(T0) % 4 == 0, so the spinner frame is ◐


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

    def test_already_grouped_input_is_dropped_and_never_saved(self):
        # A status line chained twice feeds our own output back in: headers, indented rows, stuck marks, badges.
        grouped = ('\033[31m! 1 action needed\033[0m\n'
                   '▾ ☐ TO-DO\n  YOU: review PR\n'
                   '▾ ▶ RUNNING\n  \033[33m⚠ stuck 12m\033[0m build ████░░░░ 40.0% · 2/5\n  ◐ docs ██░░ 10.0% · 1/9\n'
                   '▸ ✔ DONE (2)\n'
                   '0\n')
        out = self.run_('▶ build ████░░░░ 40.0% · 2/5\n' + grouped)
        self.assertEqual(out, ['▾ ▶ RUNNING', '  ◐ build ████░░░░ 40.0% · 2/5 · in progress', '0'])
        seen = json.loads(self.g.read(self.g.state_file()))
        self.assertEqual(list(seen), ['build'])

    def test_a_waiting_watcher_folds_into_the_job_it_watches(self):
        self.write('mac-label-top-ups-2021-23.json', json.dumps({'done': 5, 'total': 9, 'title': 'Mac label top-ups 2021-23'}))
        out = self.run_('▶ mac-label-top-ups-2021-23 ██░░ 53.8% · 5/9 · youth · 8m\n'
                        '▶ Mac label top-ups watcher waiting · 13h19m · 9 tools · Bash\n'
                        '▶ Hunty: rebuild trends waiting · 9h · 4 tools\n')
        self.assertEqual(out, ['▾ ▶ RUNNING',
                               '  ◐ mac-label-top-ups-2021-23 ██░░ 53.8% · 5/9 · youth · 8m · watched by: Mac label top-ups watcher',
                               '▾ ⏸ WAITING', '  Hunty: rebuild trends waiting · 9h · 4 tools'])
        # A watcher whose job is not running, or a waiting row that is not a watcher, stays in WAITING.
        out = self.run_('▶ Deploy watcher waiting · 1m · 2 tools\n', T0 + 1)
        self.assertEqual(out[:2], ['▾ ⏸ WAITING', '  Deploy watcher waiting · 1m · 2 tools'])
        line = self.g.main(io.StringIO('▶ import-x ██░░ 1/9\n▶ import x monitor waiting · 1m\n'), T0 + 2, summary=True)[0]
        self.assertNotIn('waiting', line)

    def test_stuck_prefix_is_not_part_of_a_name(self):
        self.assertEqual(self.g.name_of('\033[33m⚠ stuck 12m\033[0m build ████ 40% · 2/5'), 'build')
        self.assertEqual(self.g.name_of('◐ ⚠ stuck 1h05m deploy · 3/4'), 'deploy')

    def test_poisoned_seen_keys_are_dropped_on_load(self):
        self.write('.state/group-seen.json', json.dumps({
            '1': {'name': '1', 'at': T0, 'kind': 'running'},
            '33m-stuck-12m-0m-build': {'name': '\u001b[33m⚠ stuck 12m\u001b[0m build', 'at': T0, 'kind': 'running'},
            'real': {'name': 'real', 'at': T0, 'kind': 'running'}}))
        out = self.run_('Opus · ~/repo\n', T0 + 60)
        self.assertEqual(out, ['▾ ✔ DONE', '  real · finished ' + time.strftime('%H:%M', time.localtime(T0)), 'Opus · ~/repo'])
        self.assertEqual(list(json.loads(self.g.read(self.g.state_file()))), ['real'])

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
            '  ◐ build ████░░░░ 40.0% · 2/5 · in progress',
            '▾ ⏸ WAITING',
            '  helper waiting · 1m',
            '▾ ✔ DONE',
            '  docs ████████ 100.0% · 5/5',
            'Opus · ~/repo',
        ])

    def test_inbox_row_from_older_builds_is_dropped(self):
        out = self.run_('▶ inbox working · 2m\n▶ \033]8;;file:///x/inbox.json\033\\inbox\033]8;;\033\\ working · 2m\n▶ build ████░░░░ 40.0% · 2/5\n▶ inboxer working · 1m\n')
        self.assertFalse(any(re.search(r'\binbox\b', l) for l in out))
        self.assertTrue(any('build' in l for l in out))
        self.assertTrue(any('inboxer' in l for l in out))

    def test_goal_and_topology_data_rows_are_dropped(self):
        out = self.run_('▶ goal working · 2m\n▶ topology working · 1m\n▶ goals-review ████░░░░ 40.0% · 2/5\n')
        self.assertFalse(any(re.search(r'\b(goal|topology)\b', l) for l in out))
        self.assertTrue(any('goals-review' in l for l in out))

    def test_helper_healthy_is_a_machine_line_not_a_done_row(self):
        t = 1_800_000_000
        out = self.run_('▶ hunty ✓ helper healthy · load 0.22 on 12 cores · idle\n▶ build ████░░░░ 40.0% · 2/5\n', now=t)
        self.assertEqual(out, [
            '▾ ▶ RUNNING',
            '  ◐ build ████░░░░ 40.0% · 2/5 · in progress',
            'machine hunty ✓ helper healthy · load 0.22 on 12 cores · idle',
        ])
        # Fed back in (a status line chained twice), the machine line is dropped.
        self.assertEqual(self.g.ours(['machine hunty ✓ helper healthy · idle', 'Opus']), ['Opus'])
        # When it goes away it is not reported as a finished job.
        self.assertFalse(any('hunty' in l for l in self.run_('', now=t + 60)))

    def test_helper_idle_reads_busy_while_a_host_job_runs(self):
        out = self.run_('▶ hunty ✓ helper healthy · load 1.96 on 12 cores · idle\n'
                        '▶ hunty: hunty-board-cap-extract ████████░░░░ 40.2% · 55000/136911 · parsing\n'
                        '▶ hunty: board_cap.py · 86.8% CPU · 00:29\n')
        self.assertIn('machine hunty ✓ helper healthy · load 1.96 on 12 cores · busy: 1 job running', out)
        self.assertFalse(any(l.startswith('▾ ✔ DONE') for l in out))
        # Only busy processes: they count.
        out = self.run_('▶ hunty ✓ helper healthy · load 1.96 on 12 cores · idle\n▶ hunty: a.py · 86.8% CPU · 00:29\n▶ hunty: b.py · 50.0% CPU · 00:10\n', T0 + 1)
        self.assertIn('machine hunty ✓ helper healthy · load 1.96 on 12 cores · busy: 2 processes running', out)
        # Another host's job does not make it busy.
        out = self.run_('▶ hunty ✓ helper healthy · load 0.2 on 12 cores · idle\n▶ gpu: train ██░░ 10.0% · 1/9\n', T0 + 2)
        self.assertIn('machine hunty ✓ helper healthy · load 0.2 on 12 cores · idle', out)

    def test_folded_sections(self):
        self.write('.state/folded.txt', 'todo\nrunning\n')
        self.write('todo.txt', '[a]\none\ntwo\n')
        out = self.run_('▶ j1 ██░░ 50.0%\n▶ j2 working · 1m\n')
        self.assertEqual(out, ['▸ ☐ TO-DO (2)', '▸ ▶ RUNNING (2)'])

    def test_duplicate_rows_merge(self):
        out = self.run_('▶ Build Docs working · 1m\n▶ build-docs ████░░░░ 40.0% · 2/5 · render · 1m\n')
        self.assertEqual(out, ['▾ ▶ RUNNING', '  ◐ build-docs ████░░░░ 40.0% · 2/5 · render · 1m'])

    def test_vanished_job_shows_finished_for_30_min(self):
        t = 1_800_000_000
        self.run_('▶ import ██░░ 50.0%\n', now=t)
        out = self.run_('', now=t + 60)
        self.assertEqual(out[0], '▾ ✔ DONE')
        self.assertTrue(out[1].startswith('  import · finished '))
        self.assertEqual(self.run_('', now=t + 31 * 60), [])

    def test_just_finished_job_lingers_under_running_for_a_minute(self):
        # A short job's bar used to flash and vanish; for a minute it stays under RUNNING as a full green row.
        t = 1_800_000_000
        self.run_('▶ import ██░░ 50.0%\n', now=t)
        out = self.run_('', now=t + 20)
        self.assertEqual(out[0], '▾ ▶ RUNNING')
        self.assertEqual(out[1], '  ✔ import ██████████ 100.0% · just finished')
        self.assertNotIn('▾ ✔ DONE', out)

    def test_todo_priority_blocked_and_next(self):
        self.write('todo.txt', '[you]\nreply Sam\n[mac]\nlater thing\n2. second | https://x.org\n1. first (after classify)\n[hunty]\n1. trends (after 2019-20 load)\n2. board links\n')
        raw = self.g.main(io.StringIO('▶ arts-classify ████░░░░ 40.0% · 2/5\n'), T0)
        plain = [re.sub(r'\033\[[0-9;]*m', '', strip_links(l)) for l in raw]
        self.assertEqual(plain[:4], [
            '▾ ☐ TO-DO',
            '  YOU: reply Sam',
            '  MAC: 1. first (waits for arts-classify) · next 2. second · later thing',
            '  HUNTY: next 1. trends (after 2019-20 load) · 2. board links'])
        self.assertIn('\033[2m1. first (waits for arts-classify)\033[0m', raw[2])

    def test_todo_blocker_needs_every_key_word(self):
        self.assertEqual(self.g.blocker('2019-20 load', ['Load 2019-20 filings', 'x']), 'Load 2019-20 filings')
        self.assertEqual(self.g.blocker('2019-20 load', ['Load 2018 filings']), '')
        self.assertEqual(self.g.blocker('the', ['the job']), '')

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
        self.assertIn('  ◐ other working · in progress', raw)

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
        self.assertEqual(self.run_('▶ j ██░░ 50.0% · 1/2 · load · 1m\n', now=T0 + 3), ['▾ ▶ RUNNING', '  ◒ j ██░░ 50.0% · 1/2 · load · 1m'])

    def test_stuck_after_11_minutes_with_unchanged_numbers(self):
        self.run_('▶ fast ██░░ 50.0% · 2/4 · 1m\n', now=T0)
        self.run_('▶ slow ██░░ 50.0% · 2/4 · 1m\n▶ fast ██░░ 50.0% · 2/4 · 1m\n', now=T0)
        out = self.run_('▶ fast ███░ 75.0% · 3/4 · 12m\n▶ slow ██░░ 50.0% · 2/4 · 12m\n', now=T0 + 11 * 60)
        self.assertEqual(out, [
            '▾ ▶ RUNNING',
            '  \033[33m⚠ stuck 11m\033[0m slow ██░░ 50.0% · 2/4 · 12m · in progress',
            '  ◐ fast ███░ 75.0% · 3/4 · 12m · in progress',
        ])

    def test_not_stuck_when_numbers_change(self):
        for k in range(12):
            out = self.run_('▶ j ██░░ ' + str(k) + '/20 · ' + str(k) + 'm\n', now=T0 + k * 60)
        self.assertEqual(out[1], '  ◐ j ██░░ 11/20 · 11m · in progress')

    def test_stuck_without_numbers_ignores_elapsed_time(self):
        self.run_('▶ helper working · 1m · 4 tools · Edit\n', now=T0)
        out = self.run_('▶ helper working · 12m · 4 tools · Edit\n', now=T0 + 11 * 60)
        self.assertIn('⚠ stuck 11m', out[1])

    def test_stuck_minutes_is_configurable(self):
        self.write('.state/stuck-minutes', '30\n')
        self.run_('▶ j ██░░ 1/2\n', now=T0)
        self.assertNotIn('stuck', self.run_('▶ j ██░░ 1/2\n', now=T0 + 20 * 60)[1])
        self.assertIn('stuck 31m', self.run_('▶ j ██░░ 1/2\n', now=T0 + 31 * 60)[1])


    def test_done_in_is_time_left_not_done(self):
        self.assertEqual(self.g.kind('▶ import ██░░ 40.0% · 2/5 · done in 1h'), 'running')
        self.assertEqual(self.g.kind('▶ import · done'), 'done')
        self.assertEqual(self.g.kind('▶ import · done: 5 files'), 'done')
        out = self.run_('▶ import ██░░ 40.0% · 2/5 · done in 1h\n')
        self.assertEqual(out, ['▾ ▶ RUNNING', '  ◐ import ██░░ 40.0% · 2/5 · done in 1h'])

    def test_waits_for_is_waiting(self):
        out = self.run_('▶ deploy waits for build · 1m\n')
        self.assertEqual(out, ['▾ ⏸ WAITING', '  deploy waits for build · 1m'])

    def test_status_word_stripped_from_name(self):
        self.assertEqual(self.g.name_of('▶ nightly-import running · 3m'), 'nightly-import')

    def test_finished_memory_skips_jobs_whose_file_still_exists(self):
        self.run_('▶ import ██░░ 50.0%\n', now=T0)
        self.write('import.json', '{}')
        self.assertEqual(self.run_('', now=T0 + 60), [])

    def test_summary_line_counts_every_group(self):
        self.write('todo.txt', '[you]\na\nb\nx done\n[mac]\nc\n')
        self.write('.state/folded.txt', 'running todo\n')
        lines = '▶ slow ██░░ 50.0% · 2/4\n▶ fast ██░░ 1/4\n▶ helper waiting · 1m\n✖ error broken · 2m\nopus · main\n'
        self.g.main(io.StringIO(lines), T0, summary=True)
        out = self.g.main(io.StringIO(lines.replace('1/4', '2/4', 1).replace('fast ██░░ 1/4', 'fast ███░ 3/4')), T0 + 11 * 60, summary=True)
        self.assertEqual(out, ['▶ 2 running · ⚠ 1 stuck · ✖ 1 problems · ⏸ 1 waiting · ☐ 3 to-do · full view in the Status panel', 'opus · main'])

    def test_summary_line_leaves_out_empty_extras(self):
        self.assertEqual(self.run_summary(''), ['▶ 0 running · ☐ 0 to-do · full view in the Status panel'])

    def test_channel_files_show_as_new_until_read(self):
        os.makedirs(os.path.join(self.root, 'channel'))
        self.write('channel/received.json', json.dumps([{'id': 'a1'}, {'id': 'b2'}, {'id': 'b2'}, 'x']))
        self.write('.state/channel-read.txt', 'a1\n')
        self.assertTrue(self.g.main(io.StringIO(''), T0, summary=True)[0].startswith('\033[36mchannel: 1 new\033[0m · '))
        self.assertIn('channel: 1 new', strip_links('\n'.join(self.g.main(io.StringIO(''), T0))))
        self.write('.state/channel-read.txt', 'a1\nb2\n')
        self.assertNotIn('channel:', self.g.main(io.StringIO(''), T0, summary=True)[0])

    def test_summary_says_recap_ready_after_4_h_or_a_wake(self):
        self.write('.state/overnight.json', json.dumps({'since': T0, 'label': 'x', 'running': []}))
        self.assertNotIn('recap ready', self.g.main(io.StringIO(''), T0 + 3 * 3600, summary=True)[0])
        self.assertTrue(self.g.main(io.StringIO(''), T0 + 4 * 3600, summary=True)[0].endswith(' · \033[2mrecap ready\033[0m'))
        self.write('.state/overnight.json', json.dumps({'since': T0, 'label': 'x', 'running': [], 'woke': T0 + 60}))
        self.assertIn('recap ready', self.g.main(io.StringIO(''), T0 + 60, summary=True)[0])
        os.remove(os.path.join(self.root, '.state', 'overnight.json'))
        self.assertNotIn('recap ready', self.g.main(io.StringIO(''), T0 + 9 * 3600, summary=True)[0])

    def test_inbox_need_you_in_summary_and_full_view(self):
        self.assertNotIn('need you', self.run_summary('')[0])
        self.write('inbox.json', json.dumps({'checked': T0, 'items': [{'id': 'a1'}, {'id': 'b2'}, {'id': 'c3'}, {'from': 'no id'}]}))
        self.write('.state/inbox-handled.txt', 'b2\n')
        self.assertTrue(self.run_summary('')[0].startswith('\033[33minbox: 2 need you\033[0m · ▶ 0 running'))
        self.assertEqual(self.run_('▶ import ██░░ 50.0%\n')[0], '\033[33minbox: 2 need you\033[0m')
        os.environ['PB_FULL'] = '1'
        try:
            self.assertNotIn('need you', ''.join(self.run_('▶ import ██░░ 50.0%\n')))
        finally:
            del os.environ['PB_FULL']
        self.write('inbox.json', 'not json')
        self.assertNotIn('need you', self.run_summary('')[0])

    def test_pb_unfold_ignores_folded_sections(self):
        self.write('.state/folded.txt', 'running\n')
        os.environ['PB_UNFOLD'] = '1'
        try:
            out = self.run_('▶ build ████░░░░ 40.0% · 2/5\n')
        finally:
            del os.environ['PB_UNFOLD']
        self.assertEqual(out[0], '▾ ▶ RUNNING')

    def run_summary(self, text):
        return self.g.main(io.StringIO(text), T0, summary=True)

    def test_cpu_percent_is_never_done_and_a_busy_process_never_finishes(self):
        self.assertEqual(self.g.kind('▶ box: train.py · 100% CPU · 12:50'), 'running')
        self.run_('▶ box: train.py · 540% CPU · 12:50\n', now=T0)
        self.assertEqual(self.run_('', now=T0 + 60), [])

    def test_stuck_parent_with_a_running_child_is_waiting_on_it(self):
        self.write('big-batch.json', '{"done":1,"total":3}')
        self.write('child-step.json', '{"done":1,"total":2,"parent":"big-batch","title":"Child step · details"}')
        self.write('titles.txt', '# id\ttitle\twhy\tparent\nother-kid\tOther kid\t\tlonely\n')
        self.run_('▶ big-batch ██░░ 1/3\n▶ child-step ██░░ 1/2\n▶ lonely ██░░ 1/9\n', now=T0)
        out = self.run_('▶ big-batch ██░░ 1/3\n▶ child-step ███░ 2/2x\n▶ lonely ██░░ 1/9\n', now=T0 + 11 * 60)
        self.assertIn('  ◐ big-batch ██░░ 1/3 · waiting on: Child step', out)
        self.assertTrue(any(l.startswith('  \033[33m⚠ stuck 11m\033[0m lonely') for l in out))
        summary = self.g.main(io.StringIO('▶ big-batch ██░░ 1/3\n▶ child-step ███░ 2/2x\n▶ lonely ██░░ 1/9\n'), T0 + 11 * 60, summary=True)
        self.assertIn('⚠ 1 stuck', summary[0])

    def test_titles_parent_column_and_child_that_changed_recently(self):
        self.write('titles.txt', 'box: rebuild\tRebuild lists\twhat it unlocks\tparent-job\n')
        self.run_('▶ parent-job ██░░ 1/3\n▶ box: rebuild ██░░ 1/5\n', now=T0)
        self.run_('▶ parent-job ██░░ 1/3\n▶ box: rebuild ██░░ 2/5\n', now=T0 + 5 * 60)
        # The child has vanished but changed 6 min ago: the parent still waits on it.
        out = self.run_('▶ parent-job ██░░ 1/3\n', now=T0 + 11 * 60)
        self.assertIn('  ◐ parent-job ██░░ 1/3 · waiting on: Rebuild lists', out)

    def test_starting_is_a_step_not_part_of_the_name(self):
        self.assertEqual(self.g.name_of('▶ import starting…'), 'import')
        self.assertEqual(self.g.name_of('▶ import starting...'), 'import')
        self.assertEqual(self.g.name_of('▶ import · starting'), 'import')
        # One job: the starting row and the progress row merge, and nothing named "import starting" finishes later.
        self.run_('▶ import starting…\n', now=T0)
        out = self.run_('▶ import ██░░ 1/4\n', now=T0 + 60)
        self.assertEqual(sum('import' in l for l in out), 1)
        self.assertFalse(any('finished' in l for l in out))

    def test_a_job_last_seen_starting_never_finishes(self):
        self.run_('▶ import · starting\n', now=T0)
        self.assertEqual(self.run_('', now=T0 + 60), [])


class Events(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.lib = tempfile.mkdtemp()
        self.logs = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.root, '.state'))
        self.g = load(self.root, self.lib)
        self.ev = load_events(self.root)

    def tearDown(self):
        for d in (self.root, self.lib, self.logs):
            shutil.rmtree(d)

    def write(self, rel, text, base=None):
        with open(os.path.join(base or self.root, rel), 'w') as f:
            f.write(text)

    def events(self):
        try:
            with open(os.path.join(self.root, 'events.jsonl')) as f:
                return [json.loads(l) for l in f]
        except FileNotFoundError:
            return []

    def test_grouper_logs_done_stuck_and_problem_once(self):
        self.write('nightly.json', '{"done":1,"total":2,"title":"Nightly import · all files"}')
        g = lambda text, t: self.g.main(io.StringIO(text), t)
        g('▶ nightly ██░░ 1/2\n✖ error deploy · 1m\n', T0)
        g('▶ nightly ██░░ 1/2\n✖ error deploy · 1m\n', T0 + 11 * 60)
        g('▶ nightly ██░░ 1/2\n✖ error deploy · 1m\n', T0 + 12 * 60)
        os.remove(os.path.join(self.root, 'nightly.json'))
        g('✖ error deploy · 1m\n', T0 + 13 * 60)
        g('✖ error deploy · 1m\n', T0 + 14 * 60)
        got = [(e['level'], e['title']) for e in self.events()]
        self.assertEqual(sorted(got), sorted([('error', 'deploy: problem'), ('warning', 'Nightly import stuck'), ('success', 'nightly done')]))

    def test_stopped_row_whose_log_ends_done_is_a_success(self):
        self.write('log-dirs.txt', self.logs + '\n')
        self.write('.state/log-scan.stamp', '')  # no background scan: this test scans by hand
        self.write('label-20260101-1200.log', '  8/9 batches\n  9/9 batches\ndone (cli): 135 orgs\n', self.logs)
        self.write('crashy-20260101-1200.log', '  3/9 batches\n', self.logs)
        out = [strip_links(l) for l in self.g.main(io.StringIO('■ stopped label ████ 9/9 batches\n■ stopped crashy ██░░ 3/9 batches\n'), T0)]
        self.assertEqual(out, ['▾ ✖ PROBLEMS', '  ■ stopped crashy ██░░ 3/9 batches', '▾ ✔ DONE', '  label ████ 9/9 batches'])
        got = sorted((e['level'], e['title']) for e in self.events())
        self.assertEqual(got, [('error', 'crashy: problem'), ('success', 'label done')])

    def test_a_finish_seen_by_the_scanner_and_the_grouper_logs_once(self):
        self.write('log-dirs.txt', self.logs + '\n')
        self.write('.state/log-scan.stamp', '')  # no background scan: this test scans by hand
        self.write('train-20260101-1200.log', '  1/2\n  2/2\ndone (cli)\n', self.logs)
        self.ev.scan()
        self.g.main(io.StringIO('▶ train ██░░ 1/2\n'), T0)
        self.ev.forget('done:train')  # running again: its next finish logs again
        self.g.main(io.StringIO('✔ train ████ 2/2\n'), T0 + 60)
        self.ev.scan()  # same finish line already read: nothing new
        with open(os.path.join(self.logs, 'train-20260101-1300.log'), 'w') as f:
            f.write('  2/2\n')
        self.ev.scan()  # a second log of the same finished job: the grouper's key already holds it
        self.assertEqual([e['title'] for e in self.events() if e['level'] == 'success'], ['train done', 'train done'])

    def test_summary_counts_unseen_errors_and_the_log_seen_file_clears_them(self):
        now = time.time()
        self.ev.emit('error', 'a', 'A crashed', ts=now - 60)
        self.ev.emit('error', 'b', 'B crashed', ts=now - 30)
        self.ev.emit('error', 'c', 'Old crash', ts=now - 2 * 86400)
        self.ev.emit('warning', 'd', 'D stuck', ts=now - 10)
        self.assertIn('✖ 2 errors', self.g.main(io.StringIO(''), now, summary=True)[0])
        self.write('.state/log-seen.txt', str(int(now - 45)))
        self.assertIn('✖ 1 error ·', self.g.main(io.StringIO(''), now, summary=True)[0])
        self.write('.state/log-seen.txt', str(int(now)))
        self.assertNotIn('error', self.g.main(io.StringIO(''), now, summary=True)[0])

    def test_emit_keeps_the_newest_lines(self):
        self.ev.CAP = 5
        for i in range(8):
            self.ev.emit('info', 's', 't' + str(i), ts=T0 + i)
        self.assertEqual([e['title'] for e in self.events()], ['t3', 't4', 't5', 't6', 't7'])

    def test_add_from_the_command_line(self):
        p = os.path.join(self.lib, 'events.py')
        env = dict(os.environ, PROGRESS_DIR=self.root)
        subprocess.run([sys.executable, p, 'add', 'success', 'build', 'Build done', 'all 5 steps', '/x.log'], env=env, check=True)
        e = self.events()[0]
        self.assertEqual((e['level'], e['source'], e['title'], e['detail'], e['path']), ('success', 'build', 'Build done', 'all 5 steps', '/x.log'))
        self.assertEqual(subprocess.run([sys.executable, p, 'unseen'], env=env, capture_output=True, text=True).stdout.strip(), '0')

    def test_no_log_folders_means_no_scan(self):
        self.assertFalse(self.ev.due())
        self.write('log-dirs.txt', '# none here\n/does/not/exist\n')
        self.assertFalse(self.ev.due())

    def test_scan_errors_signals_limits_and_finishes_from_where_it_stopped(self):
        self.write('log-dirs.txt', '# folders\n' + self.logs + '/\n')
        self.assertTrue(self.ev.due())
        self.assertFalse(self.ev.due())  # rate limited
        old = os.path.join(self.logs, 'label-20260101-1200.log')
        self.write('label-20260101-1200.log', '  1/9 batches\nTraceback (most recent call last):\n  File "x.py"\nsubprocess.CalledProcessError: died with <Signals.SIGTERM: 15>.\n', self.logs)
        self.write('label-20260101-1300.log', '  2/9 batches\n', self.logs)
        self.write('crash.log', 'start\nTraceback (most recent call last):\n  File "y.py", line 3\nValueError: bad\nrate limit hit, waiting\n', self.logs)
        self.write('ok.log', 'step\n  4/4\n', self.logs)
        past = time.time() - 300
        for f in os.listdir(self.logs):
            os.utime(os.path.join(self.logs, f), (past, past))
        self.ev.scan()
        got = {(e['source'], e['level'], e['title']) for e in self.events()}
        self.assertEqual(got, {
            ('label', 'warning', 'label stopped (restart or kill)'),
            ('crash', 'error', 'crash crashed'),
            ('crash', 'warning', 'crash: usage limit or billing'),
            ('ok', 'success', 'ok done'),
        })
        stopped = next(e for e in self.events() if e['level'] == 'warning' and e['source'] == 'label')
        self.assertTrue(stopped['detail'].startswith('resumed in label-20260101-1300.log'))
        self.assertEqual(stopped['path'], old)
        n = len(self.events())
        self.ev.scan()
        self.assertEqual(len(self.events()), n)  # offsets: nothing read twice
        with open(old, 'a') as f:
            f.write('ERROR: disk full\n')
        self.ev.scan()
        self.assertEqual(self.events()[-1]['title'], 'label: error')
        self.assertEqual(self.ev.log_of('label'), old)

    def test_grouper_starts_a_scan_when_due(self):
        self.write('log-dirs.txt', self.logs + '\n')
        self.write('x.log', 'ERROR boom\n', self.logs)
        self.g.main(io.StringIO(''), time.time())
        for _ in range(50):
            if self.events():
                break
            time.sleep(0.1)
        self.assertEqual(self.events()[0]['title'], 'x: error')


class Checkpoint(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.lib = tempfile.mkdtemp()
        with open(os.path.join(self.lib, 'checkpoint.py'), 'w') as f:
            f.write(CP_PY)

    def tearDown(self):
        shutil.rmtree(self.root)
        shutil.rmtree(self.lib)

    def test_writes_overnight_json_from_the_running_rows(self):
        status = ('▾ ☐ TO-DO\n  YOU: x\n▾ ▶ RUNNING\n'
                  '  ⚠ stuck 12m \033]8;;file:///a\007arts-classify\033]8;;\007 ███░ 15.7% · 1420/9034 batches · 13h35m left\n'
                  '  ◐ agent working · 3m · 4 tools\n  ◐ box: train.py · 540% CPU · 12:50\n'
                  '▾ ✔ DONE\n  docs ████ 100.0% · 5/5\n')
        with open(os.path.join(self.lib, 'statusline.sh'), 'w') as f:
            f.write('#!/bin/sh\n[ "$PB_FULL" = 1 ] && [ "$PB_UNFOLD" = 1 ] || exit 1\ncat > /dev/null\nprintf %s "$ROWS"\n')
        env = dict(os.environ, PROGRESS_DIR=self.root, ROWS=status)
        before = int(time.time())
        r = subprocess.run([sys.executable, os.path.join(self.lib, 'checkpoint.py'), 'end', 'today'], env=env, capture_output=True, text=True, check=True)
        self.assertEqual(r.stdout.strip(), 'overnight checkpoint: 3 running')
        with open(os.path.join(self.root, '.state', 'overnight.json')) as f:
            data = json.load(f)
        self.assertGreaterEqual(data['since'], before)
        self.assertEqual(data['label'], 'end today')
        self.assertEqual(data['running'], [
            {'name': 'arts-classify', 'pct': 15.7, 'done': 1420, 'total': 9034},
            {'name': 'agent'},
            {'name': 'box: train.py'},
        ])

    def test_no_status_script_writes_an_empty_checkpoint(self):
        env = dict(os.environ, PROGRESS_DIR=self.root)
        subprocess.run([sys.executable, os.path.join(self.lib, 'checkpoint.py')], env=env, capture_output=True, check=True)
        with open(os.path.join(self.root, '.state', 'overnight.json')) as f:
            data = json.load(f)
        self.assertEqual((data['label'], data['running']), ('checkpoint', []))


RENDER_SRC = open(os.path.join(os.path.dirname(__file__), '..', 'hooks', 'render.ts'), encoding='utf-8').read()


def status_script(prev=''):
    """statusScript() from hooks/render.ts, chaining prev: its single-quoted lines, JS escapes undone."""
    body = re.search(r'export function statusScript\(prev\?: string\): string \{\n  return \[\n(.*?)\n  \]\.join', RENDER_SRC, re.S).group(1)
    out = []
    for l in body.split('\n'):
        l = l.strip()
        if l.startswith('`prev='):
            out.append("prev='" + prev.replace("'", "'\\''") + "'")
            continue
        m = re.match(r"^'(.*)',$", l)
        if m:
            out.append(re.sub(r"\\(.)", r'\1', m.group(1)))
    return '\n'.join(out) + '\n'


class Projects(unittest.TestCase):
    """Per-project to-dos: todos/projects.txt, then the git root under home, else todo.txt with no folder."""
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.root = os.path.join(self.home, '.claude-progress')
        os.makedirs(os.path.join(self.root, '.state'))
        os.makedirs(os.path.join(self.root, 'todos'))
        self.g = load(self.root)
        self.g.HOME = self.home
        os.makedirs(os.path.join(self.home, 'Desktop', 'NomBot', '.git'))
        os.makedirs(os.path.join(self.home, 'Desktop', 'NomBot', 'web', 'src'))
        os.makedirs(os.path.join(self.home, 'work', 'Cyber Portal', '.git'))
        os.makedirs(os.path.join(self.home, 'loose', 'dir'))
        os.environ.pop('PB_CWD', None)

    def tearDown(self):
        os.environ.pop('PB_CWD', None)
        shutil.rmtree(self.home)

    def write(self, rel, text):
        with open(os.path.join(self.root, rel), 'w') as f:
            f.write(text)

    def rel(self, cwd):
        return os.path.relpath(self.g.todo_file(cwd), self.root)

    def test_git_root_slug_from_any_subfolder(self):
        self.assertEqual(self.rel(os.path.join(self.home, 'Desktop', 'NomBot', 'web', 'src')), 'todos/desktop-nombot.txt')
        self.assertEqual(self.rel(os.path.join(self.home, 'work', 'Cyber Portal')), 'todos/work-cyber-portal.txt')

    def test_no_repo_uses_the_folder_and_no_folder_the_old_list(self):
        self.assertEqual(self.rel(os.path.join(self.home, 'loose', 'dir')), 'todos/loose-dir.txt')
        self.assertEqual(self.rel(''), 'todo.txt')

    def test_map_longest_prefix_and_legacy_file(self):
        self.write('todos/projects.txt', '# prefix<TAB>project\n~/Desktop/NomBot\ttodo.txt\n~/.claude-progress\ttodo.txt\n~/Desktop/NomBot/web  web-app\n')
        self.assertEqual(self.rel(os.path.join(self.home, 'Desktop', 'NomBot')), 'todo.txt')
        self.assertEqual(self.rel(self.root), 'todo.txt')
        self.assertEqual(self.rel(os.path.join(self.home, 'Desktop', 'NomBot', 'web', 'src')), 'todos/web-app.txt')
        self.assertEqual(self.rel(os.path.join(self.home, 'Desktop', 'NomBotX')), 'todos/desktop-nombotx.txt')

    def test_each_project_shows_its_own_list(self):
        self.write('todos/projects.txt', '~/Desktop/NomBot\ttodo.txt\n')
        self.write('todo.txt', '[mac]\nnombot thing\n')
        self.write('todos/work-cyber-portal.txt', '[you]\npatch the portal\n')
        os.environ['PB_CWD'] = os.path.join(self.home, 'Desktop', 'NomBot')
        self.assertEqual([strip_links(l) for l in self.g.main(io.StringIO(''), T0)], ['▾ ☐ TO-DO', '  MAC: nombot thing'])
        os.environ['PB_CWD'] = os.path.join(self.home, 'work', 'Cyber Portal')
        self.assertEqual([strip_links(l) for l in self.g.main(io.StringIO(''), T0)], ['▾ ☐ TO-DO', '  YOU: patch the portal'])
        os.environ['PB_CWD'] = os.path.join(self.home, 'loose', 'dir')
        self.assertEqual(self.g.main(io.StringIO(''), T0), [])

    def test_actions_needed_count_by_project_first_in_summary_and_full_view(self):
        self.write('todos/projects.txt', '~/Desktop/NomBot\ttodo.txt\n')
        nb = os.path.join(self.home, 'Desktop', 'NomBot')
        cy = os.path.join(self.home, 'work', 'Cyber Portal')
        self.assertEqual(self.g.project_of(nb), ('todo.txt', 'desktop-nombot'))
        self.assertEqual(self.g.project_of(cy), ('todos/work-cyber-portal.txt', 'work-cyber-portal'))
        self.write('actions.json', json.dumps([
            {'id': 'a1', 'title': 'global step', 'status': 'open'},
            {'id': 'a2', 'title': 'nombot step', 'project': 'desktop-nombot', 'status': 'open'},
            {'id': 'a3', 'title': 'cyber step', 'project': 'work-cyber-portal'},
            {'id': 'a4', 'title': 'closed', 'status': 'done'},
            {'id': 'a5', 'title': 'skipped', 'status': 'skipped'},
            {'title': 'no id'},
        ]))
        self.assertEqual(self.g.action_count(nb), 2)
        self.assertEqual(self.g.action_count(cy), 2)
        self.assertEqual(self.g.action_count(os.path.join(self.home, 'loose', 'dir')), 1)
        os.environ['PB_CWD'] = nb
        line = self.g.main(io.StringIO(''), T0, summary=True)[0]
        self.assertTrue(line.startswith('\033[1;31m! 2 actions needed\033[0m · '), line)
        self.assertEqual(self.g.main(io.StringIO(''), T0)[0], '\033[1;31m! 2 actions needed\033[0m')
        os.environ['PB_FULL'] = '1'
        try:
            self.assertNotIn('needed', ''.join(self.g.main(io.StringIO(''), T0)))
        finally:
            del os.environ['PB_FULL']
        os.environ['PB_CWD'] = os.path.join(self.home, 'loose', 'dir')
        self.assertIn('! 1 action needed', self.g.main(io.StringIO(''), T0, summary=True)[0])
        self.write('actions.json', 'not json')
        self.assertEqual(self.g.action_count(nb), 0)

    def test_a_job_another_session_sees_never_finishes_here(self):
        os.environ['PB_SID'] = 'aaaa'
        try:
            self.g.main(io.StringIO('▶ hunty load ████░░░░ 40.0% · 2/5\n'), T0)
            os.environ['PB_SID'] = 'bbbb'
            self.assertEqual(self.g.main(io.StringIO(''), T0 + 5), [])
            os.environ['PB_SID'] = 'aaaa'
            self.assertIn('  ✔ hunty load ██████████', [strip_links(l)[:25] for l in self.g.main(io.StringIO(''), T0 + 5)])
            self.assertIn('  hunty load · finished', [strip_links(l)[:23] for l in self.g.main(io.StringIO(''), T0 + 65)])
            self.assertTrue(os.path.exists(os.path.join(self.root, '.state', 'group-seen-aaaa.json')))
        finally:
            os.environ.pop('PB_SID', None)


class StatusScript(unittest.TestCase):
    """The installed status line script: each session sees its own line files, plus shared ones todos/lines.txt gives its project."""
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.lines = os.path.join(self.home, '.claude-progress', '.lines')
        os.makedirs(self.lines)
        os.makedirs(os.path.join(self.home, '.claude-progress', 'todos'))
        os.makedirs(os.path.join(self.home, 'Desktop', 'NomBot'))
        os.makedirs(os.path.join(self.home, 'cyber'))
        self.script = os.path.join(self.home, 'statusline.sh')
        with open(self.script, 'w') as f:
            f.write(status_script())
        for name, text in [('agents-aaaa.txt', '▶ nombot-agent working'), ('agents-bbbb.txt', '▶ cyber-agent working'),
                           ('linux.txt', '▶ hunty gpu job'), ('jobs.txt', '▶ shared job')]:
            with open(os.path.join(self.lines, name), 'w') as f:
                f.write(text)
        with open(os.path.join(self.home, '.claude-progress', 'todos', 'projects.txt'), 'w') as f:
            f.write('~/Desktop/NomBot\ttodo.txt\n')
        with open(os.path.join(self.home, '.claude-progress', 'todos', 'lines.txt'), 'w') as f:
            f.write('linux.txt\ttodo.txt\njobs.txt  todo.txt\n')

    def tearDown(self):
        shutil.rmtree(self.home)

    def run_(self, stdin, scope=None):
        if scope:
            os.makedirs(os.path.join(self.home, '.claude-progress', '.state'), exist_ok=True)
            with open(os.path.join(self.home, '.claude-progress', '.state', 'scope'), 'w') as f:
                f.write(scope)
        env = dict(os.environ, HOME=self.home, PB_FULL='1')
        out = subprocess.run(['/bin/sh', self.script], input=json.dumps(stdin), capture_output=True, text=True, env=env).stdout
        return sorted(l for l in out.split('\n') if l.strip())

    def test_nombot_session_sees_its_agents_and_its_shared_files(self):
        out = self.run_({'session_id': 'aaaa', 'workspace': {'current_dir': os.path.join(self.home, 'Desktop', 'NomBot')}})
        self.assertEqual(out, ['▶ hunty gpu job', '▶ nombot-agent working', '▶ shared job'])

    def test_other_project_session_sees_only_its_own(self):
        out = self.run_({'session_id': 'bbbb', 'cwd': os.path.join(self.home, 'cyber')})
        self.assertEqual(out, ['▶ cyber-agent working'])

    def test_scope_all_and_no_session_see_everything(self):
        every = ['▶ cyber-agent working', '▶ hunty gpu job', '▶ nombot-agent working', '▶ shared job']
        self.assertEqual(self.run_({}), every)
        self.assertEqual(self.run_({'session_id': 'bbbb', 'cwd': os.path.join(self.home, 'cyber')}, scope='all'), every)

    def chained(self, prev):
        with open(self.script, 'w') as f:
            f.write(status_script(prev))
        return self.run_({'session_id': 'bbbb', 'cwd': os.path.join(self.home, 'cyber')})

    def test_chained_status_line_output_prints(self):
        self.assertEqual(self.chained("echo 'Opus · ~/repo'"), ['Opus · ~/repo', '▶ cyber-agent working'])

    def test_chained_progress_status_line_output_is_dropped(self):
        # Its output holds our section headers: a second progress status line, never printed twice.
        for head in ['▾ ▶ RUNNING', '▾ ☐ TO-DO', '▸ ✔ DONE (3)']:
            self.assertEqual(self.chained("printf '%s\\n  ◐ x\\n' '" + head + "'"), ['▶ cyber-agent working'])


if __name__ == '__main__':
    unittest.main()
