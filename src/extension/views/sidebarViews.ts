// The KNote activity-bar webview views: Search, Backlinks, Properties.
// Each is a small React app served through the shared webview shell + RPC.

import * as vscode from 'vscode'
import { currentVaultRoot } from '../engine'
import { relForUri } from '../paths'
import { attach, broadcast } from '../rpc/webviewRpc'
import { createHostHandlers } from '../rpc/hostHandlers'
import { webviewHtml, webviewResourceRoots } from './webviewHtml'

let lastSearchQuery = ''
let searchViewInstance: vscode.WebviewView | undefined

function activeNoteRel(): string | null {
  const editor = vscode.window.activeTextEditor
  return editor ? relForUri(editor.document.uri) : null
}

class KnoteViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly view: string,
    private readonly title: string,
    private readonly bootstrap: () => Record<string, unknown>,
    private readonly onResolve?: (webviewView: vscode.WebviewView) => void
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: webviewResourceRoots(this.context.extensionUri, currentVaultRoot())
    }
    const rpc = attach(webviewView.webview, createHostHandlers())
    webviewView.webview.html = webviewHtml(
      webviewView.webview,
      this.context.extensionUri,
      this.view,
      this.title,
      this.bootstrap()
    )
    webviewView.onDidDispose(() => rpc.dispose())
    this.onResolve?.(webviewView)
  }
}

/** Reveal the Search view and run a query in it (Tags tree, knote.searchVault). */
export async function searchFor(query: string): Promise<void> {
  lastSearchQuery = query
  await vscode.commands.executeCommand('knote.search.focus')
  broadcast('searchFor', query)
}

export function registerSidebarViews(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'knote.search',
      new KnoteViewProvider(
        context,
        'search',
        'Search',
        () => ({ query: lastSearchQuery }),
        (view) => {
          searchViewInstance = view
        }
      )
    ),
    vscode.window.registerWebviewViewProvider(
      'knote.backlinks',
      new KnoteViewProvider(context, 'backlinks', 'Backlinks', () => ({
        activeNote: activeNoteRel()
      }))
    ),
    vscode.window.registerWebviewViewProvider(
      'knote.properties',
      new KnoteViewProvider(context, 'properties', 'Properties', () => ({
        activeNote: activeNoteRel()
      }))
    ),
    vscode.commands.registerCommand('knote.searchVault', async () => {
      await vscode.commands.executeCommand('knote.search.focus')
      searchViewInstance?.show?.(false)
    })
  )
}
