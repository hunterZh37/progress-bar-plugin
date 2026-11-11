// The hideEmails option (off by default): account emails in the Status panel, its status line and the Chrome part
// show masked ("j•••@example.com"), for screen sharing. Only what is drawn changes, never the saved files.

let hide = false

/** Turns email masking on or off (the hideEmails option). */
export function setHideEmails(on: boolean) { hide = on }
/** True when the hideEmails option is on. */
export const hideEmailsOn = () => hide

const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g

/** Every email in `text` as its first letter, "•••" and its domain: "jane@example.com" -> "j•••@example.com". */
export const maskEmails = (text: string) => text.replace(EMAIL, '$1•••@$2')

/** `text` with emails masked when hideEmails is on, else as it is. */
export const shownEmails = (text: string) => (hide ? maskEmails(text) : text)
