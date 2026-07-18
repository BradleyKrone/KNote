import { createRoot } from 'react-dom/client'
import '../shared/webview.css'
import { bootstrap } from '../shared/rpc'
import { initStores } from '../shared/stores'
import { SearchApp } from './SearchApp'

const { query = '' } = bootstrap<{ query?: string }>()

initStores()

createRoot(document.getElementById('root')!).render(<SearchApp initialQuery={query} />)
