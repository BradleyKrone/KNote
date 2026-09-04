import * as vscode from 'vscode'
import { findVaultLayout, initializeVault, maybeSuggestInitialize, type VaultLayout } from './vault'
import { chooseVault, manageMountedFolders } from './vaultFolders'
import { currentVaultRoots, startEngine, stopEngine } from './engine'
import { refreshResourceRoots } from './views/webviewHtml'
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
import { registerFilesTree } from './trees/filesTree'
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
  registerFilesTree(context)
  registerTagsTree(context)
  const quickAccessTrees = registerQuickAccessTrees(context)
  registerWeeklyTree(context)
  registerRpcBroadcasts(context)

  // These three push listeners into context.subscriptions, so they must be
  // registered exactly once even though the engine can start more than once
  // (a workspace folder added or removed restarts it). Registering twice would
  // double every index write, attachment cleanup and rename WorkspaceEdit.
  let engineListenersRegistered = false

  const start = async (layout: VaultLayout): Promise<void> => {
    try {
      await startEngine(layout, log)
      if (!engineListenersRegistered) {
        engineListenersRegistered = true
        registerDocSync(context)
        registerAttachmentAutoCleanup(context)
        registerRenameLinks(context)
      }
      // The Boards/Planner trees' hidden-project checkboxes were populated
      // before the vault (and so its config.json) existed; re-sync them now
      // that reading the real config will actually succeed.
      await quickAccessTrees.reload()
      // A restart may have added folders to the vault; webviews created before
      // it can't load resources from them until their roots are widened.
      refreshResourceRoots(currentVaultRoots())
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

  /** The primary vault the user pinned with "KNote: Choose Primary Vault", if any. */
  const preferredPrimary = (): string | undefined =>
    context.workspaceState.get<string>('knote.primaryVault')

  const openVault = async (): Promise<boolean> => {
    const layout = await findVaultLayout(preferredPrimary())
    if (!layout) return false
    await start(layout)
    return true
  }

  // Restarts are serialized and debounced: VS Code fires the folder-change
  // event several times while a workspace is edited, and startEngine replaces
  // the shared `indexBuilt` promise that every webview's hydrate awaits.
  let restartTimer: NodeJS.Timeout | undefined
  let restarting: Promise<void> = Promise.resolve()
  const restart = (): void => {
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      // `.catch` on the chain, not inside it: a restart that throws must not
      // leave the promise rejected, or every later folder change is skipped.
      restarting = restarting
        .then(async () => {
          await stopEngine()
          if (!(await openVault())) broadcast('indexReady', undefined)
        })
        .catch((err) => {
          log.appendLine(
            `Failed to reopen the vault after a workspace change: ` +
              `${err instanceof Error ? err.message : String(err)}`
          )
        })
      void restarting
    }, 300)
  }
  context.subscriptions.push({
    dispose: () => {
      if (restartTimer) clearTimeout(restartTimer)
    }
  })

  context.subscriptions.push(
    vscode.commands.registerCommand('knote.initializeVault', async () => {
      const root = await initializeVault()
      if (!root) return
      await context.workspaceState.update('knote.primaryVault', root)
      if (await openVault()) {
        void vscode.window.showInformationMessage('KNote vault initialized.')
      }
    }),
    vscode.commands.registerCommand('knote.chooseVault', () => chooseVault(context, openVault)),
    vscode.commands.registerCommand('knote.manageMountedFolders', () =>
      manageMountedFolders(restart)
    ),
    // A folder added to (or removed from) the workspace joins or leaves the
    // vault — that is the whole point of mounts, so re-derive the layout.
    vscode.workspace.onDidChangeWorkspaceFolders(() => restart())
  )

  if (!(await openVault())) {
    void maybeSuggestInitialize(context, async () => {
      const initialized = await initializeVault()
      if (initialized) {
        await context.workspaceState.update('knote.primaryVault', initialized)
        await openVault()
      }
    })
  }

  return { extendMarkdownIt }
}

export async function deactivate(): Promise<void> {
  await stopEngine()
}
