import { expect, test } from 'claude-code/testing'

import { isInfra, localRows, parseCwds, parseIgnore, parseEntry, parseLabels, parseListen, parsePsEnv, portsOf, projectDir, setLabel, shortArgs } from '../hooks/localhost'

test('portsOf: the ports a server command names', () => {
  expect(portsOf('npx vite --config x.mjs --port 5381 --strictPort --host 0.0.0.0')).toEqual([5381])
  expect(portsOf('python3 -I -m http.server 5399 --bind 127.0.0.1 --directory /tmp/x')).toEqual([5399])
  expect(portsOf('PORT=3000 npm run dev')).toEqual([3000])
  expect(portsOf('next dev -p 4000')).toEqual([4000])
  expect(portsOf('curl http://localhost:8080/health && open http://127.0.0.1:8080/')).toEqual([8080])
  expect(portsOf('npm test')).toEqual([])
  expect(portsOf('sleep 30')).toEqual([])
})

test('parseListen: one entry per pid and port, IPv4 and IPv6 counted once', () => {
  const out = 'p101\ncnode\nn*:5381\nn[::1]:5381\np202\ncPython\nn127.0.0.1:5399\n'
  expect(parseListen(out)).toEqual([
    { pid: 101, cmd: 'node', port: 5381 },
    { pid: 202, cmd: 'Python', port: 5399 },
  ])
  expect(parseListen('')).toEqual([])
})

test('parseCwds: each pid\'s working folder', () => {
  expect(parseCwds('p101\nfcwd\nn/Users/a/app\np202\nfcwd\nn/tmp\n')).toEqual({ 101: '/Users/a/app', 202: '/tmp' })
})

test('localRows: shells that name a port, up or down, then listeners inside the project, by port', () => {
  const view = {
    root: '/Users/a/demo',
    at: 0,
    labels: [],
    listening: [
      { pid: 1, cmd: 'node', port: 5381, cwd: '/Users/a/other' },
      { pid: 2, cmd: 'node', port: 5174, cwd: '/Users/a/demo' },
      { pid: 3, cmd: 'postgres', port: 5432, cwd: '/usr/local/var' },
    ],
  }
  const rows = localRows([{ title: 'App server', ports: [5381] }, { title: 'Stage page', ports: [5399] }], view)
  expect(rows.map(r => [r.port, r.up, r.title])).toEqual([
    [5174, true, 'node'],
    [5381, true, 'App server'],
    [5399, false, 'Stage page'],
  ])
  expect(rows[0].url).toBe('http://localhost:5174/')
  // a listener outside the project that no shell named is not listed (postgres)
  expect(rows.some(r => r.port === 5432)).toBe(false)
})

test('parsePsEnv: the starting Claude Code session and the command line without the environment', () => {
  const out = '57414 node /x/node_modules/.bin/vite --port 5381 TERM=xterm CLAUDE_CODE_SESSION_ID=52246fb5-41c3 HOME=/Users/a\n  900 /usr/sbin/sshd -D\n'
  const r = parsePsEnv(out)
  expect(r.started).toEqual({ 57414: '52246fb5-41c3' })
  expect(r.args[57414]).toBe('node /x/node_modules/.bin/vite --port 5381')
  expect(r.args[900]).toBe('/usr/sbin/sshd -D')
})

test('projectDir and shortArgs', () => {
  expect(projectDir('/Users/a/Desktop/halo-loft22-demo')).toBe('-Users-a-Desktop-halo-loft22-demo')
  expect(shortArgs('node /x/node_modules/.bin/vite --config /tmp/a/vite.onecard.mjs --port 5381 --strictPort --host 0.0.0.0')).toBe('node vite --config vite.onecard.mjs --port 5381')
})

test('localRows: a listener a session of this project started is listed, wherever its folder', () => {
  const view = { root: '/Users/a/demo', at: 0, listening: [{ pid: 1, cmd: 'node', port: 5381, cwd: '/Users/a/other', mine: true, args: 'node vite --port 5381' }] }
  expect(localRows([], view).map(r => [r.port, r.title])).toEqual([[5381, 'node vite --port 5381']])
})

