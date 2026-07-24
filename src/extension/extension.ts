import * as vscode from 'vscode'
import { findVaultRoot, initializeVault, maybeSuggestInitialize } from './vault'
import { startEngine, stopEngine } from './engine'
import { registerDocSync } from './docSync'
import { registerAttachmentAutoCleanup } from './attachmentAutoCleanup'
import { registerWikiLinks } from './providers/wikiLinks'
import { registerCompletions } from './providers/completions'
import { registerHover } from './providers/hover'
import { registerDecorations } from './providers/decorations'
import { registerPasteImage } from './providers/pasteImage'
import { registerAllCommands } from './commands'
import { registerRpcBroadcasts } from './rpc/webviewRpc'
import { registerBoardPanel } from './views/boardPanel'
import { registerPanels } from './views/panels'
import { registerLiveEditor } from './views/liveEditorProvider'
import { registerSidebarViews } from './views/sidebarViews'
import { registerTagsTree } from './trees/tagsTree'
import { registerQuickAccessTrees } from './trees/quickAccess'
import { registerWeeklyTree } from './trees/weeklyTree'

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel('KNote')
  context.subscriptions.push(log)

  // Providers and commands are registered unconditionally (package.json
  // declares them); each one no-ops or warns when no vault is open.
  registerWikiLinks(context)
  registerCompletions(context)
  registerHover(context)
  registerDecorations(context)
  registerPasteImage(context)
  registerAllCommands(context)
  registerBoardPanel(context)
  registerPanels(context)
  registerLiveEditor(context)
  registerSidebarViews(context)
  registerTagsTree(context)
  registerQuickAccessTrees(context)
  registerWeeklyTree(context)
  registerRpcBroadcasts(context)

  const start = async (root: string): Promise<void> => {
    try {
      await startEngine(root, log)
      registerDocSync(context)
      registerAttachmentAutoCleanup(context)
    } catch (err) {
      log.appendLine(`Failed to start: ${err instanceof Error ? err.message : String(err)}`)
      void vscode.window.showErrorMessage(
        'KNote failed to open the vault — see the KNote output channel.'
      )
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('knote.initializeVault', async () => {
      const root = await initializeVault()
      if (!root) return
      await start(root)
      void vscode.window.showInformationMessage('KNote vault initialized.')
    })
  )

  const root = await findVaultRoot()
  if (root) {
    await start(root)
  } else {
    void maybeSuggestInitialize(context, async () => {
      const initialized = await initializeVault()
      if (initialized) await start(initialized)
    })
  }
}

export async function deactivate(): Promise<void> {
  await stopEngine()
}
