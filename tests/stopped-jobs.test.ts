import { expect, test } from 'claude-code/testing'
import { endedTaskIds, finishedTaskIds } from '../hooks/report'

const stop = '{"type":"tool_use","name":"TaskStop","input":{"task_id":"bd6ngvtpt"}}'
const result = '{"type":"tool_result","content":"{\\"message\\":\\"Successfully stopped task: bfwahc14s (npx next start)\\"}"}'

test('endedTaskIds: a TaskStop call and its result end the task with no task-notification', () => {
  expect(endedTaskIds(stop)).toContain('bd6ngvtpt')
  expect(endedTaskIds(result)).toContain('bfwahc14s')
  expect(endedTaskIds('{"name":"TaskStop","input":{"shell_id":"old123"}}')).toContain('old123')
})

test('finishedTaskIds: a stopped shell counts as over, a running one does not', () => {
  const over = finishedTaskIds(stop + '\n' + result, ['bd6ngvtpt', 'bfwahc14s', 'still1'])
  expect([...over].sort()).toEqual(['bd6ngvtpt', 'bfwahc14s'])
})

test('endedTaskIds: notices still count as before', () => {
  expect(endedTaskIds('<task-id>abc</task-id> x <status>completed</status>')).toEqual(['abc'])
})
