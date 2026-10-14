// The Kanban board panel: an editor-area WebviewPanel hosting the React
// board app. One panel per scope (global / per-note); retainContextWhenHidden
// keeps drag/filter state alive while other tabs are focused; a serializer
// revives boards across window reloads.

import * as vscode from 'vscode'
import type { DeliverableScopeFilter } from '@shared/deliverables'
import type { TaskDialogSize } from '@shared/hostApi'
import { titleOf } from '@shared/pathUtils'
import { currentVaultRoot, currentVaultRoots } from '../engine'
import { vaultNoteRel } from '../paths'
import { attach, broadcast } from '../rpc/webviewRpc'
import { createHostHandlers } from '../rpc/hostHandlers'
import { attachmentUriFor, openWithDrawio } from './attachmentUri'
import {
  webviewHtml,
  webviewResourceRoots,
  trackResourceRoots,
  untrackResourceRoots
} from './webviewHtml'

const VIEW_TYPE = 'knote.board'

type BoardScope = { kind: 'global' } | { kind: 'note'; path: string }

const panels = new Map<string, vscode.WebviewPanel>()

function scopeKey(scope: BoardScope): string {
  return scope.kind === 'note' ? `note:${scope.path}` : 'global'
}

function panelTitle(scope: BoardScope): string {
  return scope.kind === 'note' ? `Board — ${titleOf(scope.path)}` : 'KNote Board'
}

/** globalState key for the board task editor's dragged size (see HostApi.getTaskDialogSize). */
const TASK_DIALOG_SIZE_KEY = 'knote.taskDialogSize'

function isTaskDialogSize(v: unknown): v is TaskDialogSize {
  const s = v as TaskDialogSize | null
  return (
    typeof s === 'object' &&
    s !== null &&
    Number.isFinite(s.w) &&
    Number.isFinite(s.h) &&
    s.w > 0 &&
    s.h > 0
  )
}

function readTaskDialogSize(context: vscode.ExtensionContext): TaskDialogSize | null {
  const stored = context.globalState.get<unknown>(TASK_DIALOG_SIZE_KEY)
  return isTaskDialogSize(stored) ? stored : null
}

function wirePanel(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  scope: BoardScope,
  initialFilter?: DeliverableScopeFilter
): void {
  const key = scopeKey(scope)
  panels.set(key, panel)
  let rpc: vscode.Disposable | undefined
  // Registered before anything else in here can throw, so the map entry above
  // can never outlive its panel. Only clear the entry if it's still ours: two
  // boards of the same scope can coexist (a restored tab revived after auto-open
  // already made one), and closing the older must not orphan the newer.
  panel.onDidDispose(() => {
    rpc?.dispose()
    untrackResourceRoots(panel.webview)
    if (panels.get(key) === panel) panels.delete(key)
  })
  trackResourceRoots(panel.webview, context.extensionUri)
  // Plus the two attachment handlers, which are per-panel everywhere because
  // they need a note to resolve against. A board has no single note — its cards
  // come from all over the vault — so the webview resolves references against
  // the card's own note first and sends vault-root-relative paths (a leading
  // `/`, which `resolveEmbedPath` reads as exactly that). The board's task
  // editor is a full live-preview editor, so without these its images, embeds,
  // hover previews and draw.io links would all reject as unknown methods.
  rpc = attach(panel.webview, {
    ...createHostHandlers(),
    attachmentUri: (src: string) => attachmentUriFor(src, null, panel.webview),
    openWithDrawio: (src: string) => openWithDrawio(src, null),
    getTaskDialogSize: () => readTaskDialogSize(context),
    setTaskDialogSize: (size: TaskDialogSize | null) =>
      context.globalState.update(TASK_DIALOG_SIZE_KEY, isTaskDialogSize(size) ? size : undefined)
  })
  panel.webview.html = webviewHtml(
    panel.webview,
    context.extensionUri,
    'board',
    panelTitle(scope),
    {
      scope,
      initialFilter,
      // In the bootstrap so the first card opened doesn't flash the default
      // size while an RPC round-trip fetches the saved one.
      taskDialogSize: readTaskDialogSize(context)
    }
  )
}

/**
 * Reveal the already-open board for this scope and push `filter` to it.
 * Returns false when there is none to reveal — including a stale reference to
 * a disposed panel, whose reveal() throws "Webview is disposed". That entry is
 * dropped so the caller opens a fresh board; left in place, every later click
 * on the Kanban icon would hit the same dead panel (the auto-open swallows the
 * error) and the board would stay unopenable until VS Code restarted.
 */
function revealExisting(scope: BoardScope, filter: DeliverableScopeFilter): boolean {
  const key = scopeKey(scope)
  const existing = panels.get(key)
  if (!existing) return false
  try {
    existing.reveal()
  } catch {
    panels.delete(key)
    return false
  }
  broadcast('boardFilterChanged', filter)
  return true
}

function openBoard(context: vscode.ExtensionContext, scope: BoardScope): void {
  if (!currentVaultRoot()) {
    void vscode.window.showWarningMessage('KNote: no vault is open in this workspace.')
    return
  }
  // Undo any project/deliverable narrowing left over from openBoardWithFilter
  // — this is the plain "open the board" entry point, so it should always
  // land on an unfiltered board rather than whatever was last picked.
  if (revealExisting(scope, { kind: 'all' })) return
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    panelTitle(scope),
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: webviewResourceRoots(context.extensionUri, currentVaultRoots())
    }
  )
  wirePanel(context, panel, scope)
}

/**
 * Reveal (or open) the whole-vault board with a project/deliverable filter
 * applied — the Boards tree's "Filter by Project" section. Always targets the
 * global board: deliverables span notes, so filtering only makes sense there.
 * An already-open panel gets the filter pushed live via broadcast; a fresh one
 * gets it baked into its bootstrap payload.
 */
export function openBoardWithFilter(
  context: vscode.ExtensionContext,
  filter: DeliverableScopeFilter
): void {
  if (!currentVaultRoot()) {
    void vscode.window.showWarningMessage('KNote: no vault is open in this workspace.')
    return
  }
  const scope: BoardScope = { kind: 'global' }
  if (revealExisting(scope, filter)) return
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    panelTitle(scope),
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: webviewResourceRoots(context.extensionUri, currentVaultRoots())
    }
  )
  wirePanel(context, panel, scope, filter)
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
          localResourceRoots: webviewResourceRoots(context.extensionUri, currentVaultRoots())
        }
        wirePanel(context, panel, state?.scope ?? { kind: 'global' })
      }
    })
  )
}
