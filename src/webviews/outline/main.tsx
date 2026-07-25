import { createRoot } from 'react-dom/client'
import '../shared/webview.css'
import { bootstrap } from '../shared/rpc'
import { initStores } from '../shared/stores'
import { OutlineApp } from './OutlineApp'

const { activeNote = null } = bootstrap<{ activeNote?: string | null }>()

initStores()

createRoot(document.getElementById('root')!).render(<OutlineApp initialNote={activeNote} />)
