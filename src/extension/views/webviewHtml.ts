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

/** localResourceRoots for KNote webviews: the bundled dist plus the vault (for note images). */
export function webviewResourceRoots(
  extensionUri: vscode.Uri,
  vaultRoot: string | null
): vscode.Uri[] {
  const roots = [vscode.Uri.joinPath(extensionUri, 'dist')]
  if (vaultRoot) roots.push(vscode.Uri.file(vaultRoot))
  return roots
}
