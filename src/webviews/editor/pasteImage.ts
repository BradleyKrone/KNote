// Paste an image (screenshot, copied bitmap) into the live-preview editor.
//
// A VS Code DocumentPasteEditProvider (extension/providers/pasteImage.ts)
// only fires for paste events in the built-in text editor — it never sees
// paste events inside a CustomTextEditorProvider webview's own DOM. This is
// the webview-side equivalent: a CodeMirror paste handler that detects an
// image on the clipboard, saves it through the host RPC channel (reusing the
// same core/attachments.ts save logic the native provider uses), and inserts
// the same `![[/path]]` wiki-embed format at the cursor.

import { EditorView } from '@codemirror/view'
import { wrapEmbedForInsertion } from '@shared/embedInsert'
import { host } from '../shared/rpc'
import { getNotePath } from './knoteConstructs'

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function findPastedImage(dataTransfer: DataTransfer): { file: File; mime: string } | null {
  for (let i = 0; i < dataTransfer.items.length; i++) {
    const item = dataTransfer.items[i]
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return { file, mime: item.type }
    }
  }
  return null
}

async function insertPastedImage(view: EditorView, file: File, mime: string): Promise<void> {
  const bytes = await file.arrayBuffer()
  const saved = await host.saveImageAttachment(mime, toBase64(bytes), getNotePath())
  const embed = `![[/${saved}]]`

  const pos = view.state.selection.main.head
  const line = view.state.doc.lineAt(pos)
  const insert = wrapEmbedForInsertion(line.text, pos - line.from, embed)

  view.dispatch({
    changes: { from: pos, insert },
    selection: { anchor: pos + insert.length },
    scrollIntoView: true,
    userEvent: 'input'
  })
}

export const pasteImage = EditorView.domEventHandlers({
  paste(event, view) {
    if (!event.clipboardData) return false
    const found = findPastedImage(event.clipboardData)
    if (!found) return false
    event.preventDefault()
    void insertPastedImage(view, found.file, found.mime)
    return true
  }
})
