// Paste an image (screenshot, copied bitmap) into a note: the bytes are
// saved into the vault's configured attachments folder (uniquified name)
// and a vault-root-relative wiki embed `![[/path]]` is inserted — same
// format the Electron app wrote, so existing notes render identically.

import * as vscode from 'vscode'
import dayjs from 'dayjs'
import { joinRel } from '@shared/pathUtils'
import { getVaultConfig } from '../../core/vaultConfig'
import * as vault from '../../core/vaultService'
import { vaultNoteRel } from '../paths'

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg'
}

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
    const config = await getVaultConfig()
    const ext = EXT_BY_MIME[mime] ?? 'png'
    const fileName = `Pasted image ${dayjs().format('YYYYMMDDHHmmss')}.${ext}`
    const saved = await vault.createBinaryFile(
      joinRel(config.attachmentsFolder, fileName),
      Buffer.from(bytes)
    )

    // Land the embed on its own line — pasting mid-line would glue it onto
    // that line's text and break its markdown parsing.
    const pos = ranges[0].start
    const line = document.lineAt(pos.line)
    const hasTextBefore = pos.character > 0
    const hasTextAfter = pos.character < line.text.length
    const embed = `![[/${saved}]]`
    const insert = `${hasTextBefore ? '\n' : ''}${embed}${hasTextAfter ? '\n' : ''}`

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
