import * as vscode from 'vscode'
import { findVaultRoot, initializeVault, maybeSuggestInitialize } from './vault'
import { startEngine, stopEngine } from './engine'
import { registerDocSync } from './docSync'
import { registerAttachmentAutoCleanup } from './attachmentAutoCleanup'
import { registerRenameLinks } from './renameLinks'
import { extendMarkdownIt } from './markdownItKnote'
import { registerWikiLinks } from './providers/wikiLinks'
import { registerCompletions } from './providers/completions'
import { registerHover } from './providers/hover'
import { registerDecorations } from './providers/decorations'
import { registerPasteImage } from './providers/pasteImage'
import { registerAllCommands } from './commands'
import { broadcast, registerRpcBroadcasts } from './rpc/webviewRpc'
import { registerBoardPanel } from './views/boardPanel'
import { registerPanels } from './views/panels'
import { registerLiveEditor } from './views/liveEditorProvider'
import { registerSidebarViews } from './views/sidebarViews'
import { registerTagsTree } from './trees/tagsTree'
import { registerQuickAccessTrees } from './trees/quickAccess'
import { registerWeeklyTree } from './trees/weeklyTree'

/**
 * What `activate` hands back to VS Code. `extendMarkdownIt` is picked up by the
 * built-in Markdown preview (declared via contributes.markdown.markdownItPlugins)
 * so Reading mode understands `[[wiki links]]`, `![[embeds]]` and `#tags`.
 */
export interface KnoteApi {
  extendMarkdownIt: typeof extendMarkdownIt
}

export async function activate(context: vscode.ExtensionContext): Promise<KnoteApi> {
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
      registerRenameLinks(context)
      // Providers above are registered before the engine starts, so a restored
      // editor or sidebar view can already have asked for the index and been
      // handed a partial one. Tell every attached webview it's safe to re-ask.
      broadcast('indexReady', undefined)
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

  return { extendMarkdownIt }
}

export async function deactivate(): Promise<void> {
  await stopEngine()
}
