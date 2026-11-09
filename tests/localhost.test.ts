import { expect, test } from 'claude-code/testing'

import { localRows, parseCwds, parseListen, parsePsEnv, portsOf, projectDir, shortArgs } from '../hooks/localhost'

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
