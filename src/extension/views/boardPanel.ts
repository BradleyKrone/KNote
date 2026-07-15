// The Kanban board panel: an editor-area WebviewPanel hosting the React
// board app. One panel per scope (global / per-note); retainContextWhenHidden
// keeps drag/filter state alive while other tabs are focused; a serializer
// revives boards across window reloads.

import * as vscode from 'vscode'
import { titleOf } from '@shared/pathUtils'
import { currentVaultRoot } from '../engine'
import { vaultNoteRel } from '../paths'
import { attach } from '../rpc/webviewRpc'
import { createHostHandlers } from '../rpc/hostHandlers'
import { webviewHtml, webviewResourceRoots } from './webviewHtml'

const VIEW_TYPE = 'knote.board'

type BoardScope = { kind: 'global' } | { kind: 'note'; path: string }

const panels = new Map<string, vscode.WebviewPanel>()

function scopeKey(scope: BoardScope): string {
  return scope.kind === 'note' ? `note:${scope.path}` : 'global'
}

function panelTitle(scope: BoardScope): string {
  return scope.kind === 'note' ? `Board — ${titleOf(scope.path)}` : 'KNote Board'
}

function wirePanel(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  scope: BoardScope
): void {
  const key = scopeKey(scope)
  panels.set(key, panel)
  const rpc = attach(panel.webview, createHostHandlers())
  panel.webview.html = webviewHtml(panel.webview, context.extensionUri, 'board', panelTitle(scope), {
    scope
  })
  panel.onDidDispose(() => {
    rpc.dispose()
    panels.delete(key)
  })
}

function openBoard(context: vscode.ExtensionContext, scope: BoardScope): void {
  if (!currentVaultRoot()) {
    void vscode.window.showWarningMessage('KNote: no vault is open in this workspace.')
    return
  }
  const existing = panels.get(scopeKey(scope))
  if (existing) {
    existing.reveal()
    return
  }
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    panelTitle(scope),
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: webviewResourceRoots(context.extensionUri, currentVaultRoot())
    }
  )
  wirePanel(context, panel, scope)
}

export function registerBoardPanel(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('knote.openBoard', () =>
      openBoard(context, { kind: 'global' })
    ),
    vscode.commands.registerCommand('knote.openBoardForNote', () => {
      const editor = vscode.window.activeTextEditor
      const rel = editor ? vaultNoteRel(editor.document) : null
      if (rel === null) {
        void vscode.window.showWarningMessage('KNote: open a vault note first.')
        return
      }
      openBoard(context, { kind: 'note', path: rel })
    }),
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      deserializeWebviewPanel: async (panel, state: { scope?: BoardScope } | undefined) => {
        if (!currentVaultRoot()) {
          panel.dispose()
          return
        }
        panel.webview.options = {
          enableScripts: true,
          localResourceRoots: webviewResourceRoots(context.extensionUri, currentVaultRoot())
        }
        wirePanel(context, panel, state?.scope ?? { kind: 'global' })
      }
    })
  )
}
