// Entry point for the KNote Live Preview editor webview (bundled to
// dist/webviews/editor.js by esbuild's per-view convention). CodeMirror is
// not React, so it's mounted directly; a tiny React root alongside it renders
// the shared reason-prompt / toast dialogs.

import '../shared/webview.css'
import './editor.css'
import { createRoot } from 'react-dom/client'
import { bootstrap } from '../shared/rpc'
import { initStores } from '../shared/stores'
import { createEditor } from './setupEditor'
import { wireInboundSync } from './sync'
import { setNotePath } from './knoteConstructs'
import { EditorDialogs } from './EditorDialogs'

interface EditorBootstrap {
  path: string | null
  text: string
  eol: string
}

const { path = null, text = '', eol = '\n' } = bootstrap<EditorBootstrap>()

setNotePath(path)
initStores() // hydrates the vault config (Kanban columns) + index for the editor

const view = createEditor({
  parent: document.getElementById('root')!,
  doc: text,
  eol
})
wireInboundSync(view)

const dialogHost = document.createElement('div')
document.body.appendChild(dialogHost)
createRoot(dialogHost).render(<EditorDialogs />)
