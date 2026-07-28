// Which URLs KNote is willing to hand to the OS default browser.
//
// Note content is just text on disk — anything can end up inside a
// `[text](url)`, including `javascript:` or `file:` targets. Both ends of the
// hop validate: the webview so a bad link is inert on click, and the host
// (hostHandlers.openExternal) so the webview can never be the only gate.
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