test('parseLabels and setLabel: named pages, two on one port, round trip', () => {
  const text = '# names\n5381/__stage/\tThree phones + dashboard\n5381/__stage/one.html  One phone\n5174 Playground\nbad line\n'
  const l = parseLabels(text)
  expect(l).toEqual([
    { port: 5381, path: '/__stage/', label: 'Three phones + dashboard' },
    { port: 5381, path: '/__stage/one.html', label: 'One phone' },
    { port: 5174, path: '/', label: 'Playground' },
  ])
  const renamed = parseLabels(setLabel(l, 5174, '/', 'The playground'))
  expect(renamed.find(x => x.port === 5174)?.label).toBe('The playground')
  expect(parseLabels(setLabel(l, 5174, '/', '')).some(x => x.port === 5174)).toBe(false)
})

test('parseEntry: what the person types to add a page', () => {
  expect(parseEntry('5381/__stage/one.html One phone')).toEqual({ port: 5381, path: '/__stage/one.html', label: 'One phone' })
  expect(parseEntry('http://localhost:5381/club Dashboard')).toEqual({ port: 5381, path: '/club', label: 'Dashboard' })
  expect(parseEntry('just words')).toBe(null)
})

test('localRows: named pages first-class, their port not listed again, Claude helpers never listed', () => {
  const view = {
    root: '/Users/a/demo', at: 0,
    labels: [{ port: 5381, path: '/__stage/', label: 'Three phones' }, { port: 5381, path: '/__stage/one.html', label: 'One phone' }],
    listening: [
      { pid: 1, cmd: 'node', port: 5381, cwd: '/x', mine: true, args: 'node vite --port 5381' },
      { pid: 2, cmd: 'claude', port: 49608, cwd: '/Users/a/demo', mine: true, args: 'claude bg-spare --bg-spare x' },
    ],
  }
  const rows = localRows([], view)
  expect(rows.map(r => [r.url, r.title, r.named, r.up])).toEqual([
    ['http://localhost:5381/__stage/', 'Three phones', true, true],
    ['http://localhost:5381/__stage/one.html', 'One phone', true, true],
  ])
})

test('localRows: Docker and system listeners hidden, the project dev server and named pages kept, ignore file respected', () => {
  const view = {
    root: '/Users/a/demo',
    at: 0,
    labels: [{ port: 5432, path: '/', label: 'My db page' }],
    ignore: parseIgnore('# mine\nmyhelper\n8999\n'),
    listening: [
      { pid: 1, cmd: 'com.docker.backend', port: 55321, cwd: '/Users/a/demo', mine: true, args: 'com.docker.backend services' },
      { pid: 2, cmd: 'ControlCe', port: 7000, cwd: '/Users/a/demo', mine: true },
      { pid: 3, cmd: 'node', port: 3000, cwd: '/Users/a/demo', http: true },
      { pid: 4, cmd: 'postgres', port: 5432, cwd: '/Users/a/demo' },
      { pid: 5, cmd: 'myhelper', port: 4100, cwd: '/Users/a/demo' },
      { pid: 6, cmd: 'node', port: 8999, cwd: '/Users/a/demo' },
      { pid: 7, cmd: 'node', port: 9229, cwd: '/Users/a/demo', http: false },
      { pid: 8, cmd: 'vpnkit-br', port: 55322, cwd: '/' },
    ],
  }
  const rows = localRows([{ title: 'Start dev server', ports: [3000] }, { title: 'docker', ports: [55322] }], view)
  expect(rows.map(r => [r.port, r.title])).toEqual([[3000, 'Start dev server'], [5432, 'My db page']])
  expect(isInfra({ cmd: 'Spotify', port: 57621 })).toBe(true)
  expect(isInfra({ cmd: 'rapportd', port: 49152 })).toBe(true)
  expect(isInfra({ cmd: 'node', port: 3000 })).toBe(false)
  expect(isInfra({ cmd: 'node', port: 8999 }, ['8999'])).toBe(true)
})
