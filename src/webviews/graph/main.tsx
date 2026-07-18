import { createRoot } from 'react-dom/client'
import '../shared/webview.css'
import { initStores } from '../shared/stores'
import { GraphApp } from './GraphApp'

initStores()

createRoot(document.getElementById('root')!).render(<GraphApp />)
