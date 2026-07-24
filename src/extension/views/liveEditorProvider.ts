// KNote Live Preview — a CustomTextEditorProvider whose webview runs a
// CodeMirror 6 editor (live-preview rendering lives in the webview). This
// file is only the host half: it owns the two-way text sync between the
// CodeMirror view and the underlying TextDocument.
//
// Because the note is a real open TextDocument, the rest of KNote keeps
// working untouched: docSync reindexes on every change (so the board updates
// live), board writes go through verifiedEdit which finds this open document
// and applies a WorkspaceEdit — which lands here as an external change and is
// pushed back into CodeMirror. VS Code owns the undo/redo stack for the
// document; CodeMirror does not keep a competing history.

import * as vscode from 'vscode'
import type { CmEdit, EditorSyncMessage } from '@shared/editorSync'
import { isEditorSyncMessage } from '@shared/editorSync'
import { isImage, resolveEmbedPath } from '@shared/pathUtils'
import { relForUri } from '../paths'
import { toAbs } from '../../core/vaultService'
import { attach } from '../rpc/webviewRpc'
import { createHostHandlers } from '../rpc/hostHandlers'
import { currentVaultRoot } from '../engine'
import { webviewHtml, webviewResourceRoots } from './webviewHtml'

/** Resolve a note-relative image/embed reference to a webview-safe URI. */
function attachmentUriFor(
  src: string,
  document: vscode.TextDocument,
  webview: vscode.Webview
): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src // data:, already a URI
  const noteRel = relForUri(document.uri)
  const folder = noteRel && noteRel.includes('/') ? noteRel.slice(0, noteRel.lastIndexOf('/')) : ''
  const rel = resolveEmbedPath(folder, src)
  if (!rel || !isImage(rel)) return null
  try {
    return webview.asWebviewUri(vscode.Uri.file(toAbs(rel))).toString()
  } catch {
    return null // escapes the vault
  }
}

const LIVE_EDITOR_VIEW_TYPE = 'knote.liveEditor'

// Panels currently rendering a note in the live editor, keyed by document URI,
// so openNoteInLiveEditor can reveal a line in an already-open note. Lines
// requested before a panel exists are stashed here and read into the webview
// bootstrap when resolveCustomTextEditor runs for that URI.
const openPanels = new Map<string, vscode.WebviewPanel>()
const pendingReveal = new Map<string, number>()

/**
 * Open a note in the live-preview editor (not the raw text editor), optionally
 * jumping to a 0-based line. Used by the board/timeline/etc. so clicking a task
 * lands in live preview. If the note is already open, it's focused and the line
 * is revealed in place; otherwise the line rides along in the webview bootstrap.
 */
export async function openNoteInLiveEditor(uri: vscode.Uri, line?: number): Promise<void> {
  const key = uri.toString()
  const existing = openPanels.get(key)
  if (existing) {
    existing.reveal(vscode.ViewColumn.One)
    if (line !== undefined) void existing.webview.postMessage({ type: 'knote:reveal-line', line })
    return
  }
  if (line !== undefined) pendingReveal.set(key, line)
  await vscode.commands.executeCommand(
    'vscode.openWith',
    uri,
    LIVE_EDITOR_VIEW_TYPE,
    vscode.ViewColumn.One
  )
}

class LiveEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const webview = panel.webview
    webview.options = {
      enableScripts: true,
      localResourceRoots: webviewResourceRoots(this.context.extensionUri, currentVaultRoot())
    }

    // Host-side text mirror. When CodeMirror sends edits we apply them and
    // remember the resulting text; the change event that echoes back then
    // matches and is not pushed to the webview. Any change whose result does
    // NOT match is an external edit (board write, undo, another tab, disk)
    // and is forwarded to CodeMirror.
    let lastText = document.getText()
    let applyingWebviewEdit = false
    let editQueue: Promise<void> = Promise.resolve()

    const post = (msg: EditorSyncMessage): void => {
      void webview.postMessage(msg)
    }

    const applyWebviewEdits = (edits: CmEdit[]): void => {
      editQueue = editQueue.then(async () => {
        const edit = new vscode.WorkspaceEdit()
        for (const e of edits) {
          edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(e.from), document.positionAt(e.to)),
            e.insert
          )
        }
        applyingWebviewEdit = true
        try {
          await vscode.workspace.applyEdit(edit)
        } finally {
          applyingWebviewEdit = false
        }
        lastText = document.getText()
      })
    }

    const msgSub = webview.onDidReceiveMessage((raw: unknown) => {
      if (!isEditorSyncMessage(raw)) return // RPC messages are handled by attach()
      if (raw.type === 'knote:cm-edits') applyWebviewEdits(raw.edits)
    })

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return
      const current = e.document.getText()
      if (applyingWebviewEdit) {
        // Echo of our own edit — already reflected in CodeMirror.
        lastText = current
        return
      }
      if (current === lastText) return
      lastText = current
      post({ type: 'knote:host-update', text: current })
    })

    // RPC channel (openWikiTarget, setTaskStatusMeta, readFile, …) shared
    // with every other KNote webview, plus attachmentUri bound to this panel.
    const rpc = attach(webview, {
      ...createHostHandlers(),
      attachmentUri: (src: string) => attachmentUriFor(src, document, webview)
    })

    const key = document.uri.toString()
    openPanels.set(key, panel)
    const revealLine = pendingReveal.get(key)
    pendingReveal.delete(key)

    webview.html = webviewHtml(webview, this.context.extensionUri, 'editor', 'KNote', {
      path: relForUri(document.uri),
      text: document.getText(),
      eol: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
      ...(revealLine !== undefined ? { line: revealLine } : {})
    })

    panel.onDidDispose(() => {
      if (openPanels.get(key) === panel) openPanels.delete(key)
      msgSub.dispose()
      changeSub.dispose()
      rpc.dispose()
    })
  }
}

export function registerLiveEditor(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      LIVE_EDITOR_VIEW_TYPE,
      new LiveEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false
      }
    ),
    vscode.commands.registerCommand('knote.openLivePreview', (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri
      if (!target) {
        void vscode.window.showWarningMessage('KNote: no note is open to preview.')
        return
      }
      void vscode.commands.executeCommand('vscode.openWith', target, LIVE_EDITOR_VIEW_TYPE)
    }),
    vscode.commands.registerCommand('knote.reopenAsText', (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri
      if (!target) {
        void vscode.window.showWarningMessage('KNote: no note is open.')
        return
      }
      void vscode.commands.executeCommand('vscode.openWith', target, 'default')
    })
  )
}
