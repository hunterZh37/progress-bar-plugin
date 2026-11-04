/** Status panel: section keys folded in ~/.claude-progress/.state/folded.txt. */
export type Folded = string[]
/** Status panel: the full status line output, colors and links removed. */
export type Lines = string[]

declare module 'claude-code' {
  interface PluginState {
    'progress-bar': { folded: Folded; lines: Lines }
  }
}
