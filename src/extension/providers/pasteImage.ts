// Paste an image (screenshot, copied bitmap) into a note: the bytes are
// saved into the vault's configured attachments folder (uniquified name)
// and a vault-root-relative wiki embed `![[/path]]` is inserted — same
// format the Electron app wrote, so existing notes render identically.

import * as vscode from 'vscode'
import { wrapEmbedForInsertion } from '@shared/embedInsert'
import { saveImageAttachment } from '../../core/attachments'
import { vaultNoteRel } from '../paths'

const PASTE_KIND = vscode.DocumentDropOrPasteEditKind.Empty.append('knote', 'image')

class ImagePasteProvider implements vscode.DocumentPasteEditProvider {
  async provideDocumentPasteEdits(
    document: vscode.TextDocument,
    ranges: readonly vscode.Range[],
    dataTransfer: vscode.DataTransfer,
    _context: vscode.DocumentPasteEditContext,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentPasteEdit[] | undefined> {
    if (vaultNoteRel(document) === null) return undefined
    let file: vscode.DataTransferFile | undefined
    let mime = ''
    for (const [itemMime, item] of dataTransfer) {
      if (itemMime.startsWith('image/')) {
        const f = item.asFile()
        if (f) {
          file = f
          mime = itemMime
          break
        }
      }
    }
    if (!file || token.isCancellationRequested) return undefined

    const bytes = await file.data()
    const saved = await saveImageAttachment(mime, Buffer.from(bytes), vaultNoteRel(document))

    const pos = ranges[0].start
    const line = document.lineAt(pos.line)
    const embed = `![[/${saved}]]`
    const insert = wrapEmbedForInsertion(line.text, pos.character, embed)

    const edit = new vscode.DocumentPasteEdit(insert, 'Save image to vault attachments', PASTE_KIND)
    return [edit]
  }
}

export function registerPasteImage(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentPasteEditProvider(
      { language: 'markdown', scheme: 'file' },
      new ImagePasteProvider(),
      {
        providedPasteEditKinds: [PASTE_KIND],
        pasteMimeTypes: ['image/*']
      }
    )
  )
}
