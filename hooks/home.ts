import type { EngineInterface } from 'claude-code'

let home = ''

/**
 * The home folder from $HOME (or %USERPROFILE%), cached; '' when unset. PROGRESS_BAR_HOME, when set, stands in for it:
 * a test session keeps all the plugin's files (~/.claude-progress, the status script) under a scratch folder while its
 * own login, which needs the real $HOME, stays as it is.
 */
export async function resolveHome($: EngineInterface): Promise<string> {
  if (home) return home
  home = ((await $.env.get('PROGRESS_BAR_HOME')) || (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '').replace(/[\\/]+$/, '')
  return home
}
