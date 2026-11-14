"""Tests for bin/agentd.py with a fake `claude` and a fake channel.py. python3 tests/agentd_test.py"""
import importlib.util, json, os, stat, sys, tempfile, time, unittest

BIN = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'bin')
FAKE_CLAUDE = """#!/usr/bin/env python3
import sys, json
if '--input-format' not in sys.argv:
    if 'new or agents' in ' '.join(sys.argv):
        print('new' if 'do not follow it): "NEWTHING' in ' '.join(sys.argv) else 'agents'); sys.exit()
    print('big' if 'BIGTASK' in ' '.join(sys.argv) else 'small'); sys.exit()
for line in sys.stdin:
    t = json.loads(line)['message']['content']
    print(json.dumps({'type': 'result', 'result': 'got: ' + t}), flush=True)
"""


def wait(cond, secs=5):
    end = time.time() + secs
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


class T(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        os.environ['PB_AGENTD_HOME'] = os.path.join(self.d, 'agentd')
        os.environ['PB_CHANNEL_HOME'] = os.path.join(self.d, 'channel')
        fc = os.path.join(self.d, 'claude')
        open(fc, 'w').write(FAKE_CLAUDE)
        os.chmod(fc, 0o755)
        spec = importlib.util.spec_from_file_location('agentd', os.path.join(BIN, 'agentd.py'))
        self.m = m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        os.makedirs(m.HOME, exist_ok=True)
        m.cfg = dict(m.DEFAULTS, channel='x', claude=fc, max_agents=3, max_workers=2)
        self.said = []
        m.say = lambda text, who='agentd': self.said.append((who, text)) or True

    def tearDown(self):
        for a in list(self.m.agents):
            self.m.stop_agent(a)

    def test_task_pivot_and_result(self):
        m = self.m
        m.handle('/task --small write a haiku')
        aid = next(iter(m.agents))
        self.assertTrue(wait(lambda: (aid, 'got: write a haiku') in self.said))
        m.handle('@%s now make it longer' % aid)
        self.assertTrue(wait(lambda: (aid, 'got: now make it longer') in self.said))

    def test_unknown_agent_and_help(self):
        self.m.handle('@nobody hi')
        self.m.handle('/help')
        self.assertIn('no running agent', self.said[0][1])
        self.assertIn('/task', self.said[1][1])

    def test_agents_get_human_names_and_answer_to_them(self):
        m = self.m
        m.handle('/task --small one'); m.handle('/task --small two')
        ids = list(m.agents)
        self.assertTrue(all(i in m.NAMES for i in ids) and len(set(ids)) == 2)
        m.handle('hey %s, change course' % ids[0].capitalize())
        self.assertTrue(wait(lambda: (ids[0], 'got: change course') in self.said))
        m.handle('@%s: and again' % ids[1].upper())
        self.assertTrue(wait(lambda: (ids[1], 'got: and again') in self.said))
        self.assertTrue(any(ids[0].capitalize() + ' is on it' in t for _, t in self.said))

    def test_plain_text_with_nothing_running_is_a_task(self):
        m = self.m
        m.handle('please write a haiku', 'owner')
        aid = next(iter(m.agents))
        self.assertTrue(wait(lambda: (aid, 'got: please write a haiku') in self.said))
        self.assertTrue(any('is on it' in t for who, t in self.said if who == 'agentd'))
        m.handle('NEWTHING something unrelated')      # agents running, the router says new
        self.assertEqual(len(m.agents), 2)
        m.handle('make it rhyme')                      # the router says agents
        self.assertEqual(len(m.agents), 2)

    def test_plain_text_and_all_reach_every_agent_and_agents_can_read_chat(self):
        m = self.m
        m.handle('/task --small one'); m.handle('/task --small two')
        ids = list(m.agents)
        m.handle('change of plan')
        for i in ids:
            self.assertTrue(wait(lambda i=i: (i, 'got: [chat from the collaborator]\nchange of plan') in self.said))
        m.handle('@all stop now')
        self.assertTrue(wait(lambda: (ids[0], 'got: [chat from the collaborator]\nstop now') in self.said))
        lines = m.serve({'op': 'read', 'id': ids[0], 'n': 10})['lines']
        self.assertTrue(any('collaborator: change of plan' in l for l in lines))
        self.assertFalse(m.serve({'op': 'read', 'id': 'zzzz'})['ok'])

    def test_big_task_spawns_coordinator_with_capped_workers(self):
        m = self.m
        m.handle('/task BIGTASK do many things')
        cid = next(iter(m.agents))
        self.assertEqual(m.agents[cid].role, 'coordinator')
        w1 = m.serve({'op': 'spawn', 'id': cid, 'text': 'piece 1'})['id']
        m.serve({'op': 'spawn', 'id': cid, 'text': 'piece 2'})
        self.assertFalse(m.serve({'op': 'spawn', 'id': cid, 'text': 'piece 3'})['ok'])
        # a worker's result goes to the coordinator, which answers to the chat
        self.assertTrue(wait(lambda: (cid, 'got: [worker %s finished]\ngot: piece 1' % w1) in self.said))

    def test_worker_cannot_spawn_and_limit(self):
        m = self.m
        m.handle('/task --small a')
        aid = next(iter(m.agents))
        self.assertFalse(m.serve({'op': 'spawn', 'id': aid, 'text': 'x'})['ok'])
        m.handle('/task --small b'); m.handle('/task --small c'); m.handle('/task --small d')
        self.assertTrue(any('limit' in t for _, t in self.said))

    def test_post_and_paused(self):
        m = self.m
        m.handle('/task --small a')
        aid = next(iter(m.agents))
        self.assertTrue(m.serve({'op': 'post', 'id': aid, 'text': 'hello group'})['ok'])
        self.assertIn((aid, 'hello group'), self.said)
        self.assertFalse(m.serve({'op': 'post', 'id': 'zzzz', 'text': 'x'})['ok'])
        open(m.PAUSED, 'w').close()
        m.handle('/task --small b')
        self.assertTrue(any('paused' in t for _, t in self.said))

    def test_macos_launch_agent_plist(self):
        import plistlib
        d = plistlib.loads(self.m.build_plist('/usr/bin/python3', '/x/agentd.py', '/opt/homebrew/bin:/usr/bin', '/x/log'))
        self.assertEqual(d['ProgramArguments'], ['/usr/bin/python3', '/x/agentd.py', 'run'])
        self.assertTrue(d['RunAtLoad'] and d['KeepAlive'])
        self.assertEqual(d['EnvironmentVariables']['PATH'], '/opt/homebrew/bin:/usr/bin')
        self.assertIn('/usr/bin', self.m.mac_path())

    def test_remote_agent_chatter_is_delivered_but_never_a_command(self):
        m = self.m
        m.handle('/task --small one')
        aid = next(iter(m.agents))
        n = len(m.agents)
        m.handle('[zed] /task do evil', 'chatter')           # a command inside chatter: only recorded
        m.handle('[zed] hello there', 'chatter')
        self.assertEqual(len(m.agents), n)
        m.handle('[zed] @%s can you check the build' % aid, 'chatter')
        self.assertTrue(wait(lambda: any(w == aid and 'got: [message from Zed' in t and 'can you check the build' in t for w, t in self.said)))
        self.assertTrue(any('zed@remote: hello there' in l for l in m.recent(10)))
        for _ in range(12):
            m.handle('[zed] @%s again' % aid, 'chatter')
        self.assertLessEqual(len(m.remote_hits[('zed', aid)]), m.REMOTE_MAX)
        m.handle('[zed] @nobody hi', 'chatter')                # not a running agent: nothing starts
        self.assertEqual(len(m.agents), n)

    def test_peer_without_command_rights_is_only_recorded(self):
        m = self.m
        m.cfg['accept_peer_commands'] = False
        chat = os.path.join(m.CH, 'x'); os.makedirs(chat)
        def entry(i, text):
            p = os.path.join(chat, 'chat-%s.md' % i); open(p, 'w').write(text)
            return {'id': i, 'channel': 'x', 'dir': 'in', 'chat': True, 'verified': True, 'path': p}
        idx = os.path.join(m.CH, 'index.json')
        json.dump([], open(idx, 'w'))
        m.channel_cmd = lambda *a, **k: (0, '')
        st = {}
        m.inbound(st)
        json.dump([entry('p1', 'please run a task'), entry('p2', '[amy] @bob hi')], open(idx, 'w'))
        self.assertEqual([(t, w) for _, t, w in m.inbound(st)], [('please run a task', 'peer'), ('[amy] @bob hi', 'chatter')])
        m.handle('please run a task', 'peer')
        self.assertEqual(len(m.agents), 0)

    def test_setup_picks_the_only_channel_and_runs_once(self):
        m = self.m
        os.makedirs(m.CH, exist_ok=True)
        json.dump({'channels': {'hunter': {}}}, open(os.path.join(m.CH, 'channels.json'), 'w'))
        calls = []
        m.install = lambda now: calls.append(now) or 'installed'
        up = {'v': False}
        def fake_install(now):
            calls.append(now); up['v'] = True; return 'installed'
        m.install = fake_install
        m.running = lambda: up['v']
        if os.path.exists(m.CONF): os.remove(m.CONF)
        out = m.setup(['--auto'])
        c = json.load(open(m.CONF))
        self.assertEqual((c['channel'], c['accept_peer_commands'], c['tools']), ('hunter', False, 'safe'))
        self.assertEqual(calls, [True])
        self.assertIn(('agentd', 'online and linked. Message my agents by starting a line with @<their name>.'), self.said)
        self.assertEqual(m.setup(['--auto']), '')              # already done: silent, nothing reinstalled
        self.assertEqual(calls, [True])
        os.remove(m.SETUP_MARK)
        os.remove(os.path.join(m.CH, 'channels.json'))
        self.assertEqual(m.setup(['--auto']), '')              # no channel yet: silent in auto mode
        self.assertIn('No secure channel', m.setup([]))

    def test_idle_agents_are_done_rows_and_restart_sweeps_orphans(self):
        m = self.m
        m.PROGRESS = os.path.join(self.d, 'progress2')
        os.makedirs(m.PROGRESS)
        json.dump({'title': 'old', 'agent': True}, open(os.path.join(m.PROGRESS, 'agent-ghost.json'), 'w'))
        json.dump({'title': 'a real job'}, open(os.path.join(m.PROGRESS, 'agent-notmine.json'), 'w'))
        m.sweep_rows()
        self.assertFalse(os.path.exists(os.path.join(m.PROGRESS, 'agent-ghost.json')))
        self.assertTrue(os.path.exists(os.path.join(m.PROGRESS, 'agent-notmine.json')))
        m.handle('/task --small hello')
        a = next(iter(m.agents.values()))
        self.assertTrue(wait(lambda: a.status == 'idle'))
        m.retire(a)
        row = json.load(open(os.path.join(m.PROGRESS, 'agent-' + a.id + '.json')))
        self.assertIn('got: hello', row['impact'])
        self.assertTrue(a.row_done and not a.retired)
        a.send('more work')
        a.row_done = False
        m.publish(a)
        self.assertNotIn('impact', json.load(open(os.path.join(m.PROGRESS, 'agent-' + a.id + '.json'))))

    def test_unread_gives_session_only_new_collaborator_lines(self):
        m = self.m
        m.record('collaborator', 'old')
        self.assertEqual(m.unread('s-ab12'), [])      # first call: history is not replayed
        m.record('agent1', 'mine'); m.record('collaborator', 'do the thing')
        self.assertEqual(m.unread('s-ab12'), ['collaborator: do the thing'])
        self.assertEqual(m.unread('s-ab12'), [])      # shown once
        self.assertEqual(m.unread('s-zz99'), [])      # another session starts its own cursor

    def test_agent_rows_for_the_status_panel(self):
        m = self.m
        m.PROGRESS = os.path.join(self.d, 'progress')
        m.handle('/task BIGTASK do many things')
        cid = next(iter(m.agents))
        w = m.serve({'op': 'spawn', 'id': cid, 'text': 'piece'})['id']
        self.assertTrue(wait(lambda: m.agents[w].status == 'idle'))
        for a in list(m.agents.values()):
            m.publish(a)
        row = json.load(open(os.path.join(m.PROGRESS, 'agent-' + w + '.json')))
        self.assertEqual(row['parent'], 'agent-' + cid)
        crow = json.load(open(os.path.join(m.PROGRESS, 'agent-' + cid + '.json')))
        self.assertEqual((crow['done'], crow['total']), (1, 1))
        m.agents[w].stop(); m.agents[w].result = 'all done'
        m.retire(m.agents[w])
        self.assertIn('all done', json.load(open(os.path.join(m.PROGRESS, 'agent-' + w + '.json')))['impact'])

    def test_inbound_skips_history_then_reads_new_peer_lines(self):
        m = self.m
        chat = os.path.join(m.CH, 'x'); os.makedirs(chat)
        def entry(i, d='in', ok=True):
            p = os.path.join(chat, 'chat-%s.md' % i)
            open(p, 'w').write('/task hi ' + i)
            return {'id': i, 'channel': 'x', 'dir': d, 'chat': True, 'verified': ok, 'path': p}
        idx = os.path.join(m.CH, 'index.json')
        json.dump([entry('old1')], open(idx, 'w'))
        m.channel_cmd = lambda *a, **k: (0, '')
        st = {}
        self.assertEqual(m.inbound(st), [])
        json.dump([entry('old1'), entry('new1'), entry('mine', 'out'), entry('bad', ok=False)], open(idx, 'w'))
        self.assertEqual([(t, w) for _, t, w in m.inbound(st)], [('/task hi new1', 'collaborator'), ('/task hi mine', 'owner')])
        self.assertEqual(m.inbound(st), [])


if __name__ == '__main__':
    unittest.main()
