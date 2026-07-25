// Entry point for the KNote Live Preview editor webview (bundled to
// dist/webviews/editor.js by esbuild's per-view convention). CodeMirror is
// not React, so it's mounted directly; a tiny React root alongside it renders
// the shared reason-prompt / toast dialogs.

import '../shared/webview.css'
import './editor.css'
import { createRoot } from 'react-dom/client'
import { bootstrap, on } from '../shared/rpc'
import { initStores } from '../shared/stores'
import { refreshEmbedCards } from './embedRender'
import { createEditor } from './setupEditor'
import { wireInboundSync, revealLine } from './sync'
import { setNotePath } from './knoteConstructs'
import { EditorDialogs } from './EditorDialogs'

interface EditorBootstrap {
  path: string | null
  text: string
  eol: string
  line?: number
}

const { path = null, text = '', eol = '\n', line } = bootstrap<EditorBootstrap>()

setNotePath(path)
initStores() // hydrates the vault config (Kanban columns) + index for the editor

const view = createEditor({
  parent: document.getElementById('root')!,
  doc: text,
  eol
})
wireInboundSync(view)

// Jump to the requested line when the note is opened to a specific task.
if (typeof line === 'number') revealLine(view, line)

// An `![[embed]]` shows another file's text, so nothing in this document's own
// transactions signals that it changed — re-fetch the cards whenever the index
// reports some *other* note moved (an edit in the embedded note, an external
// change, a board drag). Deltas for this note are ignored: they fire on every
// keystroke here, and a card can't be showing the note it sits in.
on('indexDelta', (delta) => {
  if (delta.path !== path) refreshEmbedCards(view)
})

const dialogHost = document.createElement('div')
document.body.appendChild(dialogHost)
createRoot(dialogHost).render(<EditorDialogs view={view} />)
