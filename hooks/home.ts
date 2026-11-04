import type { EngineInterface } from 'claude-code'

let home = ''

/** The home folder from $HOME (or %USERPROFILE%), cached; '' when unset. */
export async function resolveHome($: EngineInterface): Promise<string> {
  if (home) return home
  home = ((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '').replace(/[\\/]+$/, '')
  return home
}
