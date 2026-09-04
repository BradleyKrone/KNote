// Singleton editor-area WebviewPanels for the Planner, Machine Log, Graph, and
// KNote Settings. Unlike the board these rebuild from the index snapshot on
// reopen, so no retainContextWhenHidden.

import * as vscode from 'vscode'
import { currentVaultRoot, currentVaultRoots } from '../engine'
import { attach } from '../rpc/webviewRpc'
import { createHostHandlers } from '../rpc/hostHandlers'
import {
  webviewHtml,
  webviewResourceRoots,
  trackResourceRoots,
  untrackResourceRoots
} from './webviewHtml'

interface PanelDef {
  command: string
  viewType: string
  view: string
  title: string
}

const PANELS: PanelDef[] = [
  {
    command: 'knote.openPlanner',
    viewType: 'knote.planner',
    view: 'planner',
    title: 'KNote Planner'
  },
  {
    command: 'knote.openMachineLog',
    viewType: 'knote.machineLog',
    view: 'machineLog',
    title: 'KNote Machine Log'
  },
  { command: 'knote.openGraph', viewType: 'knote.graph', view: 'graph', title: 'KNote Graph' },
  {
    command: 'knote.openSettings',
    viewType: 'knote.settings',
    view: 'settings',
    title: 'KNote Settings'
  }
]

export function registerPanels(context: vscode.ExtensionContext): void {
  const open = new Map<string, vscode.WebviewPanel>()

  for (const def of PANELS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(def.command, () => {
        if (!currentVaultRoot()) {
          void vscode.window.showWarningMessage('KNote: no vault is open in this workspace.')
          return
        }
        const existing = open.get(def.viewType)
        if (existing) {
          existing.reveal()
          return
        }
        const panel = vscode.window.createWebviewPanel(
          def.viewType,
          def.title,
          vscode.ViewColumn.Active,
          {
            enableScripts: true,
            localResourceRoots: webviewResourceRoots(context.extensionUri, currentVaultRoots())
          }
        )
        open.set(def.viewType, panel)
        trackResourceRoots(panel.webview, context.extensionUri)
        const rpc = attach(panel.webview, createHostHandlers())
        panel.webview.html = webviewHtml(panel.webview, context.extensionUri, def.view, def.title)
        panel.onDidDispose(() => {
          rpc.dispose()
          untrackResourceRoots(panel.webview)
          open.delete(def.viewType)
        })
      })
    )
  }
}
