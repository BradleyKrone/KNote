import { createRoot } from 'react-dom/client'
import '../shared/webview.css'
import { bootstrap } from '../shared/rpc'
import { initStores } from '../shared/stores'
import { BacklinksApp } from './BacklinksApp'

const { activeNote = null } = bootstrap<{ activeNote?: string | null }>()

initStores()

createRoot(document.getElementById('root')!).render(<BacklinksApp initialNote={activeNote} />)
