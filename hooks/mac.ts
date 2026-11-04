import type { EngineInterface } from 'claude-code'

// `/progress-bar setup mac-clicks`: a tiny AppleScript app that owns the progressbar:// URL scheme.
// Clicking a section header (an OSC 8 link to progressbar://toggle/<section>) flips that section in folded.txt.

export const APP_REL = 'Applications/ProgressBarToggle.app'
export const SCRIPT_REL = '.claude/progress-bar/ProgressBarToggle.applescript'
export const CLICKS_REL = '.claude-progress/.state/clicks-on'
export const BUNDLE_ID = 'com.hunterzh37.progressbar-toggle'
export const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
const PLISTBUDDY = '/usr/libexec/PlistBuddy'

/** Only these section keys are ever written, so a crafted URL cannot put anything else in folded.txt. */
export const TOGGLE_APPLESCRIPT = String.raw`on open location theURL
	set sec to do shell script "printf %s " & quoted form of theURL & " | sed -E 's#^progressbar://(toggle/)?##; s#[^a-z-].*##'"
	if sec is "to-do" then set sec to "todo"
	if sec is in {"todo", "running", "waiting", "done", "problems"} then
		do shell script "f=$HOME/.claude-progress/.state/folded.txt; mkdir -p \"$(dirname $f)\"; touch $f; if grep -qx " & quoted form of sec & " $f; then grep -vx " & quoted form of sec & " $f > $f.tmp; mv $f.tmp $f; else echo " & quoted form of sec & " >> $f; fi"
	end if
end open location
`

/** PlistBuddy commands that give the app its bundle id, hide it from the Dock and claim progressbar://. */
export const PLIST_COMMANDS = [
  `Set :CFBundleIdentifier ${BUNDLE_ID}`,
  'Add :LSUIElement bool true',
  'Add :CFBundleURLTypes array',
  'Add :CFBundleURLTypes:0 dict',
  'Add :CFBundleURLTypes:0:CFBundleURLName string ProgressBar toggle',
  'Add :CFBundleURLTypes:0:CFBundleURLSchemes array',
  'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string progressbar',
]

/** `mac-clicks`, `--mac-clicks`, optionally followed by `off`: 'on' | 'off', or null when the words are something else. */
export function parseMacClicks(rest: string): 'on' | 'off' | null {
  const m = /^(--)?mac-clicks(?:\s+(on|off))?$/.exec(rest.trim().toLowerCase())
  return m ? (m[2] === 'off' ? 'off' : 'on') : null
}

type Run = { exitCode: number | null; stdout: string; stderr: string }

export async function isDarwin($: EngineInterface): Promise<boolean> {
  try { return (await $.process.run(['uname'])).stdout.trim() === 'Darwin' } catch { return false }
}

export const NOT_MAC = 'Click to fold needs macOS (it registers a progressbar:// URL handler app). On other systems use `/progress-bar fold <section>`.'

export async function macClicks($: EngineInterface, h: string, mode: 'on' | 'off'): Promise<string> {
  if (!(await isDarwin($))) return NOT_MAC
  const app = `${h}/${APP_REL}`
  const script = `${h}/${SCRIPT_REL}`
  const flag = `${h}/${CLICKS_REL}`
  const run = async (argv: string[]): Promise<Run> => {
    try { return await $.process.run(argv) } catch (err) { return { exitCode: 1, stdout: '', stderr: String(err) } }
  }
  const fail = (what: string, r: Run) => `Click to fold: ${what} failed (exit ${r.exitCode}). ${r.stderr.trim()}`.trim()

  if (mode === 'off') {
    await run([LSREGISTER, '-u', app])
    await run(['rm', '-rf', app, script, flag])
    return `Click to fold is off. Removed ${app} and the header links.`
  }

  await $.fs.write(script, TOGGLE_APPLESCRIPT)
  await run(['rm', '-rf', app])
  let r = await run(['osacompile', '-o', app, script])
  if (r.exitCode !== 0) return fail('osacompile', r)
  const plist = `${app}/Contents/Info.plist`
  for (const c of PLIST_COMMANDS) {
    r = await run([PLISTBUDDY, '-c', c, plist])
    if (r.exitCode !== 0 && c.startsWith('Set ')) r = await run([PLISTBUDDY, '-c', c.replace(/^Set (\S+) /, 'Add $1 string '), plist])
    if (r.exitCode !== 0) return fail(`PlistBuddy "${c}"`, r)
  }
  r = await run(['codesign', '--force', '--deep', '-s', '-', app])
  if (r.exitCode !== 0) return fail('codesign', r)
  r = await run([LSREGISTER, '-f', app])
  if (r.exitCode !== 0) return fail('lsregister', r)
  await $.fs.write(flag, '')
  return [
    `Click to fold is on. Built ${app} and registered progressbar://.`,
    'Section headers in the status line are now links. Click one (⌘-click in Ghostty) to fold or unfold it.',
    'Needs a terminal that renders OSC 8 links. Inside tmux or herdr you may need FORCE_HYPERLINK=1 or tmux\'s hyperlinks feature.',
    'Undo with `/progress-bar setup mac-clicks off`.',
  ].join('\n')
}
