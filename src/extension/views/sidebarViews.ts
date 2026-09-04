// The KNote activity-bar webview views: Search, Backlinks, Outline, Properties.
// Each is a small React app served through the shared webview shell + RPC.

import * as vscode from 'vscode'
import { currentVaultRoots } from '../engine'
import { attach, broadcast, currentActiveNoteRel } from '../rpc/webviewRpc'
import { createHostHandlers } from '../rpc/hostHandlers'
import {
  webviewHtml,
  webviewResourceRoots,
  trackResourceRoots,
  untrackResourceRoots
} from './webviewHtml'

let lastSearchQuery = ''
let searchViewInstance: vscode.WebviewView | undefined

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
      localResourceRoots: webviewResourceRoots(this.context.extensionUri, currentVaultRoots())
    }
    trackResourceRoots(webviewView.webview, this.context.extensionUri)
    webviewView.onDidDispose(() => untrackResourceRoots(webviewView.webview))

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
        activeNote: currentActiveNoteRel()
      }))
    ),
    vscode.window.registerWebviewViewProvider(
      'knote.outline',
      new KnoteViewProvider(context, 'outline', 'Outline', () => ({
        activeNote: currentActiveNoteRel()
      }))
    ),
    vscode.window.registerWebviewViewProvider(
      'knote.properties',
      new KnoteViewProvider(context, 'properties', 'Properties', () => ({
        activeNote: currentActiveNoteRel()
      }))
    ),
    vscode.commands.registerCommand('knote.searchVault', async () => {
      await vscode.commands.executeCommand('knote.search.focus')
      searchViewInstance?.show?.(false)
    })
  )
}
