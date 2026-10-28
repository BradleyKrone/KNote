// Which URLs KNote is willing to hand to the OS default browser.
//
// Note content is just text on disk — anything can end up inside a
// `[text](url)`, including `javascript:` targets. Both ends of the hop
// validate: the webview so a bad link is inert on click, and the host
// (hostHandlers.openExternal) so the webview can never be the only gate.
// `file:` links are the one exception, routed separately (see below).
//
// This is not a network call — vscode.env.openExternal hands the URL to the
// OS and KNote itself stays fully offline.

const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/** True when `url` is a well-formed http/https/mailto URL. */
export function isExternalUrl(url: string): boolean {
  try {
    return EXTERNAL_SCHEMES.has(new URL(url).protocol)
  } catch {
    return false
  }
}

// `file:` links come from "Insert ▸ File link…" and open in the OS default
// app. A note is arbitrary text (it may have been written by someone else), so
// a click must never be able to launch a program — anything the OS would run
// rather than open is refused.
const RUNNABLE_EXTS = new Set([
  'exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'msp', 'lnk', 'pif', 'ps1', 'psm1',
  'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'cpl', 'jar', 'reg', 'sh',
  'app', 'command', 'appimage', 'dll', 'url'
]) // prettier-ignore

/** True when `url` is a well-formed `file:` URL (no host) that isn't a runnable file. */
export function isOpenableFileUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'file:' || u.host !== '') return false
    const name = decodeURIComponent(u.pathname).split('/').pop() ?? ''
    const dot = name.lastIndexOf('.')
    if (dot === -1) return true
    return !RUNNABLE_EXTS.has(name.slice(dot + 1).toLowerCase())
  } catch {
    return false
  }
}

/** Percent-encode what a file URL needs to survive inside `[text](url)` (parens included). */
export function encodeFileUrl(href: string): string {
  return href.replace(/\(/g, '%28').replace(/\)/g, '%29')
}
