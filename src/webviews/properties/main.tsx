import { createRoot } from 'react-dom/client'
import '../shared/webview.css'
import { bootstrap } from '../shared/rpc'
import { initStores } from '../shared/stores'
import { PropertiesApp } from './PropertiesApp'

const { activeNote = null } = bootstrap<{ activeNote?: string | null }>()

initStores()

createRoot(document.getElementById('root')!).render(<PropertiesApp initialNote={activeNote} />)
