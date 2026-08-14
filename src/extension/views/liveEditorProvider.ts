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
//
// The load-bearing invariant of that sync: positions cross this boundary as
// line/character, never as absolute offsets. CodeMirror's document is LF and
// counts a line break as one character; the TextDocument keeps the note's real
// EOL and counts `\r\n` as two. They agree on line and column but not on
// offsets, so EOL translation happens here — at the edge — and nowhere else.

import * as vscode from 'vscode'
import type { CmEdit, EditorSyncMessage } from '@shared/editorSync'
import { applyCmEdits, isEditorSyncMessage } from '@shared/editorSync'
import { relForUri } from '../paths'
import { attachmentUriFor, openWithDrawio } from './attachmentUri'
import { attach, currentActiveNoteRel, setActiveNote } from '../rpc/webviewRpc'
import { createHostHandlers } from '../rpc/hostHandlers'
import { currentVaultRoot } from '../engine'
import { webviewHtml, webviewResourceRoots } from './webviewHtml'

const LIVE_EDITOR_VIEW_TYPE = 'knote.liveEditor'

// Panels currently rendering a note in the live editor, keyed by document URI,
// so openNoteInLiveEditor can reveal a line in an already-open note. Lines
// requested before a panel exists are stashed here and read into the webview
// bootstrap when resolveCustomTextEditor runs for that URI.
const openPanels = new Map<string, vscode.WebviewPanel>()
const pendingReveal = new Map<string, number>()

/** workspaceState key under which a note's collapsed-section text keys are stored. */
const foldStateKey = (path: string): string => `knote.foldState:${path}`

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

    const notePath = relForUri(document.uri)

    // Host-side text mirror. When CodeMirror sends edits we predict the text
    // they will produce and stash it in `expectedText`; the change event that
    // echoes back matches it exactly and is not pushed to the webview. Any
    // change that does NOT match is an external edit (board write, undo,
    // another tab, disk) and is forwarded to CodeMirror.
    //
    // The prediction has to be exact rather than a "we are applying" flag: such
    // a flag has to be held across the applyEdit await, and anything else that
    // changed the document inside that window would be misread as our own echo,
    // silently dropped, and leave the webview permanently diverged from the
    // buffer — with every later edit then addressing a document the host no
    // longer has.
    let lastText = document.getText()
    let expectedText: string | null = null
    let editQueue: Promise<void> = Promise.resolve()

    const eol = (): string => (document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n')

    const post = (msg: EditorSyncMessage): void => {
      void webview.postMessage(msg)
    }

    const applyWebviewEdits = (edits: CmEdit[]): void => {
      editQueue = editQueue.then(async () => {
        const nl = eol()
        // Computed synchronously right before applyEdit, so nothing can slip in
        // between the read and the write and make the prediction wrong.
        expectedText = applyCmEdits(document.getText(), edits, nl)
        const edit = new vscode.WorkspaceEdit()
        for (const e of edits) {
          // Line/character, not offsets — CodeMirror counts a line break as one
          // character while VS Code counts `\r\n` as two, so document.positionAt
          // on a CodeMirror offset lands one character early per preceding line
          // and scatters dropped characters through a CRLF note.
          edit.replace(
            document.uri,
            new vscode.Range(e.from.line, e.from.ch, e.to.line, e.to.ch),
            nl === '\r\n' ? e.insert.replace(/\n/g, nl) : e.insert
          )
        }
        try {
          await vscode.workspace.applyEdit(edit)
        } finally {
          expectedText = null
        }
        lastText = document.getText()
      })
    }

    const msgSub = webview.onDidReceiveMessage((raw: unknown) => {
      if (!isEditorSyncMessage(raw)) return // RPC messages are handled by attach()
      if (raw.type === 'knote:cm-edits') applyWebviewEdits(raw.edits)
      else if (raw.type === 'knote:fold-state' && notePath) {
        void this.context.workspaceState.update(foldStateKey(notePath), raw.keys)
      }
    })

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return
      const current = e.document.getText()
      if (current === lastText) return
      lastText = current
      // Echo of our own edit — already reflected in CodeMirror. Anything else
      // that lands while we're applying is a genuine external edit and still
      // gets forwarded.
      if (expectedText !== null && current === expectedText) return
      post({ type: 'knote:host-update', text: current })
    })

    // RPC channel (openWikiTarget, setTaskStatusMeta, readFile, …) shared
    // with every other KNote webview, plus attachmentUri bound to this panel.
    const rpc = attach(webview, {
      ...createHostHandlers(),
      attachmentUri: (src: string) => attachmentUriFor(src, notePath, webview),
      openWithDrawio: (src: string) => openWithDrawio(src, notePath)
    })

    const key = document.uri.toString()
    openPanels.set(key, panel)
    const revealLine = pendingReveal.get(key)
    pendingReveal.delete(key)

    webview.html = webviewHtml(webview, this.context.extensionUri, 'editor', 'KNote', {
      path: notePath,
      // Raw text, EOL and all — CodeMirror normalizes it to LF on the way in.
      text: document.getText(),
      foldedKeys: notePath
        ? this.context.workspaceState.get<string[]>(foldStateKey(notePath), [])
        : [],
      ...(revealLine !== undefined ? { line: revealLine } : {})
    })

    // Custom editors never touch vscode.window.activeTextEditor, so the
    // sidebar panels (Backlinks/Outline/Properties) — which key off that —
    // would otherwise never learn a note is open here. Track active-note
    // identity ourselves, on open and on every tab/split focus change.
    setActiveNote(notePath)
    const viewStateSub = panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) setActiveNote(notePath)
    })

    panel.onDidDispose(() => {
      if (openPanels.get(key) === panel) openPanels.delete(key)
      if (currentActiveNoteRel() === notePath) setActiveNote(null)
      msgSub.dispose()
      changeSub.dispose()
      viewStateSub.dispose()
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
