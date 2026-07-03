import dayjs from 'dayjs'
import type { EditorView } from '@codemirror/view'
import { useVaultStore } from '@/stores/vaultStore'

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg'
}

function extFor(mime: string): string {
  return EXT_BY_MIME[mime] ?? 'png'
}

async function insertPastedImage(view: EditorView, file: File): Promise<void> {
  const pos = view.state.selection.main.head
  const fileName = `Pasted image ${dayjs().format('YYYYMMDDHHmmss')}.${extFor(file.type)}`
  const data = await file.arrayBuffer()
  const savedPath = await window.knote.saveAttachment(fileName, data)
  void useVaultStore.getState().refreshTree()

  // Land the embed on its own line — pasting mid-line (e.g. at the start of
  // a heading or list item) would otherwise glue it onto that line's text
  // and break its markdown parsing (a heading's "#" stops counting once
  // anything precedes it).
  const line = view.state.doc.lineAt(pos)
  const hasTextBefore = pos > line.from
  const hasTextAfter = pos < line.to
  // Wiki-embed syntax with a leading "/" resolves vault-root-relative
  // regardless of the note's own folder, and is already rendered inline by
  // both the live-preview editor and the reading view.
  const embed = `![[/${savedPath}]]`
  const insert = `${hasTextBefore ? '\n' : ''}${embed}${hasTextAfter ? '\n' : ''}`
  const embedFrom = pos + (hasTextBefore ? 1 : 0)
  view.dispatch({
    changes: { from: pos, to: pos, insert },
    selection: { anchor: embedFrom + embed.length },
    userEvent: 'input.knote.pasteImage',
    scrollIntoView: true
  })
}

/** Intercepts image paste (screenshots, copied images) and embeds them as attachments. */
export function handleImagePaste(event: ClipboardEvent, view: EditorView): boolean {
  const items = event.clipboardData?.items
  if (!items) return false
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (!file) continue
      event.preventDefault()
      void insertPastedImage(view, file)
      return true
    }
  }
  return false
}
