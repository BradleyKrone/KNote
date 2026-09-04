// Shared HTML shell for every KNote webview: strict CSP (nothing loads from
// the network — matching KNote's offline rule), the view's bundled JS/CSS
// via asWebviewUri, and a nonce'd bootstrap payload the view reads
// synchronously at startup.

import * as vscode from 'vscode'
import { randomBytes } from 'crypto'

export function webviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  view: string,
  title: string,
  bootstrap: unknown = {}
): string {
  const nonce = randomBytes(16).toString('base64')
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webviews', `${view}.js`)
  )
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webviews', `${view}.css`)
  )
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`
  ].join('; ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>${title}</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.__KNOTE_BOOTSTRAP__ = ${JSON.stringify(bootstrap)};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
}

/**
 * localResourceRoots for KNote webviews: the bundled dist plus every folder the
 * vault spans (for note images). Mounted folders must be in here — outside the
 * list `asWebviewUri` hands back a URI the webview refuses to load, with no
 * error, so their images would just silently fail to render.
 */
export function webviewResourceRoots(
  extensionUri: vscode.Uri,
  vaultRoots: readonly string[]
): vscode.Uri[] {
  return [
    vscode.Uri.joinPath(extensionUri, 'dist'),
    ...vaultRoots.map((root) => vscode.Uri.file(root))
  ]
}

/**
 * Webviews whose resource roots may need widening later. `localResourceRoots`
 * is fixed when a webview is created, but the vault grows a folder whenever
 * the workspace does — without re-setting them, images in a folder mounted
 * after a tab was opened stay unloadable until it's reopened.
 */
const tracked = new Map<vscode.Webview, vscode.Uri>()

export function trackResourceRoots(webview: vscode.Webview, extensionUri: vscode.Uri): void {
  tracked.set(webview, extensionUri)
}

export function untrackResourceRoots(webview: vscode.Webview): void {
  tracked.delete(webview)
}

/** Re-apply resource roots to every live webview after the vault's folders change. */
export function refreshResourceRoots(vaultRoots: readonly string[]): void {
  for (const [webview, extensionUri] of [...tracked]) {
    try {
      webview.options = {
        ...webview.options,
        localResourceRoots: webviewResourceRoots(extensionUri, vaultRoots)
      }
    } catch {
      // The panel was disposed between the restart and this pass.
      tracked.delete(webview)
    }
  }
}
